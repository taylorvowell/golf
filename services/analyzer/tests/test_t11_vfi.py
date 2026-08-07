"""Test 11 VFI densification (track step 16) — cap law + fake-everything orchestration."""
from __future__ import annotations

import numpy as np

from swingsage.club_tracking import ClubTrackingContext, available
from swingsage.club_tracking.tests_impl.t11_temporal_densification import (
    TemporalDensificationTracker)
from swingsage.club_tracking.vfi import cap_synthetic_conf, synth_midframe

FPS = 60.0
W, H = 360, 640


class TestCapLaw:
    def test_synthetic_never_exceeds_bounds(self):
        assert cap_synthetic_conf(0.99, 0.8, 0.6) <= 0.6 * 0.65 + 1e-9
        assert cap_synthetic_conf(0.10, 0.8, 0.9) == 0.10

    def test_midframe_moves_halfway(self):
        a = np.zeros((H, W, 3), dtype=np.float32)
        b = np.zeros((H, W, 3), dtype=np.float32)
        a[300:310, 100:110] = 255.0
        b[300:310, 140:150] = 255.0
        flow = np.zeros((H, W, 2), dtype=np.float32)
        flow[..., 0] = 40.0
        mid = synth_midframe(a, b, flow)
        ys, xs = np.nonzero(mid[..., 0] > 100)
        assert xs.size and abs(xs.mean() - 125) < 6, "bright patch not at the midpoint"


def _truth(f):
    t = f / FPS
    return 0.5 + 0.25 * np.sin(1.5 * t), 0.5 + 0.2 * np.cos(1.1 * t)


def _make_doc(n=60):
    names = ["kp", "grip_center"]
    frames = [{"f": f, "kp": [[0.0, 0.0, 0.0], [0.5, 0.5, 0.9]], "st": 1,
               "interp": False} for f in range(n)]
    boxes = []
    for f in range(n):
        x, y = _truth(f)
        # sparse real evidence in the downswing: every third frame only
        if f < 30 or f % 3 == 0:
            boxes.append({"f": f, "d": [{"c": 0, "xy": [float(x), float(y)],
                                         "wh": [0.02, 0.02], "p": 0.6},
                                        {"c": 1, "xy": [0.5, 0.5],
                                         "wh": [1.2, 1.2], "p": 0.9}]})
    return {
        "video": {"fps": FPS, "frame_count": n, "width": W, "height": H,
                  "view": "dtl", "handedness": "right", "source": {"path": "x.mp4"}},
        "pose": {"model": "synthetic", "keypoint_names": names, "frames": frames},
        "events": {"address": {"frame": 0, "conf": 0.9},
                   "top": {"frame": 30, "conf": 0.5},
                   "impact": {"frame": n - 1, "conf": 0.9}},
        "club": {"frames": [], "detector": {"names": {"0": "clubhead"},
                                            "boxes": boxes}},
    }


def _fake_loader(ctx, lo, hi):
    v = np.zeros((hi - lo + 1, H, W, 3), dtype=np.float32)
    for i in range(v.shape[0]):
        v[i, 0, 0, 0] = lo + i
    return v


def _fake_flow(a, b):
    return np.zeros((H, W, 2), dtype=np.float32)


def _fake_detector(frame):
    # "detects" the head on the synthetic frame near the midpoint truth, confidently —
    # the cap law must clamp this 0.95 below the real bounds
    f = frame[0, 0, 0]  # midframe averages the two markers -> (a + b)/2 = mid frame idx
    x, y = _truth(float(f))
    return [(float(x), float(y), 0.95)]


class TestTracker:
    def test_registered(self):
        assert "t11_temporal_densification" in available()

    def test_densifies_and_caps(self):
        ctx = ClubTrackingContext.from_artifacts(_make_doc())
        tr = TemporalDensificationTracker(flow_fn=_fake_flow,
                                          detector=_fake_detector,
                                          loader=_fake_loader)
        res = tr.run(ctx)
        assert res.diagnostics["synthetic_candidates"] > 0
        vfi = [o for o in res.observations if o.source == "vfi"]
        for o in vfi:
            assert o.mode == "inferred"
            assert o.confidence <= 0.6 * 0.65 + 1e-6, \
                "synthetic evidence exceeded the §3.10 confidence cap"
        # real detections still dominate the chain
        real = [o for o in res.observations if o.source != "vfi"]
        assert len(real) > len(vfi)

    def test_no_downswing_observations_honest(self):
        doc = _make_doc()
        doc["events"]["top"]["frame"] = doc["events"]["impact"]["frame"] = 59
        ctx = ClubTrackingContext.from_artifacts(doc)
        tr = TemporalDensificationTracker(flow_fn=_fake_flow,
                                          detector=_fake_detector,
                                          loader=_fake_loader)
        res = tr.run(ctx)
        assert res.diagnostics.get("reason") == "no_downswing_observations"
