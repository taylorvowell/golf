"""The analyzer worker on Modal — the deployed shape of service/server.py (D64).

    modal deploy services/analyzer/service/modal_app.py       (from the repo root)
    modal run    services/analyzer/service/modal_app.py::fetch_models
    modal run    services/analyzer/service/modal_app.py::bench

Modal caps a web request at ~150s, and the local worker holds the QStash delivery open for
the whole pipeline run (76-407s measured) — so the one design change on this host is the
split into Modal's idiomatic two parts:

* ``ingress`` — a small CPU web function. Verifies the QStash signature (same
  ``qstash.Receiver``, same WORKER_PUBLIC_URL exact-match rule as server.py), validates the
  schema-2 spec at the door (including the club-detector-exists rule — the volume is mounted
  here for exactly that check), ``spawn``s the pipeline, and acks 200 immediately.
* ``Runner.run_job`` — an L4 GPU function with a long timeout running the existing
  ``service.jobrun`` work unchanged: source download, pipeline, artifact PUTs, events,
  verified done.

Retry semantics move with the split, deliberately (recorded in docs/decisions/platform-data.md):
QStash's retries now cover only failure to ACCEPT (Modal down, spawn failure, bad spec —
which dead-letters into the existing failureCallback). Mid-run infra failures are retried by
Modal (``retries=`` on the class); a job that still dies goes silent and is settled ``failed``
by the step-05 orphan detection (heartbeat 900s). Deterministic refusals (``PipelineError``)
are unchanged: terminal ``failed`` event, never retried.

Model assets live on a ``modal.Volume`` (``swingsage-models``), never in image layers — the
same rule the Dockerfile states. ``fetch_models`` populates it through the committed-hash
manifest; ``Runner`` re-verifies hashes at container start and refuses to serve without them
(server.py's preflight, preserved). The one secret (``swingsage-analyzer``) holds the QStash
signing keys, the private club-weights URL, and this worker's own public URL — no DB or
storage credential ever lands here (D26).

Module top level imports only stdlib + modal, and every local-filesystem path is guarded by
``modal.is_local()`` — in the container this file lives at a different depth, and step 03's
contract.py bug (import-time path math crashing a foreign install) is not getting a sequel.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Callable, Optional

import modal

APP_NAME = "swingsage-analyzer"
SECRET_NAME = "swingsage-analyzer"
VOLUME_NAME = "swingsage-models"
MODELS_MOUNT = "/mnt/models"
#: Where the manifest roots live on the volume — SWINGSAGE_MODEL_ROOT/SWINGSAGE_RTMLIB_CACHE
#: (built in step 06 for exactly this) point here, so the image stays weight-free.
MODEL_ROOT = f"{MODELS_MOUNT}/app"
RTMLIB_CACHE = f"{MODELS_MOUNT}/rtmlib"
#: The in-container club-detector path a job spec should name (WORKER_CLUB_DETECTOR web-side).
CLUB_DETECTOR_PATH = f"{MODEL_ROOT}/runs/clubhead/weights/best.pt"

#: /app is the image's code root (Dockerfile WORKDIR); /app/service additionally lets Modal
#: import this module by its deploy-time name (`modal_app`) straight from the image, which is
#: what include_source=False relies on — the image already ships the code, so no source mount.
#: Deliberately NO SWINGSAGE_MODEL_ROOT / SWINGSAGE_RTMLIB_CACHE here: those overrides
#: relocate only service/models.py's fetch-and-check, and the pipeline's own loaders
#: (pose.py's landmarker path, rtmlib's ~/.cache) never read them — the first Modal bench
#: proved that the hard way (MediaPipe FileNotFoundError while preflight was green, and
#: rtmlib silently re-downloading an unpinned model past the manifest). The volume is instead
#: symlinked to the REAL asset paths (_link_model_volume), the same shape as the Docker
#: deployment's volume mounts.
_MODEL_ENV = {
    "PYTHONPATH": "/app:/app/service",
}


def _link_model_volume() -> None:
    """Make the volume's assets appear exactly where the pipeline loads them from:
    /app/models and /app/runs (repo-relative), and rtmlib's own checkpoints cache. Runs in
    every function that touches models, before any check or load. Idempotent."""
    import os

    links = (
        (f"{MODEL_ROOT}/models", Path("/app/models")),
        (f"{MODEL_ROOT}/runs", Path("/app/runs")),
        (RTMLIB_CACHE, Path.home() / ".cache" / "rtmlib" / "hub" / "checkpoints"),
    )
    for target, link in links:
        os.makedirs(target, exist_ok=True)
        link.parent.mkdir(parents=True, exist_ok=True)
        if not (link.is_symlink() or link.exists()):
            os.symlink(target, str(link), target_is_directory=True)


def _dockerignore_lines(path: Optional[Path]) -> list[str]:
    """The repo .dockerignore, as explicit ignore rules — explicit because AUTO_DOCKERIGNORE
    keys off the *current working directory*, and a deploy run from services/analyzer would
    silently upload an unfiltered context."""
    if path is None or not path.is_file():
        return []
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            out.append(line)
    return out


_repo = Path(__file__).resolve().parents[3] if modal.is_local() else None

image = modal.Image.from_dockerfile(
    str(_repo / "services" / "analyzer" / "Dockerfile") if _repo else "Dockerfile",
    context_dir=str(_repo) if _repo else ".",
    ignore=_dockerignore_lines(_repo / ".dockerignore" if _repo else None),
).env(_MODEL_ENV)

app = modal.App(APP_NAME)
volume = modal.Volume.from_name(VOLUME_NAME, create_if_missing=True)
secret = modal.Secret.from_name(SECRET_NAME)


# ---------------------------------------------------------------------------
# The delivery gate — pure, so the decision logic is testable without Modal or a network.


def gate_delivery(
    body: bytes,
    signature: Optional[str],
    verify: Callable[[bytes, str], None],
    parse: Callable[[dict[str, Any]], Any],
    refusals: tuple[type[BaseException], ...] = (),
) -> tuple[int, dict[str, Any], Optional[dict[str, Any]]]:
    """Decide one delivery: (status, response body, spec-to-spawn or None).

    Mirrors server.py's codes exactly, minus 429 (Modal autoscales) and minus the run itself:
    401 not a job at all; 400 unusable spec (machine-written, so a bug — QStash burns its
    retries and the failureCallback settles it); 200 accepted. ``refusals`` are the parse
    error types that mean 400; anything else propagates so the delivery 5xxs and is retried.
    """
    if not signature:
        return 401, {"error": "missing Upstash-Signature"}, None
    try:
        verify(body, signature)
    except Exception as e:
        return 401, {"error": f"signature verification failed: {e}"}, None
    try:
        spec = json.loads(body)
        job = parse(spec)
    except refusals as e:
        return 400, {"error": str(e)}, None
    return 200, {"ok": True, "accepted": True, "job": job.id}, spec


def make_asgi(handle_jobs: Callable, healthz: Callable[[], dict[str, Any]]):
    """A stdlib-only ASGI app: GET /healthz, POST /jobs. No framework — two routes do not
    justify a dependency, and the repo's local worker is stdlib http.server for the same
    reason."""

    async def _send_json(send, status: int, body: dict[str, Any]) -> None:
        payload = json.dumps(body).encode("utf-8")
        await send({
            "type": "http.response.start",
            "status": status,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(payload)).encode()),
            ],
        })
        await send({"type": "http.response.body", "body": payload})

    async def asgi(scope, receive, send):
        if scope["type"] == "lifespan":
            while True:
                message = await receive()
                if message["type"] == "lifespan.startup":
                    await send({"type": "lifespan.startup.complete"})
                elif message["type"] == "lifespan.shutdown":
                    await send({"type": "lifespan.shutdown.complete"})
                    return
            return
        if scope["type"] != "http":
            return

        method, path = scope["method"], scope["path"].rstrip("/") or "/"
        if method == "GET" and path == "/healthz":
            await _send_json(send, 200, healthz())
            return
        if method == "POST" and path == "/jobs":
            body = b""
            while True:
                message = await receive()
                body += message.get("body", b"")
                if not message.get("more_body"):
                    break
            headers = {k.decode("latin-1").lower(): v.decode("latin-1")
                       for k, v in scope.get("headers", [])}
            status, reply = await handle_jobs(body, headers.get("upstash-signature"))
            await _send_json(send, status, reply)
            return
        await _send_json(send, 404, {"error": "not found"})

    return asgi


# ---------------------------------------------------------------------------
# The functions.


@app.function(
    image=image,
    secrets=[secret],
    volumes={MODELS_MOUNT: volume},
    cpu=2.0,
    memory=2048,
    timeout=1800,
    include_source=False,
)
def fetch_models() -> str:
    """Populate the volume from the committed-hash manifest (service/models.py). One-shot;
    a second run verifies and downloads nothing. SWINGSAGE_CLUB_WEIGHTS_URL comes from the
    secret — mint a fresh signed URL with `pnpm --filter web models:publish` when it expires
    or the detector is retrained, and update the secret."""
    from service import fetchmodels

    _link_model_volume()
    rc = fetchmodels.main([])
    if rc != 0:
        raise RuntimeError("model fetch failed — see the asset lines above")
    volume.commit()
    return "ok"


@app.cls(
    image=image,
    gpu="L4",
    cpu=8.0,
    memory=16384,
    timeout=1800,
    retries=modal.Retries(max_retries=2, initial_delay=10.0),
    volumes={MODELS_MOUNT: volume},
    secrets=[secret],
    max_containers=4,
    scaledown_window=300,
    env={"SWINGSAGE_POSE_DEVICE": "cuda"},
    include_source=False,
)
class Runner:
    """One queue job per container at a time (Modal's default input concurrency), scaled
    horizontally up to max_containers — the single-flight property of server.py, multiplied.
    Per-user fairness stays QStash flowControl's job at enqueue."""

    @modal.enter()
    def preflight(self) -> None:
        # server.py's rule, preserved: a worker that cannot analyse must never accept work.
        from service.models import check, describe_failures

        _link_model_volume()
        failures = describe_failures(check())
        if failures:
            raise RuntimeError(failures)

    @modal.method()
    def run_job(self, spec: dict[str, Any]) -> bool:
        """True = analysed; False = deterministic refusal (already reported terminally).
        Raises on infra failure so Modal's retries apply — with a best-effort breadcrumb into
        the job log first, because the delivery was already acked and QStash can no longer
        narrate this for us. Terminal silence is settled by the step-05 heartbeat reconcile."""
        from service.jobrun import _EventForwarder, http_send, job_from_spec, run_queue_job

        job = job_from_spec(spec)
        try:
            return run_queue_job(job)
        except Exception as e:
            _EventForwarder(job, http_send).post_soft(
                {"kind": "progress", "logLine": f"worker infra failure ({type(e).__name__}): {e} — modal may retry"}
            )
            raise


@app.function(
    image=image,
    secrets=[secret],
    volumes={MODELS_MOUNT: volume},
    cpu=1.0,
    memory=1024,
    timeout=120,
    include_source=False,
)
@modal.asgi_app(label="swingsage-ingress")
def ingress():
    import os

    from qstash import Receiver

    from service.jobrun import job_from_spec
    from service.worker import SpecError

    receiver = Receiver(
        current_signing_key=os.environ["QSTASH_CURRENT_SIGNING_KEY"],
        next_signing_key=os.environ["QSTASH_NEXT_SIGNING_KEY"],
    )
    public_url = os.environ.get("WORKER_PUBLIC_URL")

    def verify(body: bytes, signature: str) -> None:
        # Bound to the EXACT published URL — the standing deploy-day trap (step 04).
        receiver.verify(body=body.decode("utf-8"), signature=signature, url=public_url)

    async def handle_jobs(body: bytes, signature: Optional[str]):
        if not public_url:
            # Loud, not crash-loopy: healthz stays up while the secret is being bootstrapped.
            return 500, {"error": "WORKER_PUBLIC_URL is unset in the swingsage-analyzer secret"}
        status, reply, spec = gate_delivery(
            body, signature, verify, job_from_spec,
            refusals=(json.JSONDecodeError, SpecError),
        )
        if status != 200:
            # server.py logs every request to stderr; here the refusal reason is the one
            # line that matters — without it a 400 is invisible until the DLQ.
            print(f"delivery refused {status}: {reply.get('error')}")
        if spec is not None:
            call = await Runner().run_job.spawn.aio(spec)
            reply["call_id"] = call.object_id
        return status, reply

    def healthz() -> dict[str, Any]:
        return {"ok": True}

    return make_asgi(handle_jobs, healthz)


# ---------------------------------------------------------------------------
# Capacity measurement — run on demand, never part of serving.


@app.function(
    image=image,
    gpu="L4",
    cpu=8.0,
    memory=16384,
    timeout=3600,
    volumes={MODELS_MOUNT: volume},
    secrets=[secret],
    env={"SWINGSAGE_POSE_DEVICE": "cuda"},
    include_source=False,
)
def bench(video: str = f"{MODELS_MOUNT}/fixtures/pro_2.mp4") -> dict[str, Any]:
    """The capacity numbers, measured on the real host class — both pipeline shapes, with the
    step-01 rule enforced: refuse to time a session that silently fell back to CPU, because
    CPU-against-CPU reads exactly like 'the GPU does not help'."""
    import time

    from service.models import check, describe_failures

    _link_model_volume()
    failures = describe_failures(check())
    if failures:
        raise RuntimeError(failures)

    import torch

    from swingsage import pose_rtm
    from swingsage.pipeline import AnalysisRequest, run

    gpu_name = torch.cuda.get_device_name(0) if torch.cuda.is_available() else "NONE"

    # The session the pipeline actually builds, asked what it actually got (posebench.py).
    from rtmlib import RTMPose

    url, sz = pose_rtm.WHOLEBODY_MODELS["performance"]
    probe = RTMPose(url, model_input_size=sz, backend="onnxruntime", device=pose_rtm.pose_device())
    providers = list(probe.session.get_providers())
    if "CUDAExecutionProvider" not in providers:
        raise RuntimeError(f"session providers are {providers} — CUDA fell back to CPU; refusing to bench")
    del probe

    results: dict[str, Any] = {"gpu": gpu_name, "session_providers": providers, "video": video}
    for label, variants in (("production_variants_off", False), ("dev_variants_on", True)):
        stage_t0: dict[str, float] = {}
        stage_secs: dict[str, float] = {}
        pose_frames = {"total": None}
        order: list[str] = []

        def on_event(ev) -> None:
            now = time.perf_counter()
            if ev.kind == "stage_started":
                if order:
                    stage_secs[order[-1]] = now - stage_t0[order[-1]]
                order.append(ev.stage)
                stage_t0[ev.stage] = now
            elif ev.kind == "stage_progress" and order and order[-1] == "pose" and ev.total:
                pose_frames["total"] = ev.total

        req = AnalysisRequest(
            video=Path(video),
            out_dir=Path(f"/tmp/bench-{label}"),
            club_detector=CLUB_DETECTOR_PATH,
            club_variants=variants,
        )
        t0 = time.perf_counter()
        result = run(req, on_event=on_event)
        total = time.perf_counter() - t0
        if order:
            stage_secs[order[-1]] = time.perf_counter() - stage_t0[order[-1]]

        entry: dict[str, Any] = {
            "total_s": round(total, 1),
            "pipeline_elapsed_s": round(result.elapsed_s, 1),
            "stages_s": {k: round(v, 1) for k, v in sorted(stage_secs.items(), key=lambda kv: -kv[1])},
        }
        if pose_frames["total"] and "pose" in stage_secs:
            entry["pose_ms_per_frame"] = round(stage_secs["pose"] / pose_frames["total"] * 1000, 1)
        results[label] = entry

    print(json.dumps(results, indent=2))
    return results
