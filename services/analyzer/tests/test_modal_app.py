"""The Modal ingress gate: the delivery status-code taxonomy, minus the run.

``gate_delivery`` is the pure decision seam of the Modal deployment (service/modal_app.py) —
the same contract test_server.py pins for the local worker, re-pinned here because on Modal
the codes speak to QStash BEFORE the pipeline runs: 200 means accepted-and-spawned, and a
wrong code either loses a job or burns four deliveries on a bug. The ASGI shim is exercised
in-memory; nothing here needs Modal, QStash, or a network.
"""
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from service.modal_app import gate_delivery, make_asgi  # noqa: E402


class _Refusal(Exception):
    pass


def _spec_bytes():
    return json.dumps({"schema": 2, "job": {"id": "j-1"}}).encode()


class _Job:
    id = "j-1"


def _parse_ok(spec):
    assert spec["schema"] == 2
    return _Job()


def _verify_ok(body, signature):
    pass


def _verify_bad(body, signature):
    raise ValueError("bad signature")


# ---------------------------------------------------------------------------
# gate_delivery


def test_missing_signature_is_401_and_nothing_spawns():
    status, reply, spec = gate_delivery(_spec_bytes(), None, _verify_ok, _parse_ok)
    assert status == 401
    assert spec is None
    assert "Upstash-Signature" in reply["error"]


def test_failed_verification_is_401_and_nothing_spawns():
    status, reply, spec = gate_delivery(_spec_bytes(), "sig", _verify_bad, _parse_ok)
    assert status == 401
    assert spec is None
    assert "bad signature" in reply["error"]


def test_unparseable_json_is_400_when_refused():
    status, reply, spec = gate_delivery(
        b"not json", "sig", _verify_ok, _parse_ok, refusals=(json.JSONDecodeError,)
    )
    assert status == 400
    assert spec is None


def test_spec_refusal_is_400_with_the_reason():
    def parse(spec):
        raise _Refusal("club_detector 'x' is not on this worker")

    status, reply, spec = gate_delivery(
        _spec_bytes(), "sig", _verify_ok, parse, refusals=(_Refusal,)
    )
    assert status == 400
    assert spec is None
    assert "club_detector" in reply["error"]


def test_unexpected_parse_error_propagates_so_the_delivery_5xxs():
    def parse(spec):
        raise RuntimeError("a bug, not a refusal")

    with pytest.raises(RuntimeError):
        gate_delivery(_spec_bytes(), "sig", _verify_ok, parse, refusals=(_Refusal,))


def test_accepted_delivery_returns_the_spec_to_spawn():
    body = _spec_bytes()
    status, reply, spec = gate_delivery(body, "sig", _verify_ok, _parse_ok)
    assert status == 200
    assert reply == {"ok": True, "accepted": True, "job": "j-1"}
    assert spec == json.loads(body)


def test_verification_sees_the_raw_body_and_signature():
    seen = []

    def verify(body, signature):
        seen.append((body, signature))

    body = _spec_bytes()
    gate_delivery(body, "sig-123", verify, _parse_ok)
    assert seen == [(body, "sig-123")]


# ---------------------------------------------------------------------------
# The stdlib ASGI shim


def _call_asgi(asgi, method, path, body=b"", headers=()):
    """Drive the app with an in-memory ASGI exchange; returns (status, parsed body)."""
    sent = []
    messages = [{"type": "http.request", "body": body, "more_body": False}]

    async def receive():
        return messages.pop(0)

    async def send(message):
        sent.append(message)

    scope = {"type": "http", "method": method, "path": path,
             "headers": [(k.encode(), v.encode()) for k, v in headers]}
    asyncio.run(asgi(scope, receive, send))
    status = next(m["status"] for m in sent if m["type"] == "http.response.start")
    payload = b"".join(m.get("body", b"") for m in sent if m["type"] == "http.response.body")
    return status, json.loads(payload)


def _shim(handled):
    async def handle_jobs(body, signature):
        handled.append((body, signature))
        return 200, {"ok": True}

    return make_asgi(handle_jobs, lambda: {"ok": True, "probe": 1})


def test_asgi_healthz():
    status, body = _call_asgi(_shim([]), "GET", "/healthz")
    assert (status, body) == (200, {"ok": True, "probe": 1})


def test_asgi_unknown_path_is_404():
    status, _ = _call_asgi(_shim([]), "GET", "/nope")
    assert status == 404
    status, _ = _call_asgi(_shim([]), "POST", "/other")
    assert status == 404


def test_asgi_jobs_plumbs_body_and_signature_case_insensitively():
    handled = []
    status, body = _call_asgi(
        _shim(handled), "POST", "/jobs", body=b"payload",
        headers=[("Upstash-Signature", "s-1")],
    )
    assert (status, body) == (200, {"ok": True})
    assert handled == [(b"payload", "s-1")]


def test_asgi_jobs_tolerates_trailing_slash():
    handled = []
    status, _ = _call_asgi(_shim(handled), "POST", "/jobs/", body=b"x")
    assert status == 200
    assert handled[0][0] == b"x"


def test_asgi_lifespan_completes():
    sent = []
    messages = [{"type": "lifespan.startup"}, {"type": "lifespan.shutdown"}]

    async def receive():
        return messages.pop(0)

    async def send(message):
        sent.append(message)

    asyncio.run(_shim([])({"type": "lifespan"}, receive, send))
    assert [m["type"] for m in sent] == ["lifespan.startup.complete", "lifespan.shutdown.complete"]
