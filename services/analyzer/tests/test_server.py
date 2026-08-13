"""The worker HTTP server: signature gate, single-flight, and the status-code taxonomy.

A real ThreadingHTTPServer on an ephemeral port, driven with urllib — but the verifier and
the job runner are fakes, so nothing here needs QStash or a pipeline. The status codes ARE
the retry contract with QStash (200 never retries, 5xx retries, 429 redelivers later), which
is why each one gets pinned.
"""
from __future__ import annotations

import json
import sys
import threading
import urllib.error
import urllib.request
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from service import server as server_mod  # noqa: E402


def _spec_bytes():
    return json.dumps({
        "schema": 2,
        "job": {
            "id": "11111111-2222-4333-8444-555555555555",
            "token": "tok",
            "source_url": "http://web/s",
            "artifact_base_url": "http://web/a",
            "events_url": "http://web/e",
        },
        "analysis": {"view": "dtl", "handedness": "right", "club_detector": None},
    }).encode()


class _Verifier:
    def __init__(self, ok=True):
        self.ok = ok
        self.seen = []

    def __call__(self, body: bytes, signature: str) -> None:
        self.seen.append((body, signature))
        if not self.ok:
            raise ValueError("bad signature")


@pytest.fixture()
def worker_http():
    """(base_url, verifier, set_run_job) against a live server on an ephemeral port."""
    state = {"run_job": lambda job: True}
    verifier = _Verifier()
    srv = server_mod.make_server(0, verifier, lambda job: state["run_job"](job))
    thread = threading.Thread(target=srv.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{srv.server_address[1]}", verifier, state
    finally:
        srv.shutdown()
        srv.server_close()


def _post(base, body=None, signature="sig"):
    req = urllib.request.Request(f"{base}/jobs", data=body or _spec_bytes(), method="POST")
    if signature is not None:
        req.add_header("Upstash-Signature", signature)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


class TestWorkerServer:
    def test_healthz(self, worker_http):
        base, _, _ = worker_http
        with urllib.request.urlopen(f"{base}/healthz", timeout=10) as resp:
            assert resp.status == 200

    def test_missing_signature_is_401(self, worker_http):
        base, verifier, _ = worker_http
        status, body = _post(base, signature=None)
        assert status == 401
        assert verifier.seen == []  # never even reached the verifier

    def test_bad_signature_is_401_and_job_never_runs(self, worker_http):
        base, verifier, state = worker_http
        verifier.ok = False
        ran = []
        state["run_job"] = lambda job: ran.append(job) or True
        status, _ = _post(base)
        assert status == 401
        assert ran == []

    def test_delivery_runs_the_job_and_acks_200(self, worker_http):
        base, _, state = worker_http
        ran = []
        state["run_job"] = lambda job: ran.append(job.id) or True
        status, body = _post(base)
        assert status == 200 and body["ok"] is True
        assert ran == ["11111111-2222-4333-8444-555555555555"]

    def test_refusal_still_acks_200(self, worker_http):
        # A deterministic refusal completed the delivery; retrying it would burn a GPU to
        # fail identically. ok:false is the only trace QStash sees.
        base, _, state = worker_http
        state["run_job"] = lambda job: False
        status, body = _post(base)
        assert status == 200 and body["ok"] is False

    def test_infra_failure_is_500_for_retry(self, worker_http):
        base, _, state = worker_http

        def boom(job):
            raise OSError("source download failed")

        state["run_job"] = boom
        status, body = _post(base)
        assert status == 500

    def test_bad_spec_is_400(self, worker_http):
        base, _, _ = worker_http
        status, body = _post(base, body=json.dumps({"schema": 99}).encode())
        assert status == 400

    def test_second_concurrent_delivery_is_429(self, worker_http):
        base, _, state = worker_http
        entered = threading.Event()
        release = threading.Event()

        def slow(job):
            entered.set()
            release.wait(timeout=10)
            return True

        state["run_job"] = slow
        first = {}

        def go():
            first["resp"] = _post(base)

        t = threading.Thread(target=go)
        t.start()
        assert entered.wait(timeout=10)
        status, body = _post(base)     # while the first is still running
        assert status == 429
        release.set()
        t.join(timeout=10)
        assert first["resp"][0] == 200

    def test_unknown_path_is_404(self, worker_http):
        base, _, _ = worker_http
        req = urllib.request.Request(f"{base}/nope", data=b"x", method="POST")
        req.add_header("Upstash-Signature", "sig")
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                status = resp.status
        except urllib.error.HTTPError as e:
            status = e.code
        assert status == 404
