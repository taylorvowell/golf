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

from swingsage import frames, video  # noqa: E402
from swingsage.pipeline import PipelineError, PipelineEvent, PipelineResult  # noqa: E402
from service import jobrun  # noqa: E402
from service.worker import SpecError  # noqa: E402


def _info(**over):
    """A probe result shaped like a healthy trimmed capture — override per test."""
    base = dict(path="source.mp4", width=1080, height=1920, fps=30.0, nominal_fps=30.0,
                frame_count=156, duration=5.2, codec="h264", rotation=0, is_vfr=False)
    base.update(over)
    return video.VideoInfo(**base)


#: Splat into run_queue_job so the guard sees a healthy clip instead of ffprobing fake bytes.
_PROBE_OK = {"probe_source": lambda p: _info(), "probe_capture": lambda p: 0.0}


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
                                  pipeline_run=fake_run, scratch_root=tmp_path, **_PROBE_OK)
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
                             pipeline_run=fake_run, scratch_root=tmp_path, **_PROBE_OK)
        ev = next(e for e in rec.events() if e.get("stage") == "normalize")
        assert ev["progressPct"] == jobrun.STAGE_PCT["normalize"]

    def test_pipeline_refusal_reports_failed_and_completes(self, tmp_path):
        rec = _Recorder()
        job = jobrun.job_from_spec(_spec())

        def fake_run(req, on_event=None):
            raise PipelineError("pose confidence is catastrophically low")

        ok = jobrun.run_queue_job(job, send=rec, fetch=_fake_fetch(tmp_path),
                                  pipeline_run=fake_run, scratch_root=tmp_path, **_PROBE_OK)
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
                                 pipeline_run=fake_run, scratch_root=tmp_path, **_PROBE_OK)

    def test_unrecognized_optional_artifact_is_skipped_not_fatal(self, tmp_path):
        rec = _Recorder()
        rec.fail_status["framestamp.mp4"] = 400
        job = jobrun.job_from_spec(_spec())

        def fake_run(req, on_event=None):
            return _result(Path(req.out_dir),
                           names=("analysis.json", "framestamp.mp4"))

        ok = jobrun.run_queue_job(job, send=rec, fetch=_fake_fetch(tmp_path),
                                  pipeline_run=fake_run, scratch_root=tmp_path, **_PROBE_OK)
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
                                  pipeline_run=fake_run, scratch_root=tmp_path, **_PROBE_OK)
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


