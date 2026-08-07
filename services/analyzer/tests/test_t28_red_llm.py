"""t28 red only + LLM downswing verify — hermetic with a fake provider."""
from __future__ import annotations

import tempfile
from pathlib import Path

import numpy as np

from swingsage.club_tracking import ClubTrackingContext, available
from swingsage.club_tracking.tests_impl.t28_red_llm import (RedLlmTracker,
                                                            pick_momentum_frames)

FPS = 60.0
W, H = 360, 640


class TestMomentumPicks:
    def test_five_segments_fastest_frame_each(self):
        # reds every 2 frames; a burst of speed at 34->36
        reds = {f: (0.3 + 0.004 * f, 0.6) for f in range(20, 60, 2)}
        reds[34] = (0.30 + 0.004 * 34, 0.6)
        reds[36] = (0.55, 0.45)                    # huge jump: fastest at 34
        picks = pick_momentum_frames(reds, 20, 60, FPS)
        assert len(picks) == 5
        assert 34 in picks, "highest-momentum frame not picked in its segment"

    def test_empty_segment_falls_to_middle(self):
        reds = {22: (0.3, 0.6)}
        picks = pick_momentum_frames(reds, 20, 60, FPS)
        assert len(picks) == 5


def _make_doc(n=60):
    names = ["kp", "grip_center"]
    frames = [{"f": f, "kp": [[0.0, 0.0, 0.0], [0.5, 0.5, 0.9]], "st": 1,
               "interp": False} for f in range(n)]
    boxes = [{"f": f, "d": [{"c": 0, "xy": [0.3 + 0.005 * f, 0.6],
                             "wh": [0.02, 0.02], "p": 0.85},
                            {"c": 1, "xy": [0.4, 0.6], "wh": [0.7, 0.4], "p": 0.9}]}
             for f in range(n)]
    return {
        "video": {"fps": FPS, "frame_count": n, "width": W, "height": H,
                  "view": "dtl", "handedness": "right", "source": {"path": "x.mp4"}},
        "pose": {"model": "synthetic", "keypoint_names": names, "frames": frames},
        "events": {"address": {"frame": 0, "conf": 0.9},
                   "top": {"frame": 25, "conf": 0.5},
                   "impact": {"frame": 55, "conf": 0.9}},
        "club": {"frames": [],
                 "detector": {"names": {"0": "clubhead"}, "boxes": boxes}},
    }


def _loader(ctx, lo, hi):
    return np.full((hi - lo + 1, H, W, 3), 40, dtype=np.float32)


def test_registered():
    assert "t28_red_llm" in available()


def test_adjustments_applied_confirmations_kept():
    def provider(prompt):
        import re
        rows = re.findall(r"frame (\d+) \(current: ([A-L]\d+)\)", prompt)
        out = []
        for i, (f, cur) in enumerate(rows):
            # first frame: move far (adjust); rest: same cell (confirm)
            cell = "A1" if i == 0 else cur
            out.append({"frame": int(f), "visible": True, "cell": cell,
                        "confidence": 0.9})
        return out

    ctx = ClubTrackingContext.from_artifacts(_make_doc())
    with tempfile.TemporaryDirectory() as td:
        ctx.out_dir = Path(td)
        res = RedLlmTracker(provider=provider, loader=_loader).run(ctx)
    assert res.diagnostics["llm"] == "ai"
    assert res.diagnostics["llm_adjusted"] == 1
    assert res.diagnostics["llm_confirmed"] >= 3
    llm_pts = [o for o in res.observations if o.source == "llm"]
    assert len(llm_pts) == 1
    assert llm_pts[0].mode == "mixed" and llm_pts[0].confidence <= 0.55 + 1e-9
    # confirmed frames keep their full-strength detector reds
    detector = [o for o in res.observations if o.source == "detector"]
    assert all(o.confidence == 0.85 for o in detector)


def test_provider_dead_reds_untouched():
    ctx = ClubTrackingContext.from_artifacts(_make_doc())
    with tempfile.TemporaryDirectory() as td:
        ctx.out_dir = Path(td)
        res = RedLlmTracker(provider=lambda p: None, loader=_loader).run(ctx)
    assert res.diagnostics["llm"] == "fallback"
    assert all(o.source == "detector" for o in res.observations)
    assert len(res.observations) == 56
