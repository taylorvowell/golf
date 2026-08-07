"""Test 2 temporal heatmap (track step 17) — decode math + fake-model orchestration.
Training itself is not a pytest concern (GPU, minutes); these prove the plumbing."""
from __future__ import annotations

import numpy as np

from swingsage.club_tracking import ClubTrackingContext, available
from swingsage.club_tracking.temporal_net import (HEAT_H, HEAT_W, N_STACK,
                                                  decode_heatmap, gaussian_target)
from swingsage.club_tracking.tests_impl.t2_temporal_heatmap import (
    TemporalHeatmapTracker)

FPS = 60.0
W, H = 360, 640


class TestDecode:
    def test_gaussian_round_trip(self):
        t = gaussian_target(0.7, 0.3)
        x, y, peak, ent = decode_heatmap(t)
        assert abs(x - 0.7) < 0.03 and abs(y - 0.3) < 0.03
        assert peak > 12 and ent < 0.6

    def test_flat_heatmap_is_uncertain(self):
        x, y, peak, ent = decode_heatmap(np.ones((HEAT_H, HEAT_W), dtype=np.float32))
        assert peak < 2.0 and ent > 0.9

    def test_empty_heatmap_safe(self):
        x, y, peak, ent = decode_heatmap(np.zeros((HEAT_H, HEAT_W), dtype=np.float32))
        assert (x, y) == (0.5, 0.5) and peak == 0.0


def _truth(f):
    t = f / FPS
    return 0.5 + 0.25 * np.sin(1.5 * t), 0.5 + 0.2 * np.cos(1.1 * t)


def _make_doc(n=40):
    names = ["kp", "grip_center"]
    frames = [{"f": f, "kp": [[0.0, 0.0, 0.0], [0.5, 0.5, 0.9]], "st": 1,
               "interp": False} for f in range(n)]
    return {
        "video": {"fps": FPS, "frame_count": n, "width": W, "height": H,
                  "view": "dtl", "handedness": "right", "source": {"path": "x.mp4"}},
        "pose": {"model": "synthetic", "keypoint_names": names, "frames": frames},
        "events": {"address": {"frame": 0, "conf": 0.9},
                   "top": {"frame": 20, "conf": 0.5},
                   "impact": {"frame": n - 1, "conf": 0.9}},
        "club": {"frames": []},
    }


def _fake_loader(ctx, lo, hi):
    v = np.zeros((hi - lo + 1, H, W, 3), dtype=np.float32)
    for i in range(v.shape[0]):
        v[i, 0, 0, 0] = lo + i
    return v


def _fake_infer(stacks):
    """Peaked heatmap at the truth position; frame index recovered from pixel 0."""
    B = stacks.shape[0]
    heats = np.zeros((B, HEAT_H, HEAT_W), dtype=np.float32)
    vис = np.ones(B, dtype=np.float32)
    vis = vис
    for k in range(B):
        # center frame of the stack carries its (resized) marker — instead, frame ids
        # were encoded pre-resize; recover via the stack's mean intensity trick is
        # unreliable, so the fake uses call order:
        f = _fake_infer.frames.pop(0)
        if 15 <= f < 18:
            vis[k] = 0.1                       # occluded stretch
            continue
        x, y = _truth(f)
        heats[k] = gaussian_target(x, y)
    return heats, vis


class TestTracker:
    def test_registered(self):
        assert "t2_temporal_heatmap" in available()

    def test_runs_with_fake_model(self):
        ctx = ClubTrackingContext.from_artifacts(_make_doc())
        half = N_STACK // 2
        _fake_infer.frames = list(range(half, 40 - half))
        tr = TemporalHeatmapTracker(infer=_fake_infer,
                                    meta={"trained_on": "fake"},
                                    loader=_fake_loader)
        res = tr.run(ctx)
        assert res.observations
        frames = {o.frame for o in res.observations}
        assert not frames & {15, 16, 17}, "low-visibility frames not dropped"
        for o in res.observations:
            tx, ty = _truth(o.frame)
            assert abs(o.x - tx) < 0.05 and abs(o.y - ty) < 0.05
            assert o.source == "temporal_heatmap"
        assert res.diagnostics["trained_on"] == "fake"
        assert res.diagnostics["dropped_low_vis"] == 3

    def test_no_weights_honest(self):
        tr = TemporalHeatmapTracker(infer=None, loader=_fake_loader)
        # force the no-weights path regardless of whether v1.pt exists on this machine
        import swingsage.club_tracking.tests_impl.t2_temporal_heatmap as mod
        orig = mod._default_model
        mod._default_model = lambda: (None, None)
        try:
            res = tr.run(ClubTrackingContext.from_artifacts(_make_doc()))
        finally:
            mod._default_model = orig
        assert res.observations == []
        assert res.diagnostics["reason"] == "no_weights"