class TestWorkloadGuard:
    """Refuse deterministically-oversized work BEFORE the GPU, and never re-run it.

    A single ~41s clip normalized to ~2,445 frames, hit the runner's timeout, and was retried
    to death by Modal — 75 GPU-minutes for one deterministic failure (2026-08-26). The guard
    answers that class at the door for the cost of an ffprobe, as a terminal `failed` the
    delivery layer counts as success-of-delivery (returns False, never raises).
    """

    def test_the_41s_incident_shape_refuses_terminally_with_zero_pipeline_stages(self, tmp_path):
        rec = _Recorder()
        job = jobrun.job_from_spec(_spec())
        ran = {"pipeline": False}

        def fake_run(req, on_event=None):
            ran["pipeline"] = True
            return _result(Path(req.out_dir))

        ok = jobrun.run_queue_job(
            job, send=rec, fetch=_fake_fetch(tmp_path), pipeline_run=fake_run,
            scratch_root=tmp_path,
            probe_source=lambda p: _info(duration=41.6, frame_count=1248),
            probe_capture=lambda p: 0.0,
        )
        # False = the delivery COMPLETED — nothing above this (QStash, modal.Retries) re-runs it.
        assert ok is False
        assert ran["pipeline"] is False
        failed = [e for e in rec.events() if e["kind"] == "failed"]
        assert len(failed) == 1
        # A sentence for the golfer: names the length and the fix, never a code or a threshold var.
        assert "42 seconds" in failed[0]["reason"]
        assert "trim" in failed[0]["reason"].lower()

    def test_the_probed_facts_are_logged_to_the_job_row_either_way(self, tmp_path):
        rec = _Recorder()
        job = jobrun.job_from_spec(_spec())
        jobrun.run_queue_job(
            job, send=rec, fetch=_fake_fetch(tmp_path),
            pipeline_run=lambda req, on_event=None: _result(Path(req.out_dir)),
            scratch_root=tmp_path,
            probe_source=lambda p: _info(duration=41.6),
            probe_capture=lambda p: 0.0,
        )
        # The refusal's evidence is the telemetry that sizes step 02's manifest thresholds.
        # est_frames = 41.6s × 30 (native-rate CFR since the frame-identity step — a 30fps
        # source normalizes AT 30, no longer doubled to 60).
        lines = [e.get("logLine", "") for e in rec.events() if e["kind"] == "progress"]
        guard = [ln for ln in lines if ln.startswith("workload guard:")]
        assert guard and "est_frames=1248" in guard[0] and "real_duration_s=41.6" in guard[0]

    def test_a_stamped_slow_mo_of_the_same_container_length_is_admitted(self, tmp_path):
        # The SAME 41.6s/30fps container with its capture stamp is 5.2 REAL seconds of swing —
        # the retime-aware half of the guard, without which every slow-mo import would refuse.
        rec = _Recorder()
        job = jobrun.job_from_spec(_spec())
        ok = jobrun.run_queue_job(
            job, send=rec, fetch=_fake_fetch(tmp_path),
            pipeline_run=lambda req, on_event=None: _result(Path(req.out_dir)),
            scratch_root=tmp_path,
            probe_source=lambda p: _info(duration=41.6, frame_count=1248),
            probe_capture=lambda p: 240.0,
        )
        assert ok is True
        assert [e["kind"] for e in rec.events()][-1] == "done"

    def test_an_unreadable_source_refuses_terminally_rather_than_retrying(self, tmp_path):
        rec = _Recorder()
        job = jobrun.job_from_spec(_spec())

        def bad_probe(p):
            raise ValueError("moov atom not found")

        ok = jobrun.run_queue_job(
            job, send=rec, fetch=_fake_fetch(tmp_path),
            pipeline_run=lambda req, on_event=None: _result(Path(req.out_dir)),
            scratch_root=tmp_path, probe_source=bad_probe, probe_capture=lambda p: 0.0,
        )
        assert ok is False
        failed = [e for e in rec.events() if e["kind"] == "failed"]
        assert failed and "could not be read" in failed[0]["reason"]

    def test_a_missing_ffprobe_is_an_outage_and_raises_for_retry(self, tmp_path):
        rec = _Recorder()
        job = jobrun.job_from_spec(_spec())

        def no_ffprobe(p):
            raise FileNotFoundError("ffprobe")

        with pytest.raises(OSError):
            jobrun.run_queue_job(
                job, send=rec, fetch=_fake_fetch(tmp_path),
                pipeline_run=lambda req, on_event=None: _result(Path(req.out_dir)),
                scratch_root=tmp_path, probe_source=no_ffprobe, probe_capture=lambda p: 0.0,
            )

    # ---- the decision itself, pure --------------------------------------------------------

    def test_a_healthy_trimmed_capture_is_admitted(self):
        v = jobrun.guard_workload(_info(), 0.0)
        assert v.refusal is None

    def test_a_240fps_real_time_take_is_admitted(self):
        # 6s at 240fps real-time = 1,440 estimated frames — the product's own heaviest shape.
        v = jobrun.guard_workload(
            _info(duration=6.0, fps=237.6, nominal_fps=240.0, frame_count=1440), 0.0)
        assert v.refusal is None
        # Snapped to 240 (never the ~237.6 the HAL really averages), so the estimate is the
        # count the normalize stage would actually emit.
        assert v.facts["target_fps"] == 240
        assert v.facts["est_frames"] == 1440

    def test_the_frame_budget_refuses_what_the_duration_budget_alone_would_admit(self):
        # 14s at 240fps real-time is inside the 15s budget but ~3,360 normalized frames.
        v = jobrun.guard_workload(
            _info(duration=14.0, fps=240.0, nominal_fps=240.0, frame_count=3360), 0.0)
        assert v.refusal is not None
        assert "frames" in v.refusal

    def test_the_plane_budget_is_measured_from_the_analysis_tier(self):
        """The guard's memory input is `frames.estimate_bytes` over the frames the pipeline
        would normalize, at the size it would normalize them TO — not the source resolution."""
        v = jobrun.guard_workload(_info(width=1080, height=1920, duration=10.0), 0.0)
        assert v.facts["analysis_size"] == "720x1280"
        assert v.facts["plane_mb"] == round(
            frames.estimate_bytes(v.facts["est_frames"], 720, 1280) / 1024 / 1024)

    def test_the_plane_budget_refuses_before_the_gpu_rather_than_ooming_mid_job(self,
                                                                               monkeypatch):
        monkeypatch.setenv("SWINGSAGE_GUARD_MAX_PLANE_MB", "64")
        v = jobrun.guard_workload(_info(), 0.0)
        assert v.refusal is not None
        assert v.facts["plane_mb"] > 64

    def test_an_unsupported_codec_is_refused_by_name(self):
        v = jobrun.guard_workload(_info(codec="wmv3"), 0.0)
        assert v.refusal is not None and "wmv3" in v.refusal

    def test_an_oversized_resolution_is_refused(self):
        v = jobrun.guard_workload(_info(width=7680, height=4320), 0.0)
        assert v.refusal is not None and "7680" in v.refusal

    def test_a_zero_length_probe_is_refused(self):
        v = jobrun.guard_workload(_info(duration=0.0), 0.0)
        assert v.refusal is not None

    def test_budgets_are_env_overridable_in_one_place(self, monkeypatch):
        # 60fps so the frame estimate (41.6 × 60 = 2496) sits between the override (4000)
        # and the built-in fallback (2000) — a 30fps clip stopped tripping the fallback when
        # native-rate CFR halved its honest frame count.
        long_60 = _info(duration=41.6, fps=60.0, nominal_fps=60.0)
        monkeypatch.setenv("SWINGSAGE_GUARD_MAX_REAL_S", "60")
        monkeypatch.setenv("SWINGSAGE_GUARD_MAX_FRAMES", "4000")
        v = jobrun.guard_workload(long_60, 0.0)
        assert v.refusal is None
        monkeypatch.setenv("SWINGSAGE_GUARD_MAX_FRAMES", "junk")  # bad values fall back
        v = jobrun.guard_workload(long_60, 0.0)
        assert v.refusal is not None


