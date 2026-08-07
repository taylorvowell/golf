"""Endpoint anchoring (user directive) — every trace starts and ends ON the club head."""
from __future__ import annotations

from swingsage.club_tracking import ClubTrackingContext, ClubObservation
from swingsage.club_tracking.anchors import apply_endpoint_anchors
from swingsage.club_tracking.pathfit import fit_variants

FPS = 60.0


def _make_doc(address_head=(0.62, 0.81), impact_head=(0.60, 0.83)):
    n = 60
    names = ["kp", "grip_center"]
    frames = [{"f": f, "kp": [[0.0, 0.0, 0.0], [0.5, 0.5, 0.9]], "st": 1,
               "interp": False} for f in range(n)]
    club_frames = [
        {"f": 5, "head": list(address_head), "conf": 0.85, "interp": False},
        {"f": 54, "head": list(impact_head), "conf": 0.8, "interp": False},
        {"f": 30, "head": [0.4, 0.3], "conf": 0.9, "interp": False},
    ]
    return {
        "video": {"fps": FPS, "frame_count": n, "width": 720, "height": 1280,
                  "view": "dtl", "handedness": "right", "source": {"path": "x.mp4"}},
        "pose": {"model": "synthetic", "keypoint_names": names, "frames": frames},
        "events": {"address": {"frame": 5, "conf": 0.9},
                   "top": {"frame": 30, "conf": 0.5},
                   "impact": {"frame": 55, "conf": 0.9}},
        "club": {"frames": club_frames},
    }


def _obs(frames, x0=0.45):
    return [ClubObservation(frame=f, source_time_s=f / FPS, x=x0 + 0.002 * f,
                            y=0.6 - 0.002 * f, confidence=0.5, mode="observed",
                            source="detector", visibility="visible")
            for f in frames]


class TestAnchoring:
    def test_endpoints_replaced_with_measured_head(self):
        ctx = ClubTrackingContext.from_artifacts(_make_doc())
        # tracker output starts late, ends early, and is offset from the true head
        obs, diag = apply_endpoint_anchors(_obs(range(10, 50)), ctx)
        assert diag == {"address_anchored": True, "impact_anchored": True}
        by = {o.frame: o for o in obs}
        assert (by[5].x, by[5].y) == (0.62, 0.81)          # club head at address
        # impact anchor: nearest measured head to frame 55 is frame 54's
        assert (by[55].x, by[55].y) == (0.60, 0.83)
        assert by[5].mode == "observed" and by[5].confidence >= 0.9

    def test_existing_endpoint_observation_overridden(self):
        ctx = ClubTrackingContext.from_artifacts(_make_doc())
        obs, _ = apply_endpoint_anchors(_obs(range(5, 56)), ctx)
        by = {o.frame: o for o in obs}
        assert (by[5].x, by[5].y) == (0.62, 0.81), "tracker's own point must lose"

    def test_no_measured_head_no_fabrication(self):
        doc = _make_doc()
        doc["club"]["frames"] = []
        ctx = ClubTrackingContext.from_artifacts(doc)
        original = _obs(range(10, 50))
        obs, diag = apply_endpoint_anchors(list(original), ctx)
        assert diag == {"address_anchored": False, "impact_anchored": False}
        assert [o.frame for o in obs] == [o.frame for o in original]

    def test_variants_start_and_end_on_the_anchors(self):
        ctx = ClubTrackingContext.from_artifacts(_make_doc())
        obs, _ = apply_endpoint_anchors(_obs(range(10, 50)), ctx)
        variants = fit_variants(obs, FPS, (5, 55), top_frame=30)
        for vid, pts in variants.items():
            assert pts[0]["frame"] == 5 and pts[-1]["frame"] == 55
            assert abs(pts[0]["x"] - 0.62) < 6e-3 and abs(pts[0]["y"] - 0.81) < 6e-3, \
                f"variant {vid} does not START on the club head"
            assert abs(pts[-1]["x"] - 0.60) < 6e-3 and abs(pts[-1]["y"] - 0.83) < 6e-3, \
                f"variant {vid} does not END on the club head"
