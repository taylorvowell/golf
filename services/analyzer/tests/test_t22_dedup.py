"""t22 red + deduped legacy — the dedupe rule, hermetically."""
from __future__ import annotations

from swingsage.club_tracking import ClubTrackingContext, available
from swingsage.club_tracking.tests_impl.t22_red_dedup import (RedDedupTracker,
                                                              dedupe_legacy)

FPS = 60.0


class TestDedupeRule:
    REDS = {10: (0.50, 0.50, 0.9), 14: (0.54, 0.52, 0.9)}

    def test_same_frame_red_wins(self):
        legacy = {10: (0.70, 0.70, 0.8)}          # far from the red, but same frame
        out, dropped = dedupe_legacy(legacy, self.REDS)
        assert out == {} and dropped == 1

    def test_near_a_close_red_removed(self):
        legacy = {12: (0.51, 0.505, 0.8)}         # 2 frames from red@10, 1.1% away
        out, dropped = dedupe_legacy(legacy, self.REDS)
        assert out == {} and dropped == 1

    def test_far_from_reds_kept(self):
        legacy = {12: (0.70, 0.70, 0.8),          # near in time, far in space
                  30: (0.60, 0.60, 0.8)}          # far in time
        out, dropped = dedupe_legacy(legacy, self.REDS)
        assert set(out) == {12, 30} and dropped == 0

    def test_empty_inputs(self):
        assert dedupe_legacy({}, self.REDS) == ({}, 0)
        out, dropped = dedupe_legacy({5: (0.1, 0.1, 0.5)}, {})
        assert set(out) == {5} and dropped == 0


def _make_doc(n=60):
    names = ["kp", "grip_center"]
    frames = [{"f": f, "kp": [[0.0, 0.0, 0.0], [0.5, 0.5, 0.9]], "st": 1,
               "interp": False} for f in range(n)]
    # reds on even frames up to 30 only
    boxes = [{"f": f, "d": [{"c": 0, "xy": [0.3 + 0.005 * f, 0.6],
                             "wh": [0.02, 0.02], "p": 0.85},
                            {"c": 1, "xy": [0.38, 0.6], "wh": [0.4, 0.2], "p": 0.9}]}
             for f in range(0, 30, 2)]
    # legacy everywhere: hugs the red path before 30, then covers 30..59 alone
    legacy = [{"f": f, "head": [0.3 + 0.005 * f, 0.602], "conf": 0.7,
               "interp": False} for f in range(n)]
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


class TestTracker:
    def test_registered(self):
        assert "t22_red_dedup" in available()

    def test_reds_rule_redundant_legacy_gone_coverage_legacy_kept(self):
        ctx = ClubTrackingContext.from_artifacts(_make_doc())
        res = RedDedupTracker(loader=lambda *a: None, raw_models_doc=None).run(ctx)
        by = {o.frame: o for o in res.observations}
        # red frames are red
        for f in range(0, 30, 2):
            assert by[f].source == "detector" and by[f].mode == "observed"
        # legacy hugging the red path (odd frames < 30) is deduped away
        for f in range(1, 28, 2):
            assert f not in by, f"redundant legacy mark survived at {f}"
        # legacy past the last red (33+) is kept — the coverage reds missed
        for f in range(33, 60):
            assert by[f].source == "classical" and by[f].mode == "mixed"
        d = res.diagnostics
        assert d["legacy_kept"] >= 27 and d["legacy_deduped"] >= 28