class TestManifestCaptureFacts:
    """The source manifest's capture facts, threaded through the spec (step 02).

    The phone-side remux DROPS `com.android.capture.fps`, so a trimmed slow-mo import reaches
    this worker with no tag: 41.6 container-seconds of 30fps video that is really 5.2 seconds
    of swing. The spec's `capture_fps` (read from the manifest by the enqueue side) is what
    lets the guard and the retime see the truth — and a manifest describing a DIFFERENT video
    is terminal, because retiming by the wrong factor scores garbage confidently.
    """

    def test_spec_accepts_the_capture_fact_fields(self):
        spec = _spec()
        spec["analysis"]["capture_fps"] = 240.0
        spec["analysis"]["source_fps"] = 30.0
        job = jobrun.job_from_spec(spec)
        assert job.analysis["capture_fps"] == 240.0

    def test_manifest_capture_fps_admits_the_tagless_trimmed_slow_mo(self, tmp_path):
        # THE incident class: container tag gone (probe_capture -> 0), manifest says 240.
        rec = _Recorder()
        spec = _spec()
        spec["analysis"]["capture_fps"] = 240.0
        spec["analysis"]["source_fps"] = 30.0
        job = jobrun.job_from_spec(spec)
        ok = jobrun.run_queue_job(
            job, send=rec, fetch=_fake_fetch(tmp_path),
            pipeline_run=lambda req, on_event=None: _result(Path(req.out_dir)),
            scratch_root=tmp_path,
            probe_source=lambda p: _info(duration=41.6, frame_count=1248),
            probe_capture=lambda p: 0.0,
        )
        assert ok is True
        assert [e["kind"] for e in rec.events()][-1] == "done"

    def test_without_the_manifest_the_same_clip_still_refuses(self, tmp_path):
        # The step-01 behavior is unchanged for manifest-less uploads — never worse than today.
        rec = _Recorder()
        job = jobrun.job_from_spec(_spec())
        ok = jobrun.run_queue_job(
            job, send=rec, fetch=_fake_fetch(tmp_path),
            pipeline_run=lambda req, on_event=None: _result(Path(req.out_dir)),
            scratch_root=tmp_path,
            probe_source=lambda p: _info(duration=41.6, frame_count=1248),
            probe_capture=lambda p: 0.0,
        )
        assert ok is False

    def test_a_manifest_contradicting_the_probe_is_terminal(self, tmp_path):
        rec = _Recorder()
        spec = _spec()
        spec["analysis"]["capture_fps"] = 240.0
        spec["analysis"]["source_fps"] = 240.0  # the manifest claims a 240fps container...
        job = jobrun.job_from_spec(spec)
        ok = jobrun.run_queue_job(
            job, send=rec, fetch=_fake_fetch(tmp_path),
            pipeline_run=lambda req, on_event=None: _result(Path(req.out_dir)),
            scratch_root=tmp_path,
            probe_source=lambda p: _info(),  # ...but the file plays at 30
            probe_capture=lambda p: 0.0,
        )
        assert ok is False
        failed = [e for e in rec.events() if e["kind"] == "failed"]
        assert failed and "does not match" in failed[0]["reason"]

    def test_the_guard_log_carries_both_capture_readings(self, tmp_path):
        rec = _Recorder()
        spec = _spec()
        spec["analysis"]["capture_fps"] = 240.0
        spec["analysis"]["source_fps"] = 30.0
        job = jobrun.job_from_spec(spec)
        jobrun.run_queue_job(
            job, send=rec, fetch=_fake_fetch(tmp_path),
            pipeline_run=lambda req, on_event=None: _result(Path(req.out_dir)),
            scratch_root=tmp_path,
            probe_source=lambda p: _info(duration=41.6, frame_count=1248),
            probe_capture=lambda p: 0.0,
        )
        lines = [e.get("logLine", "") for e in rec.events() if e["kind"] == "progress"]
        guard = [ln for ln in lines if ln.startswith("workload guard:")]
        assert guard and "manifest_capture_fps=240.0" in guard[0]
        assert "tag_capture_fps=0.0" in guard[0]


