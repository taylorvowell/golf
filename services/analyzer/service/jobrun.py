"""Run one QUEUE-delivered analysis job (job-spec schema 2).

Schema 2 is what the web app's dispatcher publishes through QStash (schema 1 remains the
file/stdin CLI shape of ``service.worker``). The worker's whole world is four URLs and a
bearer token — it holds no database credential, no storage credential, and no knowledge of
buckets or key math. The web app owns addressing; this module owns running the pipeline and
speaking plain HTTP:

    {"schema": 2,
     "job": {"id": ..., "token": ..., "source_url": ..., "artifact_base_url": ...,
             "events_url": ...},
     "analysis": {"view": "dtl", "handedness": "right", "club_detector": ...}}

``analysis`` carries schema-1 fields (validated by the same code) minus ``video``/``out_dir``,
which are this worker's scratch space and nobody else's business.

Failure taxonomy, and it matters (the delivery layer keys retries off it):

* ``PipelineError`` — a deterministic refusal ("pose confidence too low"). An ANSWER. Reported
  to the callback as ``failed`` and returned as a completed run; retrying would burn GPU time
  to fail identically.
* A **workload-guard refusal** (below) — the same class, decided BEFORE any pipeline stage or
  model load. An oversized, unreadable or unsupported clip fails here for the cost of a
  download and an ffprobe, with a sentence the golfer can act on.
* Anything else (source download failed, artifact upload failed, callback unreachable) — an
  OUTAGE. Raised to the caller, so the HTTP layer returns 5xx and QStash's retry schedule
  applies. The job row is deliberately NOT marked failed: a retry may still succeed.

**Deterministic failures are never re-run, and the mechanism is the return path, not a flag.**
Every retry layer above this module — QStash redelivery for the local worker, ``modal.Retries``
on the hosted Runner — keys off whether this function RAISES. So a deterministic failure posts
its terminal ``failed`` event and returns normally: the delivery layer sees success-of-delivery
and no machinery anywhere can run the job again. Raising one instead would hand Modal a reason
to burn the same GPU minutes twice more to fail identically — which is exactly what happened to
a single oversized clip on 2026-08-26 (75 GPU-minutes, retried to death). Only genuinely
transient infrastructure may raise.
"""
from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any, Callable, Optional

from swingsage import frames, stages, video
from swingsage.pipeline import PipelineError, PipelineEvent, run

from .worker import SPEC_SCHEMA, SpecError, request_from_spec

SPEC2_SCHEMA = 2

_JOB_FIELDS = {"id", "token", "source_url", "artifact_base_url", "events_url"}

#: Progress-bar percentage reached when each stage BEGINS. Re-exported from the ONE stage
#: vocabulary (`swingsage.stages`) rather than restated here — this table and jobs.ts's used to
#: be separate hand-maintained lists that spelled four stages differently and disagreed about
#: six more, which made "the p95 of the pose stage" unanswerable without knowing which runner
#: wrote the row. The name is kept for the callers and tests that already import it.
STAGE_PCT = stages.STAGE_PCT

#: Seconds between forwarded per-frame progress events. Stage transitions always post.
PROGRESS_THROTTLE_S = 2.0

#: Flipped by the first job this process runs. A cold container pays model-load and CUDA-init
#: costs a warm one does not, so a p95 mixing the two describes no real request — the flag is
#: what lets the reader separate them. Process-global on purpose: "cold" is a property of the
#: CONTAINER, and Modal reuses one container for many jobs (scaledown_window=300).
_CONTAINER_USED = False


def container_is_cold() -> bool:
    """True for the first job in this process, False for every job after it."""
    global _CONTAINER_USED
    cold = not _CONTAINER_USED
    _CONTAINER_USED = True
    return cold


@dataclass(frozen=True)
class QueueJob:
    id: str
    token: str
    source_url: str
    artifact_base_url: str
    events_url: str
    analysis: dict[str, Any]


