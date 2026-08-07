"""t25 gated, red, legacy, ball — the three-verdict isolation gate over the recipe."""
from __future__ import annotations

from swingsage.club_tracking import ClubTrackingContext, available
from swingsage.club_tracking.tests_impl.t25_gated_red_legacy_ball import (
    GatedRedLegacyBallTracker, isolation_verdict)

FPS = 60.0
CORRIDOR = [[[0.25, 0.5], [0.75, 0.5], [0.75, 0.7], [0.25, 0.7]]]


class TestVerdict:
    RINGS = {5: CORRIDOR, 6: []}

    def test_three_verdicts(self):
        assert isolation_verdict(self.RINGS, 5, 0.5, 0.6) == "in"
        assert isolation_verdict(self.RINGS, 5, 0.9, 0.9) == "out"
        assert isolation_verdict(self.RINGS, 6, 0.5, 0.6) == "unverifiable"
        assert isolation_verdict(self.RINGS, 7, 0.5, 0.6) == "unverifiable"


def _make_doc(n=60):
    names = ["kp", "grip_center"]
    frames = [{"f": f, "kp": [[0.0, 0.0, 0.0], [0.5, 0.5, 0.9]], "st": 1,
               "interp": False} for f in range(n)]
    boxes = []
    for f in range(n):
        if 40 <= f < 47:
            continue                     # downswing hole for legacy to fill
        x = 0.3 + 0.005 * f
        # frames 10-12's reds are parked OUTSIDE the corridor (y=0.9)
        y = 0.9 if 10 <= f <= 12 else 0.6
        boxes.append({"f": f, "d": [{"c": 0, "xy": [x, y], "wh": [0.02, 0.02],
                                     "p": 0.85},
                                    {"c": 1, "xy": [0.5, 0.7], "wh": [1.2, 1.2],
                                     "p": 0.9}]})
    legacy = [{"f": f, "head": [0.3 + 0.005 * f, 0.62], "conf": 0.7, "interp": False}
              for f in range(n)]
    return {
        "video": {"fps": FPS, "frame_count": n, "width": 720, "height": 1280,
                  "view": "dtl", "handedness": "right", "source": {"path": "x.mp4"}},
        "pose": {"model": "synthetic", "keypoint_names": names, "frames": frames},
        "events": {"address": {"frame": 0, "conf": 0.9},
                   "top": {"frame": 30, "conf": 0.5},
                   "impact": {"frame": 55, "conf": 0.9}},
        "club": {"frames": legacy,
                 "detector": {"names": {"0": "clubhead"}, "boxes": boxes}},
    }


def test_registered():
    assert "t25_gated_red_legacy_ball" in available()


def test_gate_over_the_whole_recipe():
    # corridor rings on every frame except 20 (unverifiable there)
    rings = {f: CORRIDOR for f in range(60) if f != 20}
    ctx = ClubTrackingContext.from_artifacts(_make_doc())
    tr = GatedRedLegacyBallTracker(loader=lambda *a: None, raw_models_doc=None,
                                   rings_by_frame=rings)
    res = tr.run(ctx)
    by = {o.frame: o for o in res.observations}
    # off-corridor reds died
    assert not {10, 11, 12} & set(by), "out-of-isolation reds survived"
    assert res.diagnostics["red_out"] == 3
    # normal reds observed at full strength
    assert by[8].mode == "observed" and by[8].confidence == 0.85
    # the unverifiable frame kept its red, reduced
    assert by[20].mode == "mixed" and by[20].confidence < 0.85
    # legacy filled the downswing hole, isolation-checked
    for f in range(40, 47):
        assert by[f].source == "classical"
    assert res.diagnostics["legacy_in"] >= 7


def test_no_isolation_artifact_honest():
    ctx = ClubTrackingContext.from_artifacts(_make_doc())
    res = GatedRedLegacyBallTracker(loader=lambda *a: None, raw_models_doc=None,
                                    rings_by_frame=None).run(ctx)
    assert res.diagnostics["reason"] == "no_club_only_artifact"