class TestStageTelemetry:
    """The per-stage record that rides on the terminal event (step 05).

    Before it, the only structured duration that survived a job was `elapsed_s`; per-stage
    wall clock was printed to stdout and discarded, so "which stage is the p95 spent in" could
    only be answered by string-scanning a log ring — and only for the stages one runner's
    regexes happened to cover.
    """

    def _run(self, tmp_path, rec, stage_events=(), fail=False):
        job = jobrun.job_from_spec(_spec())

        def fake_run(req, on_event=None):
            for ev in stage_events:
                on_event(ev)
            if fail:
                from swingsage.pipeline import PipelineError
                raise PipelineError("refused")
            return _result(Path(req.out_dir))

        return jobrun.run_queue_job(job, send=rec, fetch=_fake_fetch(tmp_path),
                                    pipeline_run=fake_run, scratch_root=tmp_path, **_PROBE_OK)

    def test_done_carries_measured_spans(self, tmp_path):
        rec = _Recorder()
        self._run(tmp_path, rec, [
            PipelineEvent(kind="stage_done", stage="pose", elapsed_s=4.0, frames=300),
            PipelineEvent(kind="stage_done", stage="club", elapsed_s=2.0),
        ])
        m = rec.events()[-1]["stageMetrics"]
        by_stage = {s["stage"]: s for s in m["stages"]}
        assert by_stage["pose"]["seconds"] == 4.0 and by_stage["pose"]["frames"] == 300
        assert by_stage["club"]["seconds"] == 2.0
        assert m["attributedS"] >= 6.0

    def test_the_job_level_stages_are_measured_too(self, tmp_path):
        """download/guard/upload happen outside pipeline.run. Unnamed, they would silently
        become the unattributed remainder."""
        rec = _Recorder()
        self._run(tmp_path, rec)
        named = {s["stage"] for s in rec.events()[-1]["stageMetrics"]["stages"]}
        assert {"download", "guard", "upload"} <= named

    def test_a_nested_stage_is_not_double_counted(self, tmp_path):
        rec = _Recorder()
        self._run(tmp_path, rec, [
            PipelineEvent(kind="stage_done", stage="variants", elapsed_s=7.0, depth=1),
            PipelineEvent(kind="stage_done", stage="club", elapsed_s=10.0),
        ])
        m = rec.events()[-1]["stageMetrics"]
        variants = next(s for s in m["stages"] if s["stage"] == "variants")
        assert variants["nested"] is True
        # club's 10s already contains variants' 7s.
        assert m["attributedS"] < 17.0

    def test_the_record_states_its_own_remainder(self, tmp_path):
        """The remainder is reported rather than hidden — a record that always looked fully
        accounted-for could not show attribution improving, which is the point of measuring.

        Asserted on the accumulator directly: a faked pipeline returns instantly, so a job's
        real wall clock here is milliseconds and any span the fake claims would swamp it.
        """
        acc = jobrun.stages.StageAccumulator()
        acc.add("pose", 30.0)
        acc.add("club", 20.0)
        m = acc.record(total_s=100.0)
        assert m["attributedS"] == 50.0
        assert m["unattributedS"] == 50.0
        assert m["attributedPct"] == 50.0
        assert m["unattributedS"] == round(m["totalS"] - m["attributedS"], 3)

    def test_the_remainder_never_goes_negative(self, tmp_path):
        """Clock skew or a span measured across a boundary must not produce a negative
        remainder, which would read as time appearing from nowhere."""
        acc = jobrun.stages.StageAccumulator()
        acc.add("pose", 10.0)
        assert acc.record(total_s=9.0)["unattributedS"] == 0.0

    def test_a_failed_job_still_reports_where_it_died(self, tmp_path):
        rec = _Recorder()
        ok = self._run(tmp_path, rec, [
            PipelineEvent(kind="stage_done", stage="pose", elapsed_s=3.0),
        ], fail=True)
        assert ok is False
        last = rec.events()[-1]
        assert last["kind"] == "failed"
        assert any(s["stage"] == "pose" for s in last["stageMetrics"]["stages"])

    def test_facts_needed_to_compare_two_jobs_travel_with_them(self, tmp_path):
        rec = _Recorder()
        self._run(tmp_path, rec)
        m = rec.events()[-1]["stageMetrics"]
        # A percentile that mixed fps classes or cold and warm containers would describe no
        # real request, so the record carries what separates them.
        assert "coldStart" in m and "sourceFrames" in m
        assert m["pipelineElapsedS"] == 1.0

    def test_telemetry_never_fails_a_job(self, tmp_path):
        """A bug in measurement ABOUT a job must not be why a finished analysis is lost."""
        rec = _Recorder()
        job = jobrun.job_from_spec(_spec())
        forward = jobrun._EventForwarder(job, rec)

        class Boom:
            def record(self, *a, **k):
                raise RuntimeError("telemetry bug")
        forward.metrics = Boom()
        out = forward.record(0.0, job)
        assert out["schema"] == "stage-metrics" and "error" in out