def job_from_spec(spec: dict[str, Any]) -> QueueJob:
    """Validate a schema-2 spec. Strict for the same reason schema 1 is: the caller is a
    machine, and a machine's typo must fail loudly, not run with a default."""
    if not isinstance(spec, dict):
        raise SpecError("job spec must be a JSON object")
    if spec.get("schema") != SPEC2_SCHEMA:
        raise SpecError(f"unsupported job spec schema {spec.get('schema')!r} (expected {SPEC2_SCHEMA})")

    unknown = sorted(set(spec) - {"schema", "job", "analysis"})
    if unknown:
        raise SpecError(f"unknown job spec field(s): {', '.join(unknown)}")

    job = spec.get("job")
    if not isinstance(job, dict):
        raise SpecError("job spec is missing required object 'job'")
    unknown = sorted(set(job) - _JOB_FIELDS)
    if unknown:
        raise SpecError(f"unknown job field(s): {', '.join(unknown)}")
    missing = sorted(_JOB_FIELDS - set(job))
    if missing:
        raise SpecError(f"job is missing required field(s): {', '.join(missing)}")
    for name in sorted(_JOB_FIELDS):
        if not isinstance(job[name], str) or not job[name]:
            raise SpecError(f"job.{name} must be a non-empty string")

    analysis = spec.get("analysis")
    if not isinstance(analysis, dict):
        raise SpecError("job spec is missing required object 'analysis'")
    for banned in ("video", "out_dir"):
        if banned in analysis:
            raise SpecError(f"analysis.{banned} is the worker's scratch space — not settable")
    # Reuse schema-1 validation wholesale (unknown fields, choice sets, the club-detector
    # no-default rule) by round-tripping through it with a placeholder video.
    request_from_spec({"schema": SPEC_SCHEMA, "video": "placeholder.mp4", **analysis})

    return QueueJob(
        id=job["id"], token=job["token"], source_url=job["source_url"],
        artifact_base_url=job["artifact_base_url"], events_url=job["events_url"],
        analysis=dict(analysis),
    )


# ---------------------------------------------------------------------------
# HTTP plumbing — one narrow seam so tests never need a network.

HttpSend = Callable[..., tuple[int, bytes]]


class TransferError(RuntimeError):
    """An HTTP exchange this job could not complete, and whether trying again could help.

    The distinction is the whole point. A 400 from a presigned URL, a 404 for a swing that was
    deleted, a 401 on an expired token — none of those get better by running the analysis three
    more times on a GPU. A 503, a reset connection or a timeout usually do.

    Before this existed every infra failure was one shape: raise, let the delivery layer retry,
    and if it never recovered the job simply went QUIET until the orphan sweep settled it with
    "the worker went silent mid-analysis". That is what a golfer was told when the real answer
    was a 400 on the very first byte, known one second in (2026-08-23).
    """

    def __init__(self, message: str, *, retryable: bool, user_message: Optional[str] = None):
        super().__init__(message)
        self.retryable = retryable
        #: What the golfer reads. Never a status code — a sentence about their swing.
        self.user_message = user_message or message


#: Statuses worth trying again. Everything else in 4xx is a statement about the request itself.
_RETRYABLE_STATUSES = {408, 425, 429, 500, 502, 503, 504, 507, 509}

#: Transient attempts inside one worker run, before the delivery layer's own retries.
TRANSFER_ATTEMPTS = 3
TRANSFER_BACKOFF_S = 1.5


def classify_status(status: int, what: str) -> TransferError:
    """Turn an HTTP status into the typed failure, with a sentence a golfer can act on."""
    if status in _RETRYABLE_STATUSES:
        return TransferError(f"{what} returned {status}", retryable=True,
                             user_message="SwingSage was busy while this swing was processing.")
    if status in (401, 403):
        return TransferError(f"{what} returned {status}", retryable=False,
                             user_message="This swing's upload permission expired before it finished.")
    if status == 404:
        return TransferError(f"{what} returned {status}", retryable=False,
                             user_message="The video for this swing is no longer there.")
    return TransferError(f"{what} returned {status}", retryable=False,
                         user_message="This swing's video could not be read for analysis.")


def with_retries(
    fn: Callable[[], Any],
    *,
    attempts: int = TRANSFER_ATTEMPTS,
    backoff_s: float = TRANSFER_BACKOFF_S,
    sleep: Callable[[float], None] = time.sleep,
    on_retry: Optional[Callable[[int, TransferError], None]] = None,
) -> Any:
    """Run `fn`, retrying only what is worth retrying. Exponential, and short by design: the
    delivery layer retries the whole job behind this, so the job is for riding out a blip, not
    for outlasting an outage."""
    last: Optional[TransferError] = None
    for attempt in range(attempts):
        try:
            return fn()
        except TransferError as e:
            last = e
            if not e.retryable or attempt == attempts - 1:
                raise
            if on_retry:
                on_retry(attempt + 1, e)
            sleep(backoff_s * (2 ** attempt))
    assert last is not None
    raise last


