"""Test 3 point tracking (track step 10) — hermetic via fake tracker + fake loader.

The CoTracker adapter itself is exercised only by real fixture runs (GPU + weights);
everything pure — seeding, offset re-centering, visibility gating, agreement modes,
source-observation dedup — is proven here."""
from __future__ import annotations

import numpy as np

from swingsage.club_tracking import ClubTrackingContext, available
from swingsage.club_tracking.point_trackers.base import (build_seed_queries,
                                                         merge_seed_tracks)
from swingsage.club_tracking.tests_impl.t3_point_tracking import PointTrackingTracker

FPS = 60.0
W, H = 720, 1280


def _truth_px(t_idx):
    t = t_idx / FPS
    return (0.5 + 0.3 * np.sin(1.8 * t)) * W, (0.5 + 0.25 * np.cos(1.3 * t)) * H


class TestMerge:
    def test_offsets_recentered_and_modes(self):
        T, N = 30, 5
        offsets = np.array([(0, 0), (5, 0), (-5, 0), (0, 5), (0, -5)], dtype=np.float32)
        tracks = np.zeros((T, N, 2), dtype=np.float32)
        vis = np.ones((T, N), dtype=np.float32)
        for t in range(T):
            x, y = _truth_px(t)
            for k in range(N):
                tracks[t, k] = (x + offsets[k, 0], y + offsets[k, 1])
        out = merge_seed_tracks(tracks, vis, offsets, frame_size=(W, H))
        assert len(out) == T
        for t, xn, yn, conf, mode in out:
            tx, ty = _truth_px(t)
            assert abs(xn * W - tx) < 1.0 and abs(yn * H - ty) < 1.0
            assert mode == "observed" and conf > 0.5

    def test_low_visibility_frames_dropped(self):
        T, N = 20, 5
        offsets = np.zeros((N, 2), dtype=np.float32)
        tracks = np.tile(np.array([[100.0, 100.0]] * N, dtype=np.float32), (T, 1, 1))
        vis = np.ones((T, N), dtype=np.float32)
        vis[8:12] = 0.1
        out = merge_seed_tracks(tracks, vis, offsets, frame_size=(W, H))
        ts = [t for t, *_ in out]
        assert all(t not in ts for t in range(8, 12))

    def test_disagreement_downgrades_to_mixed(self):
        T, N = 5, 5
        offsets = np.zeros((N, 2), dtype=np.float32)
        tracks = np.zeros((T, N, 2), dtype=np.float32)
        for k in range(N):
            tracks[:, k] = (300 + k * 40, 300 - k * 40)  # seeds wildly apart
        vis = np.ones((T, N), dtype=np.float32)
        out = merge_seed_tracks(tracks, vis, offsets, frame_size=(W, H))
        assert out and all(mode == "mixed" for *_, mode in out)

    def test_build_seed_queries_shapes(self):
        qs, offs = build_seed_queries([(3, 100.0, 200.0), (9, 300.0, 400.0)],
                                      (1.0, 1.0), support_px=5.0)
        assert qs.shape == (10, 3) and offs.shape == (10, 2)
        assert qs[0].tolist() == [3.0, 100.0, 200.0]
        assert qs[5].tolist() == [9.0, 300.0, 400.0]


def _make_doc(n=80):
    names = ["kp", "grip_center"]
    frames = [{"f": f, "kp": [[0.0, 0.0, 0.0], [0.45, 0.5, 0.9]], "st": 1,
               "interp": False} for f in range(n)]
    club_frames = []
    for f in range(0, n, 5):  # sparse confident anchors
        x, y = _truth_px(f)
        club_frames.append({"f": f, "head": [x / W, y / H], "conf": 0.9,
                            "interp": False})
    return {
        "video": {"fps": FPS, "frame_count": n, "width": W, "height": H,
                  "view": "dtl", "handedness": "right", "source": {"path": "x.mp4"}},
        "pose": {"model": "synthetic", "keypoint_names": names, "frames": frames},
        "events": {"address": {"frame": 5, "conf": 0.9},
                   "top": {"frame": 40, "conf": 0.5},
                   "impact": {"frame": n - 5, "conf": 0.9}},
        "club": {"frames": club_frames},
    }


def _fake_tracker(video, queries):
    T = video.shape[0]
    N = queries.shape[0]
    tracks = np.zeros((T, N, 2), dtype=np.float32)
    vis = np.ones((T, N), dtype=np.float32)
    for t in range(T):
        # loader window starts at lo; queries' t are window-relative, truth uses absolute
        x, y = _truth_px(t + _fake_tracker.lo)
        for k in range(N):
            q0 = queries[k]
            dx = q0[1] - _truth_px(int(q0[0]) + _fake_tracker.lo)[0]
            dy = q0[2] - _truth_px(int(q0[0]) + _fake_tracker.lo)[1]
            tracks[t, k] = (x + dx, y + dy)
    vis[10:14] = 0.0  # a fully-occluded stretch
    return tracks, vis


def _fake_loader(ctx, lo, hi):
    _fake_tracker.lo = lo
    return np.zeros((hi - lo + 1, H, W, 3), dtype=np.float32)


class TestTracker:
    def test_registered(self):
        assert "t3_point_tracking" in available()

    def test_run_with_fakes(self):
        ctx = ClubTrackingContext.from_artifacts(_make_doc())
        res = PointTrackingTracker(tracker=_fake_tracker, loader=_fake_loader).run(ctx)
        assert res.observations, res.diagnostics
        for o in res.observations:
            tx, ty = _truth_px(o.frame)
            assert abs(o.x * W - tx) < 2.0 and abs(o.y * H - ty) < 2.0
            assert o.source == "point_tracker"
        # occluded stretch (window frames 10..13) absent
        frames = {o.frame for o in res.observations}
        lo = 0  # PAD_FRAMES=12 clamped to 0 for address=5
        assert not any(f in frames for f in range(lo + 10, lo + 14))

    def test_no_anchors_reports_honestly(self):
        doc = _make_doc()
        doc["club"]["frames"] = []
        ctx = ClubTrackingContext.from_artifacts(doc)
        res = PointTrackingTracker(tracker=_fake_tracker, loader=_fake_loader).run(ctx)
        assert res.observations == []
        assert res.diagnostics["reason"] == "insufficient_anchors"
