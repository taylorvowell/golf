"""The pipeline entry point and its CLI stay in lockstep.

`swingsage.pipeline.AnalysisRequest` and `scripts/burnin.py`'s flags describe the same run
two ways. These tests fail the moment a default drifts between them — the failure mode that
would otherwise ship silently, because both sides keep "working" alone and disagree only
when the worker and the CLI analyse the same clip differently.
"""
from __future__ import annotations

import importlib.util
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from swingsage.pipeline import AnalysisRequest, OutputLock, PipelineError  # noqa: E402


def _load_burnin():
    scripts = Path(__file__).resolve().parents[1] / "scripts"
    spec = importlib.util.spec_from_file_location("burnin", scripts / "burnin.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


burnin = _load_burnin()


def test_cli_defaults_match_request_defaults():
    """Parsing only the required positional must produce a request identical to the
    dataclass defaults — otherwise the CLI and the worker run different pipelines."""
    args = burnin.build_parser().parse_args(["clip.mp4"])
    from_cli = burnin.request_from_args(args)
    assert from_cli == AnalysisRequest(video=Path("clip.mp4"))


def test_no_flags_flip_their_fields():
    args = burnin.build_parser().parse_args([
        "clip.mp4", "--no-scoring", "--no-retry", "--no-silhouette", "--no-stage3",
        "--no-club", "--no-club-takeaway", "--no-club-variants", "--no-wholebody",
    ])
    req = burnin.request_from_args(args)
    assert not req.scoring and not req.retry and not req.silhouette and not req.stage3
    assert not req.club and not req.club_takeaway
    assert not req.club_variants and not req.wholebody


def test_value_flags_thread_through():
    args = burnin.build_parser().parse_args([
        "clip.mp4", "--out", "somewhere", "--view", "face_on", "--handedness", "left",
        "--club-type", "driver", "--scoring-config", "v1",
        "--club-detector", "weights.pt", "--club-detector-conf", "0.4",
        "--club-takeaway-lookback", "20",
    ])
    req = burnin.request_from_args(args)
    assert req.out_dir == Path("somewhere")
    assert req.view == "face_on" and req.handedness == "left"
    assert req.club_type == "driver" and req.scoring_config == "v1"
    assert req.club_detector == "weights.pt"
    assert req.club_detector_conf == pytest.approx(0.4)
    assert req.club_takeaway_lookback == 20


def test_club_detector_has_no_default():
    """The classical-only path must stay the explicit default — weights are never picked up
    from disk implicitly (the silent-overwrite trap CLAUDE.md names)."""
    assert AnalysisRequest(video=Path("x.mp4")).club_detector is None
    assert burnin.build_parser().parse_args(["x.mp4"]).club_detector is None


def test_output_lock_refuses_live_pid(tmp_path):
    """A lock held by a running pid is a refusal with a readable reason, not a crash —
    and it is PipelineError now, so a worker can catch it and fail the job cleanly."""
    (tmp_path / ".analysis.lock").write_text(f"{os.getpid()} 0\n", encoding="utf-8")
    with pytest.raises(PipelineError, match="another analysis is already running"):
        OutputLock(tmp_path).__enter__()


def test_output_lock_clears_stale_pid(tmp_path):
    (tmp_path / ".analysis.lock").write_text("999999999 0\n", encoding="utf-8")
    with OutputLock(tmp_path):
        assert (tmp_path / ".analysis.lock").exists()
    assert not (tmp_path / ".analysis.lock").exists()
