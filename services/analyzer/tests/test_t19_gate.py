"""t19 legacy-gated-by-isolation + foot exclusion (isolation.py) — hermetic."""
from __future__ import annotations

import numpy as np

from swingsage.club_tracking import ClubTrackingContext, available
from swingsage.club_tracking.tests_impl.t19_legacy_isolation_gate import (
    LegacyIsolationGateTracker, near_rings)
from swingsage.isolation import foot_positions, frame_rings

FPS = 60.0
W, H = 360, 640

SQUARE = [[[0.4, 0.4], [0.6, 0.4], [0.6, 0.6], [0.4, 0.6]]]


class TestNearRings:
    def test_inside_and_margin(self):
        assert near_rings(0.5, 0.5, SQUARE)
        assert near_rings(0.62, 0.5, SQUARE)      # within 0.03 margin
        assert not near_rings(0.7, 0.5, SQUARE)
        assert not near_rings(0.5, 0.5, [])


def _make_doc(n=40):
    names = ["kp", "grip_center"]
    frames = [{"f": f, "kp": [[0.0, 0.0, 0.0], [0.5, 0.5, 0.9]], "st": 1,
               "interp": False} for f in range(n)]
    club = []
    for f in range(n):
        # heads march right; frames 10-14 jump to a bogus corner spot
        x = 0.45 + 0.004 * f if not 10 <= f < 15 else 0.9
        club.append({"f": f, "head": [x, 0.5], "conf": 0.8, "interp": False})
    return {
        "video": {"fps": FPS, "frame_count": n, "width": W, "height": H,
                  "view": "dtl", "handedness": "right", "source": {"path": "x.mp4"}},
        "pose": {"model": "synthetic", "keypoint_names": names, "frames": frames},
        "events": {"address": {"frame": 0, "conf": 0.9},
                   "top": {"frame": 20, "conf": 0.5},
                   "impact": {"frame": n - 1, "conf": 0.9}},
        "club": {"frames": club},
    }


class TestT19:
    def test_registered(self):
        assert "t19_legacy_isolation_gate" in available()

    def test_gate_rejects_heads_outside_isolation(self):
        # isolation says the club is around the marching track, never at 0.9
        rings = {f: [[[0.35, 0.42], [0.75, 0.42], [0.75, 0.58], [0.35, 0.58]]]
                 for f in range(40)}
        ctx = ClubTrackingContext.from_artifacts(_make_doc())
        res = LegacyIsolationGateTracker(rings_by_frame=rings).run(ctx)
        frames = {o.frame for o in res.observations}
        assert not frames & set(range(10, 15)), "bogus heads survived the gate"
        assert res.diagnostics["rejected"] == 5
        assert all(o.mode == "observed" for o in res.observations)

    def test_no_rings_frame_kept_at_reduced_confidence(self):
        rings = {f: [[[0.35, 0.42], [0.75, 0.42], [0.75, 0.58], [0.35, 0.58]]]
                 for f in range(40) if f != 5}
        rings[5] = []
        ctx = ClubTrackingContext.from_artifacts(_make_doc())
        res = LegacyIsolationGateTracker(rings_by_frame=rings).run(ctx)
        o5 = next(o for o in res.observations if o.frame == 5)
        assert o5.mode == "mixed" and o5.confidence < 0.8
        assert res.diagnostics["unverifiable"] >= 1

    def test_no_artifact_honest(self):
        ctx = ClubTrackingContext.from_artifacts(_make_doc())
        res = LegacyIsolationGateTracker(rings_by_frame=None).run(ctx)
        assert res.observations == []
        assert res.diagnostics["reason"] == "no_club_only_artifact"


class TestFootExclusion:
    def test_motion_at_feet_dropped_from_club_view(self):
        a = np.zeros((H, W), dtype=np.float32)
        b = np.zeros((H, W), dtype=np.float32)
        b[600:620, 170:200] = 255.0               # shoe shuffle at the feet
        b[250:262, 250:262] = 255.0               # the club, well away from feet
        body = [[[150 / W, 300 / H], [210 / W, 300 / H],
                 [210 / W, 620 / H], [150 / W, 620 / H]]]
        feet = [(180 / W, 610 / H)]
        union, club = frame_rings(a, b, body, grip=(230 / W, 300 / H), feet=feet)

        import cv2
        m = np.zeros((H, W), dtype=np.uint8)
        polys = [np.round(np.array(r) * [W, H]).astype(np.int32) for r in club]
        if polys:
            cv2.fillPoly(m, polys, 1)
        assert m[256, 256], "the real club vanished"
        assert not m[610, 185], "foot motion leaked into the club view"

    def test_foot_positions_extraction(self):
        names = ["nose", "left_ankle", "right_ankle", "left_heel"]
        kp = [[0.5, 0.1, 0.9], [0.4, 0.9, 0.8], [0.6, 0.9, 0.2], [0.41, 0.93, 0.7]]
        feet = foot_positions(kp, names)
        assert (0.4, 0.9) in feet and (0.41, 0.93) in feet
        assert (0.6, 0.9) not in feet             # below confidence gate