def http_send(
    method: str,
    url: str,
    *,
    token: str,
    data: Optional[bytes] = None,
    content_type: str = "application/json",
    timeout_s: float = 60.0,
) -> tuple[int, bytes]:
    """One HTTP exchange: (status, body). 4xx/5xx return rather than raise; network-level
    failures (refused, DNS, timeout) raise OSError."""
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {token}")
    if data is not None:
        req.add_header("Content-Type", content_type)
    try:
        with urllib.request.urlopen(req, timeout=timeout_s) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


class _DropAuthAcrossHosts(urllib.request.HTTPRedirectHandler):
    """Follow the source route's 307, but never carry our bearer to another host.

    The app answers `/source` with a redirect to a PRESIGNED storage URL, which authenticates
    entirely in its query string. urllib re-sends every original header on a redirect, so the
    job token arrived at R2 as a second, contradictory credential and S3 rejected the request
    outright — `HTTP Error 400` at the first byte of the first hosted swing (2026-08-23).
    Supabase Storage happened to ignore the stray header, which is why this surfaced only
    after production media moved to R2.
    """

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        new = super().redirect_request(req, fp, code, msg, headers, newurl)
        if new is None:
            return None
        if urllib.parse.urlsplit(newurl).netloc != urllib.parse.urlsplit(req.full_url).netloc:
            for store in (new.headers, new.unredirected_hdrs):
                for key in [k for k in store if k.lower() == "authorization"]:
                    store.pop(key)
        return new


def download(url: str, token: str, dest: Path, timeout_s: float = 300.0) -> None:
    """Stream the source clip to disk. Redirects (a signed-URL 307) are followed.

    Every failure leaves as a `TransferError` carrying whether a retry could help, so the
    caller can tell "storage hiccuped" from "this video cannot be read" without parsing a
    stack trace.
    """
    req = urllib.request.Request(url, method="GET")
    req.add_header("Authorization", f"Bearer {token}")
    opener = urllib.request.build_opener(_DropAuthAcrossHosts)
    try:
        with opener.open(req, timeout=timeout_s) as resp:
            if resp.status != 200:
                raise classify_status(resp.status, "source download")
            with dest.open("wb") as f:
                shutil.copyfileobj(resp, f)
    except urllib.error.HTTPError as e:
        raise classify_status(e.code, "source download") from e
    except (urllib.error.URLError, OSError, TimeoutError) as e:
        # Never reached the server, or the connection died mid-stream. Always worth another go.
        raise TransferError(f"source download failed: {e}", retryable=True,
                            user_message="SwingSage could not reach this swing's video.") from e
    if dest.stat().st_size == 0:
        raise TransferError("source download produced an empty file", retryable=False,
                            user_message="This swing's video arrived empty.")


# ---------------------------------------------------------------------------
# The pre-GPU workload guard.

#: Codecs a real phone hands this product, all decodable by the normalize stage. Anything else
#: is refused by name at the door rather than discovered minutes later as an ffmpeg error.
GUARD_CODECS = {"h264", "hevc", "av1", "vp9", "mpeg4", "mjpeg", "prores"}


def _env_num(name: str, fallback: float) -> float:
    try:
        value = float(os.environ.get(name) or "")
    except ValueError:
        return fallback
    return value if value > 0 else fallback


def guard_budgets() -> dict[str, float]:
    """The guard's thresholds — ONE place, env-overridable.

    Sized from the product's own shape: a trimmed swing is ~5.2 real seconds (the review
    window plus its pads), so even a 240fps take estimates ~1,300 normalized frames. These
    budgets admit every legitimate clip with headroom while refusing the ~41s/2,445-frame
    class that burned 75 GPU-minutes on 2026-08-26. Step 02's source manifest hardens the
    numbers; the class is closed now.
    """
    return {
        "max_frames": _env_num("SWINGSAGE_GUARD_MAX_FRAMES", 2000.0),
        "max_real_s": _env_num("SWINGSAGE_GUARD_MAX_REAL_S", 15.0),
        "max_dim": _env_num("SWINGSAGE_GUARD_MAX_DIM", 4320.0),
        # The shared frame provider's plane residency (`frames.estimate_bytes`), which the
        # worker must hold for the whole club stage. Its own ceiling would raise mid-job after
        # the download and the normalize have already been paid for; checked HERE it is a
        # refusal before the GPU is touched. Sized under the 16 GB worker with room for the
        # models and the decoder alongside.
        "max_plane_mb": _env_num("SWINGSAGE_GUARD_MAX_PLANE_MB", 6144.0),
    }


