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
* Anything else (source download failed, artifact upload failed, callback unreachable) — an
  OUTAGE. Raised to the caller, so the HTTP layer returns 5xx and QStash's retry schedule
  applies. The job row is deliberately NOT marked failed: a retry may still succeed.
"""
from __future__ import annotations

import json
import shutil
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Optional

from swingsage.pipeline import PipelineError, PipelineEvent, run

from .worker import SPEC_SCHEMA, SpecError, request_from_spec

SPEC2_SCHEMA = 2

_JOB_FIELDS = {"id", "token", "source_url", "artifact_base_url", "events_url"}

#: Progress-bar percentage reached when each stage BEGINS, from measured wall-clock on the
#: fixtures — the same deliberately uneven spacing as jobs.ts's STAGES table (normalize and
#: the two pose passes are most of the run; an evenly spaced bar reads as a hang).
STAGE_PCT = {
    "probe": 3, "normalize": 22, "pose_localiser": 42, "pose": 66, "stage3": 72,
    "events": 76, "detector": 80, "club": 88, "variants": 89, "face": 90,
    "checkpoints": 91, "metrics": 93, "silhouette": 95, "contract": 96,
    "scoring": 97, "render": 99,
}

#: Seconds between forwarded per-frame progress events. Stage transitions always post.
PROGRESS_THROTTLE_S = 2.0


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

    def __call__(self, ev: PipelineEvent) -> None:
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
    scratch_root: Optional[Path] = None,
) -> bool:
    """Execute one queue job end to end. True = analysis succeeded; False = a deterministic
    answer that has ALREADY been reported terminally (a pipeline refusal, or an infra failure
    no retry can fix). Only genuinely transient failures raise, because only those are worth
    the delivery layer running the whole job again."""
    forward = _EventForwarder(job, send)
    scratch = Path(tempfile.mkdtemp(prefix=f"swingsage-job-{job.id[:8]}-", dir=scratch_root))
    keep_scratch = False
    try:
        source = scratch / "source.mp4"
        try:
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

        out_dir = scratch / "out"
        req = request_from_spec({
            "schema": SPEC_SCHEMA, **job.analysis,
            "video": str(source), "out_dir": str(out_dir),
        })

        try:
            result = pipeline_run(req, on_event=forward)
        except PipelineError as e:
            # A refusal is an answer. Terminal post must land — it IS the answer's delivery.
            forward.post({"kind": "failed", "reason": str(e)})
            return False

        uploaded = _upload_artifacts(job, result.artifacts, send)
        forward.post_soft({"kind": "progress", "logLine": f"uploaded {len(uploaded)} artifacts"})
        # elapsedS is capacity-model telemetry: every job self-reports its true pipeline
        # duration into the web app's job log (never a golfer-facing surface).
        forward.post({"kind": "done", "elapsedS": result.elapsed_s})
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
