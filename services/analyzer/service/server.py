"""The worker's HTTP face: receive QStash deliveries, run one job at a time.

    python -m service.server

QStash is push, not pull — it POSTs each job spec to this server, waits for the response, and
retries on 5xx per its schedule. The handler is deliberately SYNCHRONOUS: a 200 means the job
truly ran to a terminal answer, so QStash's at-least-once delivery doubles as the retry story
for crashes — a worker that dies mid-job never acked, and the message comes back. (Delivery
waits up to the plan ceiling — 15 min free tier — which covers an analysis comfortably;
revisit at deploy if p99 ever approaches it.)

Environment (all required):
    QSTASH_CURRENT_SIGNING_KEY / QSTASH_NEXT_SIGNING_KEY   delivery signature keys
    WORKER_PUBLIC_URL   the exact URL QStash publishes to — signature verification is bound
                        to it, so a reverse proxy rewriting the path breaks verification
    WORKER_PORT         listen port (default 8787)

Model assets are checked before the socket is bound (see service/models.py):
    SWINGSAGE_MODEL_GROUPS        which asset groups this deployment needs (default pose,club)
    SWINGSAGE_CLUB_WEIGHTS_URL    where the private club-head weights come from

Status codes speak to QStash's retrier, so they follow the jobrun failure taxonomy:
    200  the job reached a terminal answer (success OR deterministic refusal) — never retry
    401  signature verification failed — not a job at all
    429  a job is already running — redeliver later (parallelism is 1 by design; per-user
         fairness via flow-control keys is a later step of the track)
    400  unusable spec whose callback we cannot even reach — DLQ material
    500  infrastructure failure mid-job — retry may succeed
"""
from __future__ import annotations

import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Callable, Optional

from qstash import Receiver

from .jobrun import job_from_spec, run_queue_job
from .models import check as check_models, describe_failures
from .worker import SpecError


def _require_env(name: str) -> str:
    v = os.environ.get(name)
    if not v:
        raise SystemExit(f"{name} is unset — the worker server cannot start")
    return v


class WorkerHandler(BaseHTTPRequestHandler):
    """One handler class per server instance, built by `make_server` with its collaborators
    closed over — keeps the handler testable without real QStash or a real pipeline."""

    # Injected by make_server:
    verify: Callable[[bytes, str], None]
    run_job: Callable[[Any], bool]
    busy: threading.Lock

    server_version = "swingsage-worker"

    def log_message(self, fmt: str, *args: Any) -> None:  # stderr, not stdout
        print(f"{self.address_string()} {fmt % args}", file=sys.stderr)

    def _reply(self, status: int, body: dict[str, Any]) -> None:
        payload = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self) -> None:
        if self.path == "/healthz":
            self._reply(200, {"ok": True})
        else:
            self._reply(404, {"error": "not found"})

    def do_POST(self) -> None:
        if self.path.rstrip("/") != "/jobs":
            self._reply(404, {"error": "not found"})
            return

        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length)

        signature = self.headers.get("Upstash-Signature")
        if not signature:
            self._reply(401, {"error": "missing Upstash-Signature"})
            return
        try:
            self.verify(body, signature)
        except Exception as e:
            self._reply(401, {"error": f"signature verification failed: {e}"})
            return

        try:
            spec = json.loads(body)
            job = job_from_spec(spec)
        except (json.JSONDecodeError, SpecError) as e:
            # A machine wrote this spec, so a bad one is a bug, not a retry candidate.
            self._reply(400, {"error": str(e)})
            return

        if not self.busy.acquire(blocking=False):
            self._reply(429, {"error": "a job is already running"})
            return
        try:
            ok = self.run_job(job)
            self._reply(200, {"ok": ok, "job": job.id})
        except Exception as e:
            self._reply(500, {"error": str(e), "job": job.id})
        finally:
            self.busy.release()


def make_server(
    port: int,
    verify: Callable[[bytes, str], None],
    run_job: Callable[[Any], bool],
) -> ThreadingHTTPServer:
    handler = type("BoundWorkerHandler", (WorkerHandler,), {
        "verify": staticmethod(verify),
        "run_job": staticmethod(run_job),
        "busy": threading.Lock(),
    })
    return ThreadingHTTPServer(("0.0.0.0", port), handler)


def preflight() -> None:
    """Refuse to serve without the model assets this deployment declares it needs.

    A worker that cannot analyse must never accept work: without this, a container missing its
    club weights binds happily, takes a job, spends five minutes on the pose passes and then
    fails — or, before step 06's spec guard, quietly produced a swing with no club trace. The
    check is hash-based and costs seconds against a job's minutes.
    """
    reports = check_models()
    failures = describe_failures(reports)
    if failures:
        raise SystemExit(failures)
    print(f"model preflight ok ({len(reports)} asset(s))", file=sys.stderr)


def main(argv: Optional[list[str]] = None) -> int:
    preflight()
    current = _require_env("QSTASH_CURRENT_SIGNING_KEY")
    nxt = _require_env("QSTASH_NEXT_SIGNING_KEY")
    public_url = _require_env("WORKER_PUBLIC_URL")
    port = int(os.environ.get("WORKER_PORT") or 8787)

    receiver = Receiver(current_signing_key=current, next_signing_key=nxt)

    def verify(body: bytes, signature: str) -> None:
        # Verification is bound to the EXACT published URL (the JWT's sub claim).
        receiver.verify(body=body.decode("utf-8"), signature=signature, url=public_url)

    server = make_server(port, verify, run_queue_job)
    print(f"worker listening on :{port}, expecting deliveries for {public_url}", file=sys.stderr)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