@dataclass(frozen=True)
class WorkloadVerdict:
    """The guard's answer. ``refusal`` is the golfer's sentence, or None to admit. ``facts``
    is what was probed — logged to the job row either way, because these numbers are also the
    telemetry that sizes step 02's manifest thresholds."""

    refusal: Optional[str]
    facts: dict[str, Any]


def guard_workload(
    info: video.VideoInfo,
    capture_fps: float,
    budgets: Optional[dict[str, float]] = None,
    analysis_short_side: int = 720,
) -> WorkloadVerdict:
    """Decide whether a downloaded source is worth a GPU, before any pipeline stage runs.

    Mirrors the normalize stage's own arithmetic (pipeline.py): a slow-motion source is put
    back on the world's clock (``retime_factor``), then normalized at its true capture rate
    (``cfr_target_fps``) — so the frame estimate here is the count the pipeline would actually
    pay for. A stamped slow-mo (41.6 container-seconds, 5.2 real) is admitted; the same
    container with no capture stamp is 41.6 REAL seconds of 60fps normalization and is exactly
    the incident this guard exists to refuse.
    """
    b = budgets or guard_budgets()
    retime = video.retime_factor(info, capture_fps)
    real_duration = info.duration * retime if retime else info.duration
    effective = replace(info, fps=capture_fps, nominal_fps=capture_fps) if retime else info
    target_fps = video.cfr_target_fps(effective)
    est_frames = int(round(real_duration * target_fps))
    # What the CV stages will actually hold: the analysis tier, not the source. `normalize`
    # scales the SHORT side to `analysis_short_side` and keeps the aspect ratio, so the long
    # side follows from the source's shape.
    short, long_ = sorted((max(info.width, 0), max(info.height, 0)))
    if short > 0:
        a_short = min(short, analysis_short_side)
        a_long = int(round(long_ * a_short / short))
    else:
        a_short = a_long = 0
    plane_mb = frames.estimate_bytes(est_frames, a_short, a_long) / 1024 / 1024
    facts: dict[str, Any] = {
        "codec": info.codec,
        "size": f"{info.width}x{info.height}",
        "fps": round(info.fps, 3),
        "capture_fps": round(capture_fps, 1),
        "duration_s": round(info.duration, 2),
        "real_duration_s": round(real_duration, 2),
        "target_fps": target_fps,
        "est_frames": est_frames,
        "analysis_size": f"{a_short}x{a_long}",
        "plane_mb": round(plane_mb),
    }

    def refuse(sentence: str) -> WorkloadVerdict:
        return WorkloadVerdict(refusal=sentence, facts=facts)

    if info.codec not in GUARD_CODECS:
        return refuse(
            f"This video's format ({info.codec}) isn't one SwingSage can analyze — "
            "export it as a standard MP4 and try again."
        )
    if info.width <= 0 or info.height <= 0 or max(info.width, info.height) > b["max_dim"]:
        return refuse(
            f"This video's resolution ({info.width}×{info.height}) is outside what "
            "SwingSage can analyze."
        )
    if real_duration <= 0:
        return refuse("This video reports no length, so it can't be analyzed.")
    if real_duration > b["max_real_s"]:
        return refuse(
            f"This clip is {real_duration:.0f} seconds long — SwingSage analyzes one trimmed "
            "swing of a few seconds. Trim the video down to just the swing and try again."
        )
    if est_frames > b["max_frames"]:
        return refuse(
            f"This clip is too much video to analyze ({est_frames} frames at {target_fps}fps) "
            "— trim it down to just the swing and try again."
        )
    if plane_mb > b["max_plane_mb"]:
        # Deliberately the same sentence as the frame budget: to a golfer both are "too much
        # video", and the distinguishing numbers are already in `facts` on the job row.
        return refuse(
            f"This clip is too much video to analyze ({est_frames} frames at {target_fps}fps) "
            "— trim it down to just the swing and try again."
        )
    return WorkloadVerdict(refusal=None, facts=facts)


