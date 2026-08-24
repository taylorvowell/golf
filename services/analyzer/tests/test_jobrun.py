"""The queue job runner: spec-2 validation, event forwarding, uploads, failure taxonomy.

Everything hermetic — the pipeline is monkeypatched, HTTP goes through recorded fakes. The
taxonomy tests matter most: a PipelineError must complete the delivery (refusals are answers,
not retry candidates) while an infrastructure failure must RAISE so the HTTP layer 5xxes and
QStash redelivers.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from swingsage.pipeline import PipelineError, PipelineEvent, PipelineResult  # noqa: E402
from service import jobrun  # noqa: E402
from service.worker import SpecError  # noqa: E402


def _spec(**over):
    base = {
        "schema": 2,
        "job": {
            "id": "11111111-2222-4333-8444-555555555555",
            "token": "tok",
            "source_url": "http://web/api/internal/jobs/x/source",
            "artifact_base_url": "http://web/api/internal/jobs/x/artifacts",
            "events_url": "http://web/api/internal/jobs/x/events",
        },
        "analysis": {"view": "dtl", "handedness": "right", "club_detector": None},
    }
    base.update(over)
    return base


class TestJobFromSpec:
    def test_valid_spec_round_trips(self):
        job = jobrun.job_from_spec(_spec())
        assert job.id == "11111111-2222-4333-8444-555555555555"
        assert job.analysis["view"] == "dtl"

    def test_wrong_schema_refuses(self):
        with pytest.raises(SpecError, match="schema"):
            jobrun.job_from_spec(_spec(schema=1))

    def test_unknown_top_level_field_refuses(self):
        with pytest.raises(SpecError, match="surprise"):
            jobrun.job_from_spec(_spec(surprise=True))

    def test_missing_job_field_refuses(self):
        spec = _spec()
        del spec["job"]["token"]
        with pytest.raises(SpecError, match="token"):
            jobrun.job_from_spec(spec)

    def test_unknown_job_field_refuses(self):
        spec = _spec()
        spec["job"]["extra"] = "x"
        with pytest.raises(SpecError, match="extra"):
            jobrun.job_from_spec(spec)

    def test_video_and_out_dir_are_not_settable(self):
        # The worker's scratch space is nobody else's business — a spec that names it is a
        # confused (or hostile) dispatcher.
        for banned in ("video", "out_dir"):
            spec = _spec()
            spec["analysis"][banned] = "/tmp/x"
            with pytest.raises(SpecError, match=banned):
                jobrun.job_from_spec(spec)

    def test_analysis_fields_get_schema1_strictness(self):
        spec = _spec()
        spec["analysis"]["handedness"] = "ambidextrous"
        with pytest.raises(SpecError, match="handedness"):
            jobrun.job_from_spec(spec)
        spec = _spec()
        spec["analysis"]["not_a_field"] = 1
        with pytest.raises(SpecError, match="not_a_field"):
            jobrun.job_from_spec(spec)


class _Recorder:
    """A fake HttpSend recording every exchange, answering 200 unless told otherwise."""

    def __init__(self):
        self.calls = []
        self.fail_status: dict[str, int] = {}   # url substring -> status
        self.raise_on: set[str] = set()          # url substring -> raise OSError

    def __call__(self, method, url, *, token, data=None, content_type="application/json",
                 timeout_s=60.0):
        self.calls.append((method, url, data))
        for frag in self.raise_on:
            if frag in url:
                raise OSError(f"unreachable: {frag}")
        for frag, status in self.fail_status.items():
            if frag in url:
                return status, b'{"error":"nope"}'
        return 200, b'{"ok":true}'

    def events(self):
        return [json.loads(d) for (m, u, d) in self.calls if u.endswith("/events") and d]

    def puts(self):
        return [u.rsplit("/", 1)[1] for (m, u, d) in self.calls if m == "PUT"]


def _fake_fetch(tmp_path):
    def fetch(url, token, dest: Path):
        dest.write_bytes(b"fake video bytes")
    return fetch


def _result(out_dir: Path, names=("analysis.json", "coach_report.json", "overlay.mp4")):
    out_dir.mkdir(parents=True, exist_ok=True)
    paths = []
    for n in names:
        p = out_dir / n
        p.write_bytes(b"artifact " + n.encode())
        paths.append(p)
    return PipelineResult(out_dir=out_dir, artifacts=tuple(paths), schema_version=3,
                          elapsed_s=1.0, warnings=())


class TestRunQueueJob:
    def test_happy_path_uploads_then_posts_done(self, tmp_path):
        rec = _Recorder()
        job = jobrun.job_from_spec(_spec())

        def fake_run(req, on_event=None):
            on_event(PipelineEvent(kind="stage_started", stage="probe"))
            on_event(PipelineEvent(kind="stage_started", stage="pose"))
            return _result(Path(req.out_dir))

        ok = jobrun.run_queue_job(job, send=rec, fetch=_fake_fetch(tmp_path),
                                  pipeline_run=fake_run, scratch_root=tmp_path)
        assert ok is True
        assert rec.puts() == ["analysis.json", "coach_report.json", "overlay.mp4"]
        kinds = [e["kind"] for e in rec.events()]
        assert kinds[-1] == "done"
        # the done post self-reports the true pipeline duration — capacity-model telemetry
        assert rec.events()[-1]["elapsedS"] == 1.0
        stages = [e.get("stage") for e in rec.events() if e["kind"] == "progress"]
        assert "probe" in stages and "pose" in stages
        # done posts AFTER every upload — the ordering the publish-then-flip rule depends on
        done_idx = next(i for i, (m, u, d) in enumerate(rec.calls)
                        if u.endswith("/events") and d and b'"done"' in d)
        last_put = max(i for i, (m, u, d) in enumerate(rec.calls) if m == "PUT")
        assert done_idx > last_put

    def test_stage_pct_forwarded_from_the_measured_table(self, tmp_path):
        rec = _Recorder()
        job = jobrun.job_from_spec(_spec())

        def fake_run(req, on_event=None):
            on_event(PipelineEvent(kind="stage_started", stage="normalize"))
            return _result(Path(req.out_dir))

        jobrun.run_queue_job(job, send=rec, fetch=_fake_fetch(tmp_path),
                             pipeline_run=fake_run, scratch_root=tmp_path)
        ev = next(e for e in rec.events() if e.get("stage") == "normalize")
        assert ev["progressPct"] == jobrun.STAGE_PCT["normalize"]

    def test_pipeline_refusal_reports_failed_and_completes(self, tmp_path):
        rec = _Recorder()
        job = jobrun.job_from_spec(_spec())

        def fake_run(req, on_event=None):
            raise PipelineError("pose confidence is catastrophically low")

        ok = jobrun.run_queue_job(job, send=rec, fetch=_fake_fetch(tmp_path),
                                  pipeline_run=fake_run, scratch_root=tmp_path)
        assert ok is False  # completed delivery — do NOT retry a deterministic refusal
        failed = [e for e in rec.events() if e["kind"] == "failed"]
        assert failed and "confidence" in failed[0]["reason"]
        assert rec.puts() == []

    def test_source_download_failure_raises_for_retry(self, tmp_path):
        rec = _Recorder()
        job = jobrun.job_from_spec(_spec())

        def bad_fetch(url, token, dest):
            raise OSError("connection refused")

        with pytest.raises(OSError):
            jobrun.run_queue_job(job, send=rec, fetch=bad_fetch,
                                 pipeline_run=lambda *a, **k: None, scratch_root=tmp_path)

    def test_analysis_json_upload_failure_raises_for_retry(self, tmp_path):
        rec = _Recorder()
        rec.fail_status["analysis.json"] = 500
        job = jobrun.job_from_spec(_spec())

        def fake_run(req, on_event=None):
            return _result(Path(req.out_dir))

        with pytest.raises(RuntimeError, match="analysis.json"):
            jobrun.run_queue_job(job, send=rec, fetch=_fake_fetch(tmp_path),
                                 pipeline_run=fake_run, scratch_root=tmp_path)

    def test_unrecognized_optional_artifact_is_skipped_not_fatal(self, tmp_path):
        rec = _Recorder()
        rec.fail_status["framestamp.mp4"] = 400
        job = jobrun.job_from_spec(_spec())

        def fake_run(req, on_event=None):
            return _result(Path(req.out_dir),
                           names=("analysis.json", "framestamp.mp4"))

        ok = jobrun.run_queue_job(job, send=rec, fetch=_fake_fetch(tmp_path),
                                  pipeline_run=fake_run, scratch_root=tmp_path)
        assert ok is True
        assert [e["kind"] for e in rec.events()][-1] == "done"

    def test_progress_posts_are_best_effort_but_terminal_is_not(self, tmp_path):
        rec = _Recorder()
        job = jobrun.job_from_spec(_spec())
        seen = {"n": 0}

        def flaky_send(method, url, **kw):
            if url.endswith("/events"):
                seen["n"] += 1
                data = kw.get("data") or b""
                if b'"done"' in data:
                    return 200, b"{}"
                raise OSError("events endpoint blipped")
            return rec(method, url, **kw)

        def fake_run(req, on_event=None):
            on_event(PipelineEvent(kind="stage_started", stage="probe"))
            return _result(Path(req.out_dir))

        ok = jobrun.run_queue_job(job, send=flaky_send, fetch=_fake_fetch(tmp_path),
                                  pipeline_run=fake_run, scratch_root=tmp_path)
        assert ok is True  # the analysis survived the blip; only the terminal post is load-bearing

    def test_per_frame_progress_is_throttled(self, tmp_path):
        job = jobrun.job_from_spec(_spec())
        rec = _Recorder()
        clock = {"t": 0.0}
        fwd = jobrun._EventForwarder(job, rec, clock=lambda: clock["t"])
        for i in range(10):
            fwd(PipelineEvent(kind="stage_progress", stage="pose", done=i, total=10))
            clock["t"] += 0.5
        # 5 seconds of half-second ticks at a 2s throttle -> 3 posts, not 10
        assert len(rec.events()) == 3


class TestRedirectAuth:
    """The bearer must not follow the source redirect to storage.

    A presigned URL authenticates in its query string; an extra `Authorization` header makes
    S3/R2 reject the request with 400 — which is exactly how the first hosted swing died
    (2026-08-23), after the source download had otherwise worked all year against Supabase
    Storage, which ignored the stray header.
    """

    def _handler(self):
        from service.jobrun import _DropAuthAcrossHosts
        return _DropAuthAcrossHosts()

    def _req(self):
        import urllib.request
        req = urllib.request.Request("https://app.example.com/api/internal/jobs/1/source")
        req.add_header("Authorization", "Bearer job-token")
        return req

    def test_bearer_is_dropped_when_the_redirect_leaves_our_host(self):
        new = self._handler().redirect_request(
            self._req(), None, 307, "Temporary Redirect", {},
            "https://acct.r2.cloudflarestorage.com/swing-source/x?X-Amz-Signature=abc",
        )
        assert [k for k in new.headers if k.lower() == "authorization"] == []
        assert [k for k in new.unredirected_hdrs if k.lower() == "authorization"] == []

    def test_bearer_survives_a_redirect_within_our_own_host(self):
        new = self._handler().redirect_request(
            self._req(), None, 307, "Temporary Redirect", {},
            "https://app.example.com/api/internal/jobs/1/source-v2",
        )
        assert [k for k in new.headers if k.lower() == "authorization"] == ["Authorization"]


class TestFailureClassification:
    """Retry what a retry can fix; ANSWER everything else immediately.

    Before this, every infra failure was one shape — raise, let the delivery layer run the
    whole analysis again, and if it never recovered let the orphan sweep settle the job with
    "the worker went silent mid-analysis". A golfer was told that when the real answer was a
    400 on the first byte, known one second in (2026-08-23).
    """

    def test_server_errors_and_throttling_are_retryable(self):
        from service.jobrun import classify_status
        for status in (500, 502, 503, 504, 429, 408):
            assert classify_status(status, "x").retryable, status

    def test_client_errors_are_answers_not_retries(self):
        from service.jobrun import classify_status
        for status in (400, 401, 403, 404, 422):
            assert not classify_status(status, "x").retryable, status

    def test_every_classification_carries_a_sentence_for_the_golfer(self):
        from service.jobrun import classify_status
        for status in (400, 401, 404, 503):
            msg = classify_status(status, "source download").user_message
            assert msg and str(status) not in msg, status

    def test_with_retries_gives_up_immediately_on_an_unretryable_failure(self):
        from service.jobrun import TransferError, with_retries
        calls = []

        def fn():
            calls.append(1)
            raise TransferError("nope", retryable=False)

        with pytest.raises(TransferError):
            with_retries(fn, sleep=lambda _: None)
        assert len(calls) == 1

    def test_with_retries_rides_out_a_blip(self):
        from service.jobrun import TransferError, with_retries
        calls = []

        def fn():
            calls.append(1)
            if len(calls) < 3:
                raise TransferError("busy", retryable=True)
            return "ok"

        assert with_retries(fn, sleep=lambda _: None) == "ok"
        assert len(calls) == 3

    def test_an_unretryable_download_failure_reports_terminally_and_does_not_raise(self):
        """The whole point: the job ANSWERS instead of going quiet."""
        from service.jobrun import QueueJob, TransferError, run_queue_job

        posted = []

        def send(method, url, *, token, data=None, content_type=None, timeout_s=None):
            posted.append(json.loads(data) if data else None)
            return 200, b"{}"

        def fetch(url, token, dest):
            raise TransferError("source download returned 400", retryable=False,
                                user_message="This swing's video could not be read for analysis.")

        job = QueueJob(id="j1", token="t", source_url="u", artifact_base_url="a",
                       events_url="e", analysis={"view": "dtl", "handedness": "right",
                                                 "club_detector": None})
        assert run_queue_job(job, send=send, fetch=fetch) is False
        terminal = [p for p in posted if p and p.get("kind") == "failed"]
        assert len(terminal) == 1
        assert terminal[0]["reason"] == "This swing's video could not be read for analysis."

    def test_a_retryable_download_failure_still_raises_for_the_delivery_layer(self):
        from service.jobrun import QueueJob, TransferError, run_queue_job

        def send(method, url, *, token, data=None, content_type=None, timeout_s=None):
            return 200, b"{}"

        def fetch(url, token, dest):
            raise TransferError("503", retryable=True)

        job = QueueJob(id="j2", token="t", source_url="u", artifact_base_url="a",
                       events_url="e", analysis={"view": "dtl", "handedness": "right",
                                                 "club_detector": None})
        with pytest.raises(TransferError):
            run_queue_job(job, send=send, fetch=fetch)
