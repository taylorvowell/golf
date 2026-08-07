"""t26 gated + deduped — composition of the t22 dedupe and t25 gate."""
from __future__ import annotations

from swingsage.club_tracking import ClubTrackingContext, available
from swingsage.club_tracking.tests_impl.t26_gated_dedup import GatedDedupTracker

FPS = 60.0
CORRIDOR = [[[0.2, 0.5], [0.8, 0.5], [0.8, 0.7], [0.2, 0.7]]]


def _make_doc(n=60):
    names = ["kp", "grip_center"]
    frames = [{"f": f, "kp": [[0.0, 0.0, 0.0], [0.5, 0.5, 0.9]], "st": 1,
               "interp": False} for f in range(n)]
    # reds on even frames < 30 only; legacy everywhere hugging the red path,
    # except 45-47 where it jumps outside the isolation corridor
    boxes = [{"f": f, "d": [{"c": 0, "xy": [0.3 + 0.005 * f, 0.6],
                             "wh": [0.02, 0.02], "p": 0.85},
                            {"c": 1, "xy": [0.45, 0.6], "wh": [0.6, 0.25], "p": 0.9}]}
             for f in range(0, 30, 2)]
    legacy = []
    for f in range(n):
        y = 0.9 if 45 <= f <= 47 else 0.602
        legacy.append({"f": f, "head": [0.3 + 0.005 * f, y], "conf": 0.7,
                       "interp": False})
    return {
        "video": {"fps": FPS, "frame_count": n, "width": 720, "height": 1280,
                  "view": "dtl", "handedness": "right", "source": {"path": "x.mp4"}},
        "pose": {"model": "synthetic", "keypoint_names": names, "frames": frames},
        "events": {"address": {"frame": 0, "conf": 0.9},
                   "top": {"frame": 25, "conf": 0.5},
                   "impact": {"frame": 59, "conf": 0.9}},
        "club": {"frames": legacy,
                 "detector": {"names": {"0": "clubhead"}, "boxes": boxes}},
    }


def test_registered():
    assert "t26_gated_dedup" in available()


def test_dedupe_then_gate():
    rings = {f: CORRIDOR for f in range(60)}
    ctx = ClubTrackingContext.from_artifacts(_make_doc())
    res = GatedDedupTracker(loader=lambda *a: None, raw_models_doc=None,
                            rings_by_frame=rings).run(ctx)
    by = {o.frame: o for o in res.observations}
    # reds rule their frames
    for f in range(0, 30, 2):
        assert by[f].source == "detector"
    # legacy hugging reds (odd frames < 30) deduped away
    assert not any(f in by for f in range(1, 28, 2))
    assert res.diagnostics["legacy_deduped"] >= 28
    # legacy past the reds is kept... except the out-of-corridor jump at 45-47
    for f in range(33, 45):
        assert by[f].source == "classical"
    assert not {45, 46, 47} & set(by), "out-of-isolation legacy survived"
    assert res.diagnostics["legacy_out"] == 3


def test_no_artifact_honest():
    ctx = ClubTrackingContext.from_artifacts(_make_doc())
    res = GatedDedupTracker(loader=lambda *a: None, raw_models_doc=None,
                            rings_by_frame=None).run(ctx)
    assert res.diagnostics["reason"] == "no_club_only_artifact"
