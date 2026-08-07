"""Third-wave tests (t16 ridge, t17 LLM gap fill, t18 shaft line) — hermetic."""
from __future__ import annotations

import numpy as np

from swingsage.club_tracking import ClubTrackingContext, available
from swingsage.club_tracking.llm_locate import (grid_cell_to_norm, pick_llm_frames,
                                                validate_response)
from swingsage.club_tracking.tests_impl.t16_ridge_trace import RidgeTraceTracker
from swingsage.club_tracking.tests_impl.t17_llm_gap_fill import LlmGapFillTracker
from swingsage.club_tracking.tests_impl.t18_shaft_line import (ShaftLineTracker,
                                                               best_shaft_line)

FPS = 60.0
W, H = 360, 640
HUB = (0.5, 0.5)
R_HEAD = 0.22


def _head_pos(f):
    ang = -2.4 + 0.09 * f
    scale = max(W, H)
    return (HUB[0] + R_HEAD * np.cos(ang) * scale / W,
            HUB[1] + R_HEAD * np.sin(ang) * scale / H)


def _frame_with_shaft(f):
    """Head blob plus a bright shaft line from the grip to the head."""
    import cv2
    img = np.zeros((H, W), dtype=np.float32)
    x, y = _head_pos(f)
    gx, gy = int(HUB[0] * W), int(HUB[1] * H)
    cv2.line(img, (gx, gy), (int(x * W), int(y * H)), 220.0, 3)
    cx, cy = int(x * W), int(y * H)
    img[max(0, cy - 4):cy + 5, max(0, cx - 4):cx + 5] = 255.0
    return img


def _loader(ctx, lo, hi):
    return np.stack([np.repeat(_frame_with_shaft(f)[..., None], 3, axis=2)
                     for f in range(lo, hi + 1)])


def _make_doc(n=40, club_frames=None):
    names = ["kp", "grip_center"]
    frames = [{"f": f, "kp": [[0.0, 0.0, 0.0], [HUB[0], HUB[1], 0.9]], "st": 1,
               "interp": False} for f in range(n)]
    return {
        "video": {"fps": FPS, "frame_count": n, "width": W, "height": H,
                  "view": "dtl", "handedness": "right", "source": {"path": "x.mp4"}},
        "pose": {"model": "synthetic", "keypoint_names": names, "frames": frames},
        "events": {"address": {"frame": 0, "conf": 0.9},
                   "top": {"frame": 20, "conf": 0.5},
                   "impact": {"frame": n - 1, "conf": 0.9}},
        "club": {"frames": club_frames or []},
    }


class TestTriage:
    def test_pick_prefers_big_gaps_and_caps(self):
        confident = set(range(0, 100)) - set(range(20, 50)) - {70, 71}
        picks = pick_llm_frames(confident, 0, 99, cap=5)
        assert len(picks) <= 5
        assert picks[0] == 34                      # middle of the 30-frame gap
        assert all(20 <= p < 50 or p in (70, 71) for p in picks)

    def test_no_gaps_no_picks(self):
        assert pick_llm_frames(set(range(50)), 0, 49) == []

    def test_grid_cells(self):
        x, y = grid_cell_to_norm("A1")
        assert x < 0.1 and y < 0.1
        x, y = grid_cell_to_norm("L12")
        assert x > 0.9 and y > 0.9
        assert grid_cell_to_norm("M1") is None
        assert grid_cell_to_norm("A13") is None
        assert grid_cell_to_norm("77") is None

    def test_validate(self):
        good = [{"frame": 5, "visible": True, "cell": "F7", "confidence": 0.8},
                {"frame": 9, "visible": False, "cell": None}]
        assert validate_response(good, [5, 9]) is None
        assert validate_response(good, [5, 8])          # wrong frame
        assert validate_response([good[0]], [5, 9])     # wrong length
        bad = [dict(good[0], cell="Z9"), good[1]]
        assert validate_response(bad, [5, 9])


