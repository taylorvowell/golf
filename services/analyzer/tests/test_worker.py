"""The worker's job spec and the pipeline request stay in lockstep.

`service.worker.request_from_spec` is the machine-facing twin of burnin.py's flag parsing:
same fields, same defaults, strict where a human CLI is forgiving. These tests pin the
strictness (unknown fields and wrong schema versions refuse, they never default) and the
JSON-line event shape, with the pipeline itself monkeypatched — no video runs here.
"""
from __future__ import annotations

import dataclasses
import io
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from swingsage.pipeline import AnalysisRequest, PipelineError, PipelineEvent, PipelineResult  # noqa: E402
from service import worker  # noqa: E402


def _spec(**kw):
    base = {"schema": worker.SPEC_SCHEMA, "video": "fixtures/clip.mp4"}
    base.update(kw)
    return base


class TestRequestFromSpec:
    def test_minimal_spec_gets_dataclass_defaults(self):
        req = worker.request_from_spec(_spec())
        assert req == AnalysisRequest(video=Path("fixtures/clip.mp4"))

    def test_every_request_field_is_spec_settable(self):
        # The spec surface is derived from the dataclass; prove no field got orphaned.
        assert set(worker._REQUEST_FIELDS) == {
            f.name for f in dataclasses.fields(AnalysisRequest)
        }

    def test_fields_round_trip(self):
        req = worker.request_from_spec(
            _spec(
                out_dir="out/clip",
                view="face_on",
                handedness="left",
                club_type="driver",
                club_detector="runs/clubhead/weights/best.pt",
                scoring=False,
                club_detector_conf=0.4,
            )
        )
        assert req.out_dir == Path("out/clip")
        assert req.view == "face_on"
        assert req.handedness == "left"
        assert req.club_type == "driver"
        assert req.club_detector == "runs/clubhead/weights/best.pt"
        assert req.scoring is False
        assert req.club_detector_conf == 0.4

    def test_club_detector_never_defaults(self):
        # The standing trap: an omitted detector is the classical-only path, not a
        # weights file discovered on disk.
        req = worker.request_from_spec(_spec())
        assert req.club_detector is None

    def test_unknown_field_refuses(self):
        with pytest.raises(worker.SpecError, match="unknown job spec field.*handednes"):
            worker.request_from_spec(_spec(handednes="left"))

    def test_wrong_schema_refuses(self):
        with pytest.raises(worker.SpecError, match="unsupported job spec schema"):
            worker.request_from_spec({"schema": 0, "video": "x.mp4"})
        with pytest.raises(worker.SpecError, match="unsupported job spec schema"):
            worker.request_from_spec({"video": "x.mp4"})

    def test_missing_video_refuses(self):
        with pytest.raises(worker.SpecError, match="missing required field 'video'"):
            worker.request_from_spec({"schema": worker.SPEC_SCHEMA})

    def test_bad_choice_refuses(self):
        with pytest.raises(worker.SpecError, match="invalid view"):
            worker.request_from_spec(_spec(view="behind"))
        with pytest.raises(worker.SpecError, match="invalid handedness"):
            worker.request_from_spec(_spec(handedness="ambi"))

    def test_non_object_refuses(self):
        with pytest.raises(worker.SpecError, match="must be a JSON object"):
            worker.request_from_spec(["not", "a", "dict"])


def _lines(buf: io.StringIO) -> list[dict]:
    return [json.loads(line) for line in buf.getvalue().splitlines()]


class TestRunSpec:
    def test_events_and_result_are_json_lines(self, monkeypatch):
        events = [
            PipelineEvent(kind="stage_started", stage="normalize"),
            PipelineEvent(kind="stage_progress", stage="pose", done=3, total=10),
            PipelineEvent(kind="stage_done", stage="pose", message="10 frames"),
        ]

        def fake_run(req, on_event=None):
            assert req.video == Path("fixtures/clip.mp4")
            for ev in events:
                on_event(ev)
            return PipelineResult(
                out_dir=Path("out/clip"),
                artifacts=(Path("out/clip/analysis.json"),),
                schema_version=9,
                elapsed_s=1.5,
                warnings=("low club coverage",),
            )

        monkeypatch.setattr(worker, "run", fake_run)
        buf = io.StringIO()
        code = worker.run_spec(_spec(), out=buf)

        assert code == 0
        lines = _lines(buf)
        assert lines[0] == {"kind": "stage_started", "stage": "normalize"}
        assert lines[1] == {"kind": "stage_progress", "stage": "pose", "done": 3, "total": 10}
        assert lines[2] == {"kind": "stage_done", "stage": "pose", "message": "10 frames"}
        assert lines[3]["kind"] == "result"
        assert lines[3]["out_dir"] == str(Path("out/clip"))
        assert lines[3]["schema_version"] == 9
        assert lines[3]["warnings"] == ["low club coverage"]

    def test_pipeline_error_fails_with_reason(self, monkeypatch):
        def fake_run(req, on_event=None):
            raise PipelineError("output dir is locked by pid 123")

        monkeypatch.setattr(worker, "run", fake_run)
        buf = io.StringIO()
        code = worker.run_spec(_spec(), out=buf)

        assert code == 1
        (line,) = _lines(buf)
        assert line == {
            "kind": "failed",
            "reason": "output dir is locked by pid 123",
            "where": "pipeline",
        }

    def test_bad_spec_fails_without_running(self, monkeypatch):
        def explode(req, on_event=None):  # pragma: no cover - must not be reached
            raise AssertionError("pipeline ran on an invalid spec")

        monkeypatch.setattr(worker, "run", explode)
        buf = io.StringIO()
        code = worker.run_spec({"schema": 1, "video": "x.mp4", "bogus": True}, out=buf)

        assert code == 2
        (line,) = _lines(buf)
        assert line["kind"] == "failed"
        assert line["where"] == "spec"
        assert "bogus" in line["reason"]