# ---------------------------------------------------------------------------


class _EventForwarder:
    """PipelineEvent -> callback POSTs. Stage transitions post immediately; per-frame
    progress is throttled. Progress posts are best-effort — a blip in the callback must not
    kill a 5-minute analysis — but repeated total silence still surfaces at the terminal
    post, which is NOT best-effort."""

    def __init__(self, job: QueueJob, send: HttpSend, clock: Callable[[], float] = time.monotonic):
        self.job = job
        self.send = send
        self.clock = clock
        self._last_progress = float("-inf")
        #: Per-stage spans for this job, accumulated from the pipeline's own measurements and
        #: posted with the terminal event. Also collects the stages that happen OUTSIDE the
        #: pipeline (guard, upload) — leaving those nameless is what would put them in the
        #: unattributed remainder.
        self.metrics = stages.StageAccumulator()
        self.tracker = stages.SpanTracker(self._emit_local)

    def _emit_local(self, kind: str, stage: str, **fields: Any) -> None:
        """Span sink for the job's own stages, which have no PipelineEvent behind them.

        Routed through the same accumulator so `guard` and `upload` are measured exactly like
        a pipeline stage; `stage_started` also posts progress so the bar moves during an
        upload, which on a slow link is otherwise a silent minute at 99%.
        """
        if kind == "stage_done" and fields.get("elapsed_s") is not None:
            self.metrics.add(stage, fields["elapsed_s"], fields.get("frames"),
                             nested=bool(fields.get("depth")))
        elif kind == "stage_started":
            body: dict[str, Any] = {"kind": "progress", "stage": stage}
            if stage in STAGE_PCT:
                body["progressPct"] = STAGE_PCT[stage]
            self.post_soft(body)

    def post(self, body: dict[str, Any]) -> None:
        """A TERMINAL post — `done` or `failed`. This one is the answer's delivery, so it
        retries: losing it to one blip leaves a finished job looking abandoned until the
        orphan sweep settles it with a sentence about the worker going silent."""
        payload = json.dumps(body, separators=(",", ":")).encode("utf-8")

        def once() -> None:
            status, resp = self.send("POST", self.job.events_url, token=self.job.token, data=payload)
            if status in _RETRYABLE_STATUSES:
                raise classify_status(status, "events post")
            if status >= 300:
                raise TransferError(f"events post returned {status}: {resp[:200]!r}",
                                    retryable=False)

        with_retries(once)

    def post_soft(self, body: dict[str, Any]) -> None:
        try:
            self.post(body)
        except (OSError, RuntimeError) as e:
            print(f"progress post failed (continuing): {e}", file=sys.stderr)

    def record(self, job_t0: float, job: QueueJob, info: Any = None,
               pipeline_elapsed_s: float = None, result: Any = None) -> dict:
        """The per-job telemetry record posted with the terminal event.

        Wrapped in a blanket try: this is measurement ABOUT a job, and a bug in it must never
        be the reason a finished analysis fails to report. A job with no metrics is a gap in a
        dashboard; a job that 500s on its own telemetry is a lost swing.
        """
        try:
            facts: dict[str, Any] = {
                "jobId": job.id,
                "runner": "queue",
                "coldStart": container_is_cold(),
                "variants": bool(job.analysis.get("variants")),
                "pipelineElapsedS": (round(pipeline_elapsed_s, 3)
                                     if pipeline_elapsed_s is not None else None),
                "captureFps": job.analysis.get("capture_fps") or None,
                "sourceFps": job.analysis.get("source_fps") or None,
            }
            if result is not None:
                # Decode passes and peak plane residency: the two numbers the shared-decode
                # restructure exists to move, carried per job so a regression is visible in
                # the same table as the seconds it costs.
                facts.update({
                    "decodePasses": getattr(result, "decode_passes", None) or None,
                    "memHighWaterMb": getattr(result, "mem_high_water_mb", None) or None,
                })
            if info is not None:
                facts.update({
                    "sourceFrames": getattr(info, "frame_count", None),
                    "sourceWidth": getattr(info, "width", None),
                    "sourceHeight": getattr(info, "height", None),
                    "probedFps": (round(info.fps, 3)
                                  if getattr(info, "fps", None) else None),
                })
            return self.metrics.record(time.time() - job_t0, **facts)
        except Exception as e:  # noqa: BLE001 — telemetry never fails a job
            print(f"stage metrics unavailable: {e}", file=sys.stderr)
            return {"schema": "stage-metrics", "schemaVersion": 1, "error": str(e)}

    def __call__(self, ev: PipelineEvent) -> None:
        # Every stage_done carries its own measured duration; collecting them here is what
        # turns "printed and discarded" into a queryable per-stage record. Done first and
        # unconditionally so a stage that also posts progress still contributes its span.
        self.metrics.on_event(ev)
        if ev.kind == "stage_progress":
            now = self.clock()
            if now - self._last_progress < PROGRESS_THROTTLE_S:
                return
            self._last_progress = now
            message = ev.message
            if message is None and ev.done is not None and ev.total is not None:
                message = f"frame {ev.done} of {ev.total}"
            self.post_soft({"kind": "progress", "message": message})
            return
        if ev.kind == "warning":
            self.post_soft({"kind": "progress", "logLine": f"warning: {ev.message}"})
            return
        if ev.kind == "stage_started":
            body: dict[str, Any] = {"kind": "progress", "stage": ev.stage}
            if ev.stage in STAGE_PCT:
                body["progressPct"] = STAGE_PCT[ev.stage]
            if ev.message:
                body["message"] = ev.message
                body["logLine"] = ev.message
            self.post_soft(body)