class TestT17:
    def _doc_with_gap(self):
        club = [{"f": f, "head": [*map(float, _head_pos(f))], "conf": 0.9,
                 "interp": False} for f in range(40) if not 15 <= f < 30]
        return _make_doc(club_frames=club)

    def test_llm_fills_the_gap(self):
        calls = []

        def provider(prompt):
            calls.append(prompt)
            # answer every requested frame with cell F6 (~center of the crop)
            import re
            frames = [int(m) for m in re.findall(r"frame (\d+):", prompt)]
            return [{"frame": f, "visible": True, "cell": "F6", "confidence": 0.9}
                    for f in frames]

        ctx = ClubTrackingContext.from_artifacts(self._doc_with_gap())
        # out_dir None -> no crops can be written; inject via a tmp out_dir instead
        import tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as td:
            ctx.out_dir = Path(td)
            res = LlmGapFillTracker(provider=provider, loader=_loader).run(ctx)
        assert len(calls) == 1, "must be ONE call for all crops"
        assert res.diagnostics["llm"] == "ai"
        llm_pts = [o for o in res.observations if o.source == "llm"]
        assert llm_pts and res.diagnostics["llm_frames_filled"] == len(llm_pts)
        for o in llm_pts:
            assert o.mode == "mixed"
            assert o.confidence <= 0.55 + 1e-9, "LLM point exceeded its cap"
            assert 15 <= o.frame < 30

    def test_no_gaps_means_zero_calls(self):
        club = [{"f": f, "head": [*map(float, _head_pos(f))], "conf": 0.9,
                 "interp": False} for f in range(40)]
        ctx = ClubTrackingContext.from_artifacts(_make_doc(club_frames=club))
        calls = []
        res = LlmGapFillTracker(provider=lambda p: calls.append(p),
                                loader=_loader).run(ctx)
        assert calls == [] and res.diagnostics["llm"] == "not_needed"

    def test_provider_dead_anchors_stand(self):
        ctx = ClubTrackingContext.from_artifacts(self._doc_with_gap())
        import tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as td:
            ctx.out_dir = Path(td)
            res = LlmGapFillTracker(provider=lambda p: None, loader=_loader).run(ctx)
        assert res.diagnostics["llm"] == "fallback"
        assert all(o.source == "detector" for o in res.observations)
        assert res.observations, "anchors must survive an AI failure"


class TestT18:
    def test_shaft_line_finds_far_end(self):
        assert "t18_shaft_line" in available()
        m = _frame_with_shaft(10) >= 22.0
        hit = best_shaft_line(m, (HUB[0] * W, HUB[1] * H))
        assert hit is not None
        hx, hy, length, _ = hit
        tx, ty = _head_pos(10)
        assert np.hypot(hx - tx * W, hy - ty * H) < 15

    def test_tracker_end_to_end(self):
        ctx = ClubTrackingContext.from_artifacts(_make_doc())
        res = ShaftLineTracker(loader=_loader).run(ctx)
        assert len(res.observations) >= 20, res.diagnostics
        good = sum(1 for o in res.observations
                   if np.hypot((o.x - _head_pos(o.frame)[0]) * W,
                               (o.y - _head_pos(o.frame)[1]) * H) < 18)
        assert good >= len(res.observations) * 0.7


class TestT16:
    def test_ridge_tracks_centerline(self):
        assert "t16_ridge_trace" in available()
        ctx = ClubTrackingContext.from_artifacts(_make_doc())
        res = RidgeTraceTracker(loader=_loader).run(ctx)
        assert len(res.observations) >= 20, res.diagnostics
        good = sum(1 for o in res.observations
                   if np.hypot((o.x - _head_pos(o.frame)[0]) * W,
                               (o.y - _head_pos(o.frame)[1]) * H) < 20)
        assert good >= len(res.observations) * 0.65
