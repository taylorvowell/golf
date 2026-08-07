"""Test 4 segmentation (track step 11) — pure logic + fake-segmenter orchestration."""
from __future__ import annotations

import numpy as np

from swingsage.club_tracking import ClubTrackingContext, available
from swingsage.club_tracking.segmentation import (VelocityPredictor, branch_verdict,
                                                  mask_stats)
from swingsage.club_tracking.tests_impl.t4_video_segmentation import (
    VideoSegmentationTracker)

FPS = 60.0
W, H = 360, 640


def _disk(cx, cy, r=4):
    m = np.zeros((H, W), dtype=bool)
    yy, xx = np.ogrid[:H, :W]
    m[(xx - cx) ** 2 + (yy - cy) ** 2 <= r * r] = True
    return m


class TestMaskStats:
    def test_centroid_area(self):
        s = mask_stats(_disk(100, 200, r=5))
        assert abs(s.cx - 100 / W) < 0.01 and abs(s.cy - 200 / H) < 0.01
        assert 0 < s.area_frac < 4e-3
        assert s.ecc < 0.5

    def test_empty_mask_none(self):
        assert mask_stats(np.zeros((H, W), dtype=bool)) is None

    def test_streak_is_eccentric(self):
        m = np.zeros((H, W), dtype=bool)
        m[300, 50:150] = True
        m[301, 50:150] = True
        assert mask_stats(m).ecc > 0.9


class TestBranchVerdict:
    def test_exploded_mask_dead(self):
        s = mask_stats(np.ones((H, W), dtype=bool))
        assert branch_verdict(s, None, None) == "dead"

    def test_far_from_grip_dead(self):
        s = mask_stats(_disk(10, 10))
        assert branch_verdict(s, None, (0.9, 0.9)) == "dead"

    def test_jump_gate(self):
        s = mask_stats(_disk(180, 320))          # centroid (0.5, 0.5)
        assert branch_verdict(s, (0.5, 0.5), None) == "ok"
        assert branch_verdict(s, (0.44, 0.5), None) == "marginal"
        assert branch_verdict(s, (0.3, 0.5), None) == "dead"

    def test_predictor(self):
        p = VelocityPredictor()
        assert p.predict() is None
        p.update(0.5, 0.5)
        p.update(0.52, 0.49)
        assert np.allclose(p.predict(), (0.54, 0.48))
        p.reset()
        assert p.predict() is None


def _truth(f):
    t = f / FPS
    return (0.5 + 0.25 * np.sin(1.5 * t)), (0.5 + 0.2 * np.cos(1.1 * t))


def _make_doc(n=60):
    names = ["kp", "grip_center"]
    frames = [{"f": f, "kp": [[0.0, 0.0, 0.0], [0.5, 0.5, 0.9]], "st": 1,
               "interp": False} for f in range(n)]
    club_frames = [{"f": f, "head": [*_truth(f)], "conf": 0.9, "interp": False}
                   for f in range(0, n, 10)]
    return {
        "video": {"fps": FPS, "frame_count": n, "width": W, "height": H,
                  "view": "dtl", "handedness": "right", "source": {"path": "x.mp4"}},
        "pose": {"model": "synthetic", "keypoint_names": names, "frames": frames},
        "events": {"address": {"frame": 0, "conf": 0.9},
                   "top": {"frame": 30, "conf": 0.5},
                   "impact": {"frame": n - 1, "conf": 0.9}},
        "club": {"frames": club_frames},
    }


def _fake_loader(ctx, lo, hi):
    # frame index rides in pixel [0,0,0] so fakes stay in sync when branches die and
    # frames are skipped (a call counter drifts — learned the hard way)
    v = np.zeros((hi - lo + 1, H, W, 3), dtype=np.float32)
    for i in range(v.shape[0]):
        v[i, 0, 0, 0] = lo + i
    return v


def _good_segmenter(frame, point_px):
    f = int(frame[0, 0, 0])
    x, y = _truth(f)
    return _disk(int(x * W), int(y * H))


class TestTracker:
    def test_registered(self):
        assert "t4_video_segmentation" in available()

    def test_tracks_and_reseeds(self):
        def segmenter(frame, pt):
            f = int(frame[0, 0, 0])
            if 25 <= f < 28:                     # mask floods into the golfer
                return np.ones((H, W), dtype=bool)
            x, y = _truth(f)
            return _disk(int(x * W), int(y * H))

        ctx = ClubTrackingContext.from_artifacts(_make_doc())
        res = VideoSegmentationTracker(segmenter=segmenter, loader=_fake_loader).run(ctx)
        frames = {o.frame for o in res.observations}
        assert not frames & {25, 26, 27}, "flooded masks emitted as observations"
        assert res.diagnostics["branch_deaths"] >= 1
        assert 30 in frames, "branch did not reseed at the next anchor"
        for o in res.observations:
            tx, ty = _truth(o.frame)
            assert abs(o.x - tx) < 0.02 and abs(o.y - ty) < 0.02

    def test_no_anchors_honest(self):
        doc = _make_doc()
        doc["club"]["frames"] = []
        ctx = ClubTrackingContext.from_artifacts(doc)
        res = VideoSegmentationTracker(segmenter=_good_segmenter,
                                       loader=_fake_loader).run(ctx)
        assert res.observations == []
