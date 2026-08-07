"""t24 momentum — the corridor physics, hermetically."""
from __future__ import annotations

import numpy as np

from swingsage.club_tracking import available
from swingsage.club_tracking.momentum import momentum_ok, red_velocities
from swingsage.club_tracking.tests_impl.t24_momentum import MomentumTracker

FPS = 60.0

# reds marching steadily right at 0.006/frame (0.36 units/s — above the direction floor)
REDS = {f: (0.30 + 0.006 * f, 0.60) for f in range(0, 40, 4)}


class TestMomentum:
    def setup_method(self):
        self.vels = red_velocities(REDS, FPS)

    def test_velocities_reflect_timing(self):
        vx, vy = self.vels[20]
        assert abs(vx - 0.006 * FPS) < 1e-6 and abs(vy) < 1e-6

    def test_on_momentum_fill_accepted(self):
        assert momentum_ok(18, 0.30 + 0.006 * 18, 0.60, REDS, self.vels, FPS)

    def test_off_corridor_fill_rejected(self):
        # right frame, but parked far from where momentum says the club is
        assert not momentum_ok(18, 0.30 + 0.006 * 18, 0.75, REDS, self.vels, FPS)

    def test_jagged_direction_rejected(self):
        # one frame after a red, at the corridor edge but BEHIND the club's travel —
        # a ~180 degree turn against 0.36 units/s of momentum
        f = 17
        x = 0.30 + 0.006 * 16 - 0.030
        assert not momentum_ok(f, x, 0.60, REDS, self.vels, FPS)

    def test_no_reds_nothing_to_test(self):
        assert momentum_ok(5, 0.9, 0.9, {}, {}, FPS)


def test_registered_and_catmull_default():
    assert "t24_momentum" in available()
    assert MomentumTracker.default_style == "catmull"


def test_tracker_vetoes_jagged_legacy():
    from swingsage.club_tracking import ClubTrackingContext
    n = 40
    names = ["kp", "grip_center"]
    frames = [{"f": f, "kp": [[0.0, 0.0, 0.0], [0.5, 0.5, 0.9]], "st": 1,
               "interp": False} for f in range(n)]
    boxes = [{"f": f, "d": [{"c": 0, "xy": [0.30 + 0.006 * f, 0.60],
                             "wh": [0.02, 0.02], "p": 0.85},
                            {"c": 1, "xy": [0.5, 0.6], "wh": [1.2, 1.2], "p": 0.9}]}
             for f in range(0, n, 4)]
    legacy = []
    for f in range(n):
        # legacy mostly on-momentum, but frames 21-23 jump wildly off-path
        if 21 <= f <= 23:
            legacy.append({"f": f, "head": [0.8, 0.2], "conf": 0.7, "interp": False})
        else:
            legacy.append({"f": f, "head": [0.30 + 0.006 * f, 0.601], "conf": 0.7,
                           "interp": False})
    doc = {
        "video": {"fps": FPS, "frame_count": n, "width": 720, "height": 1280,
                  "view": "dtl", "handedness": "right", "source": {"path": "x.mp4"}},
        "pose": {"model": "synthetic", "keypoint_names": names, "frames": frames},
        "events": {"address": {"frame": 0, "conf": 0.9},
                   "top": {"frame": 10, "conf": 0.5},
                   "impact": {"frame": n - 1, "conf": 0.9}},
        "club": {"frames": legacy,
                 "detector": {"names": {"0": "clubhead"}, "boxes": boxes}},
    }
    ctx = ClubTrackingContext.from_artifacts(doc)
    res = MomentumTracker(loader=lambda *a: None, raw_models_doc=None).run(ctx)
    by = {o.frame: o for o in res.observations}
    assert not {21, 22, 23} & {f for f, o in by.items() if o.source == "classical"
                               and np.hypot(o.x - 0.8, o.y - 0.2) < 0.01}, \
        "jagged legacy marks survived the momentum veto"
    assert res.diagnostics["momentum_vetoed"] >= 3
    assert res.diagnostics["legacy_filled"] > 0