def run_queue_job(
    job: QueueJob,
    *,
    send: HttpSend = http_send,
    fetch: Callable[[str, str, Path], None] = lambda url, token, dest: download(url, token, dest),
    pipeline_run: Callable[..., Any] = run,
    probe_source: Callable[[Path], video.VideoInfo] = video.probe,
    probe_capture: Callable[[Path], float] = video.probe_capture_fps,
    scratch_root: Optional[Path] = None,
) -> bool:
    """Execute one queue job end to end. True = analysis succeeded; False = a deterministic
    answer that has ALREADY been reported terminally (a workload-guard or pipeline refusal, or
    an infra failure no retry can fix). Only genuinely transient failures raise, because only
    those are worth the delivery layer running the whole job again — see the module docstring
    for why this return path is what keeps Modal's retries off deterministic failures."""
    forward = _EventForwarder(job, send)
    scratch = Path(tempfile.mkdtemp(prefix=f"swingsage-job-{job.id[:8]}-", dir=scratch_root))
    keep_scratch = False
    # Job wall clock, not pipeline wall clock: the difference between the two IS the download,
    # guard and upload, and measuring only the pipeline is what made those three invisible.
    job_t0 = time.time()
    try:
        source = scratch / "source.mp4"
        try:
            with forward.tracker.span("download"):
                with_retries(
                    lambda: fetch(job.source_url, job.token, source),
                    on_retry=lambda n, e: forward.post_soft(
                        {"kind": "progress", "logLine": f"source download attempt {n} failed ({e}); retrying"}
                    ),
                )
        except TransferError as e:
            if e.retryable:
                raise
            # Nothing about this improves by burning a GPU on it twice more. Answer NOW, in
            # the golfer's words, instead of going quiet until the orphan sweep guesses.
            print(f"job {job.id}: unretryable transfer failure — {e}", file=sys.stderr)
            forward.post({"kind": "failed", "reason": e.user_message})
            return False

        # The workload guard: refuse deterministically-oversized or unreadable work while it
        # has cost nothing but a download. Runs before request validation touches the file and
        # long before any model loads.
        forward.tracker.begin("guard")
        try:
            info = probe_source(source)
        except OSError:
            raise  # ffprobe itself missing/broken is this host's outage, not the clip's fault
        except Exception as e:  # noqa: BLE001 — any probe failure IS the verdict: unreadable
            print(f"job {job.id}: source probe failed — {e}", file=sys.stderr)
            forward.post({"kind": "failed",
                          "reason": "This swing's video could not be read for analysis."})
            return False
        # Capture facts: the client's source manifest (threaded through the spec by the
        # enqueue side) beats the container tag — the phone remux DROPS the tag, which is how
        # a trimmed slow-mo used to reach this guard looking like 41s of real-time video.
        spec_capture = float(job.analysis.get("capture_fps") or 0.0)
        spec_fps = float(job.analysis.get("source_fps") or 0.0)
        tag_capture = probe_capture(source)
        # Manifest-vs-probe consistency: a manifest describing a DIFFERENT video is terminal —
        # trusting either half blindly would retime by the wrong factor and score garbage.
        if spec_fps > 0 and info.fps > 0 and abs(info.fps - spec_fps) > max(2.0, spec_fps * 0.2):
            delta = f"manifest says {spec_fps:.1f}fps, the file plays at {info.fps:.3f}fps"
            print(f"job {job.id}: manifest contradicts probe — {delta}", file=sys.stderr)
            forward.post_soft({"kind": "progress", "logLine": f"workload guard: {delta}"})
            forward.post({"kind": "failed",
                          "reason": "This upload does not match its own recording facts — "
                                    "try uploading the swing again."})
            return False
        verdict = guard_workload(
            info, spec_capture or tag_capture,
            analysis_short_side=int(job.analysis.get("analysis_short_side") or 720))
        facts = " ".join(f"{k}={v}" for k, v in verdict.facts.items())
        facts += f" manifest_capture_fps={spec_capture} tag_capture_fps={round(tag_capture, 1)}"
        forward.post_soft({"kind": "progress", "logLine": f"workload guard: {facts}"})
        forward.tracker.end("guard")
        if verdict.refusal:
            print(f"job {job.id}: workload refused — {facts}", file=sys.stderr)
            forward.post({"kind": "failed", "reason": verdict.refusal,
                          "stageMetrics": forward.record(job_t0, job, info)})
            return False

        out_dir = scratch / "out"
        req = request_from_spec({
            "schema": SPEC_SCHEMA, **job.analysis,
            "video": str(source), "out_dir": str(out_dir),
        })

        try:
            result = pipeline_run(req, on_event=forward)
        except PipelineError as e:
            # A refusal is an answer. Terminal post must land — it IS the answer's delivery.
            # Partial spans go with it: knowing WHICH stage a job died in, and how long it had
            # been running, is most of the value of telemetry on a failure.
            forward.post({"kind": "failed", "reason": str(e),
                          "stageMetrics": forward.record(job_t0, job, info)})
            return False

        with forward.tracker.span("upload"):
            uploaded = _upload_artifacts(job, result.artifacts, send)
        forward.post_soft({"kind": "progress", "logLine": f"uploaded {len(uploaded)} artifacts"})
        # elapsedS is capacity-model telemetry: every job self-reports its true pipeline
        # duration into the web app's job log (never a golfer-facing surface). stageMetrics is
        # the same idea made queryable — per stage, with the remainder stated rather than
        # hidden, so a later optimization step argues from measurements.
        forward.post({"kind": "done", "elapsedS": result.elapsed_s,
                      "stageMetrics": forward.record(job_t0, job, info,
                                                     pipeline_elapsed_s=result.elapsed_s,
                                                     result=result)})
        return True
    except BaseException:
        keep_scratch = True  # leave the evidence for a human
        print(f"job {job.id} failed; scratch kept at {scratch}", file=sys.stderr)
        raise
    finally:
        if not keep_scratch:
            shutil.rmtree(scratch, ignore_errors=True)


