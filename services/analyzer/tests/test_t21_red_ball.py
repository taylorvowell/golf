"""t21 red boxes + legacy fill + ball impact — hermetic."""
from __future__ import annotations

import numpy as np

from swingsage.club_tracking import ClubTrackingContext, available
from swingsage.club_tracking.ball_departure import departure_frame, find_ball_spot
from swingsage.club_tracking.tests_impl.t21_red_ball import RedBallTracker

FPS = 60.0
W, H = 360, 640
BALL = (0.62, 0.82)


def _raw_models_doc():
    frames = [{"f": f, "d": [{"c": 1, "xy": [BALL[0] + 0.001, BALL[1]],
                              "wh": [0.02, 0.02], "p": 0.9, "label": "golf_ball"}]}
              for f in range(0, 18, 3)]
    return {"schema": 1, "models": {"rf_driver": {"label": "x", "stride": 3,
                                                  "frames": frames}}}


class TestBallSpot:
    def test_median_of_ball_detections(self):
        spot = find_ball_spot(_raw_models_doc(), address_frame=0)
        assert spot is not None
        assert abs(spot[0] - (BALL[0] + 0.001)) < 1e-6

    def test_too_few_or_missing(self):
        assert find_ball_spot(None, 0) is None
        assert find_ball_spot({"models": {}}, 0) is None


def _gray_stack(n, departure=None, occlusion=None):
    """Ball drawn at BALL until `departure`; `occlusion` covers it for 2 frames only."""
    g = np.zeros((n, H, W), dtype=np.float32)
    bx, by = int(BALL[0] * W), int(BALL[1] * H)
    for f in range(n):
        gone = departure is not None and f >= departure
        occluded = occlusion is not None and occlusion <= f < occlusion + 2
        if not gone and not occluded:
            g[f, by - 4:by + 5, bx - 4:bx + 5] = 255.0
    return g


class TestDeparture:
    def test_departure_found(self):
        g = _gray_stack(60, departure=42)
        assert departure_frame(g, 0, BALL, address_frame=0, search_from=20) == 42

    def test_club_occlusion_not_departure(self):
        g = _gray_stack(60, departure=45, occlusion=30)
        assert departure_frame(g, 0, BALL, address_frame=0, search_from=20) == 45

    def test_ball_never_leaves(self):
        g = _gray_stack(60)
        assert departure_frame(g, 0, BALL, address_frame=0, search_from=20) is None


def _make_doc(n=60):
    names = ["kp", "grip_center"]
    frames = [{"f": f, "kp": [[0.0, 0.0, 0.0], [0.5, 0.5, 0.9]], "st": 1,
               "interp": False} for f in range(n)]
    # red boxes everywhere EXCEPT a downswing hole at 40-46
    boxes = [{"f": f, "d": [{"c": 0, "xy": [0.3 + 0.005 * f, 0.6],
                             "wh": [0.02, 0.02], "p": 0.8}]}
             for f in range(n) if not 40 <= f < 47]
    legacy = [{"f": f, "head": [0.3 + 0.005 * f, 0.61], "conf": 0.7,
               "interp": False} for f in range(n)]
    return {
        "video": {"fps": FPS, "frame_count": n, "width": W, "height": H,
                  "view": "dtl", "handedness": "right", "source": {"path": "x.mp4"}},
        "pose": {"model": "synthetic", "keypoint_names": names, "frames": frames},
        "events": {"address": {"frame": 0, "conf": 0.9},
                   "top": {"frame": 30, "conf": 0.5},
                   "impact": {"frame": 55, "conf": 0.9}},
        "club": {"frames": legacy,
                 "detector": {"names": {"0": "clubhead"}, "boxes": boxes}},
    }


def _loader(dep):
    def load(ctx, lo, hi):
        g = _gray_stack(hi - lo + 1, departure=dep - lo if dep is not None else None)
        return np.repeat(g[..., None], 3, axis=3)
    return load


class TestTracker:
    def test_registered(self):
        assert "t21_red_legacy_ball" in available()

    def test_red_primary_legacy_fills_downswing_ball_marks_impact(self):
        ctx = ClubTrackingContext.from_artifacts(_make_doc())
        tr = RedBallTracker(loader=_loader(50), raw_models_doc=_raw_models_doc())
        res = tr.run(ctx)
        by = {o.frame: o for o in res.observations}
        # red boxes are observed
        assert by[20].source == "detector" and by[20].mode == "observed"
        # downswing hole filled from legacy at reduced confidence
        for f in range(40, 47):
            assert by[f].source == "classical" and by[f].mode == "mixed"
        assert res.diagnostics["legacy_filled"] == 7
        # ball departure at 50 -> impact evidence at 49
        imp = [e for e in res.event_evidence if e.event == "impact"]
        assert imp and imp[0].source == "ball_departure"
        assert abs(imp[0].time_s - 49 / FPS) < 1e-9
        assert res.diagnostics["ball_departure_frame"] == 50

    def test_no_ball_no_evidence_but_trace_stands(self):
        ctx = ClubTrackingContext.from_artifacts(_make_doc())
        tr = RedBallTracker(loader=_loader(None), raw_models_doc=None)
        res = tr.run(ctx)
        assert res.observations
        assert res.event_evidence == []
        assert res.diagnostics["ball_spot"] is None