def _upload_artifacts(job: QueueJob, artifacts: tuple[Path, ...], send: HttpSend) -> list[str]:
    """PUT every artifact the pipeline reported. `analysis.json` is load-bearing — its upload
    failing fails the job. An artifact the server does not recognize (400) is skipped with a
    note: the worker may legitimately be newer than the web app's registry."""
    uploaded: list[str] = []
    for path in artifacts:
        name = path.name
        data = path.read_bytes()

        def put() -> tuple[int, bytes]:
            status, body = send(
                "PUT", f"{job.artifact_base_url}/{name}", token=job.token,
                data=data, content_type="application/octet-stream", timeout_s=600.0,
            )
            # A blip here used to throw away a finished analysis — minutes of GPU already
            # spent, and the golfer told nothing landed. Transient statuses get another go.
            if status in _RETRYABLE_STATUSES:
                raise classify_status(status, f"artifact upload {name}")
            return status, body

        status, body = with_retries(put)
        if status == 200:
            uploaded.append(name)
            continue
        if status == 400 and name != "analysis.json":
            print(f"server declined artifact {name}: {body[:200]!r}", file=sys.stderr)
            continue
        raise classify_status(status, f"artifact upload {name}")
    if "analysis.json" not in uploaded:
        raise TransferError("pipeline produced no analysis.json to upload", retryable=False,
                            user_message="The analysis finished but produced no result to save.")
    return uploaded
