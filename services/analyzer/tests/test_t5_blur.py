"""Test 5 blur/flow (track step 12) — pure streak logic + fake-flow orchestration."""
from __future__ import annotations

import numpy as np

from swingsage.club_tracking import ClubTrackingContext, available
from swingsage.club_tracking.blur import advect, extract_streaks
from swingsage.club_tracking.tests_impl.t5_blur_flow import BlurFlowTracker

FPS = 60.0
W, H = 360, 640


def _diff_with_streak(x0, y0, x1, y1, extra_blob=None):
    d = np.zeros((H, W), dtype=np.float32)
    n = 200
    xs = np.linspace(x0, x1, n).astype(int)
    ys = np.linspace(y0, y1, n).astype(int)
    for t in range(-2, 3):
        d[np.clip(ys + t, 0, H - 1), np.clip(xs, 0, W - 1)] = 200.0
    if extra_blob:
        bx, by = extra_blob
        yy, xx = np.ogrid[:H, :W]
        d[(xx - bx) ** 2 + (yy - by) ** 2 <= 81] = 200.0
    return d


class TestStreaks:
    def test_streak_found_tip_along_motion(self):
        d = _diff_with_streak(100, 300, 200, 260)
        s = extract_streaks(d, expected_dir=(1.0, -0.4), grip_px=(150, 200),
                            frame=7, time_s=0.1)
        assert s, "streak not found"
        b = s[0]
        assert abs(b.end_x * W - 200) < 8 and abs(b.end_y * H - 260) < 8
        assert abs(b.start_x * W - 100) < 8

    def test_round_blob_rejected(self):
        d = _diff_with_streak(100, 300, 200, 260, extra_blob=(300, 500))
        s = extract_streaks(d, expected_dir=(1.0, -0.4), grip_px=(150, 200),
                            frame=0, time_s=0.0)
        for b in s:
            assert abs(b.end_x * W - 300) > 20 or abs(b.end_y * H - 500) > 20

    def test_wrong_direction_rejected(self):
        d = _diff_with_streak(100, 300, 200, 260)     # travels +x, slightly -y
        s = extract_streaks(d, expected_dir=(0.0, 1.0), grip_px=(150, 200),
                            frame=0, time_s=0.0)
        assert s == []

    def test_empty_diff(self):
        assert extract_streaks(np.zeros((H, W), dtype=np.float32),
                               None, None, 0, 0.0) == []

    def test_advect(self):
        flow = np.zeros((H, W, 2), dtype=np.float32)
        flow[..., 0] = 18.0   # +18px in x
        nx, ny = advect((0.5, 0.5), flow)
        assert abs(nx - (0.5 + 18 / W)) < 1e-6 and abs(ny - 0.5) < 1e-6


def _truth(f):
    t = f / FPS
    return 0.5 + 0.25 * np.sin(1.5 * t), 0.5 + 0.2 * np.cos(1.1 * t)


def _make_doc(n=50, drop=range(20, 26)):
    names = ["kp", "grip_center"]
    frames = [{"f": f, "kp": [[0.0, 0.0, 0.0], [0.5, 0.5, 0.9]], "st": 1,
               "interp": False} for f in range(n)]
    club_frames = [{"f": f, "head": [*_truth(f)], "conf": 0.9, "interp": False}
                   for f in range(n) if f not in drop]
    return {
        "video": {"fps": FPS, "frame_count": n, "width": W, "height": H,
                  "view": "dtl", "handedness": "right", "source": {"path": "x.mp4"}},
        "pose": {"model": "synthetic", "keypoint_names": names, "frames": frames},
        "events": {"address": {"frame": 0, "conf": 0.9},
                   "top": {"frame": 25, "conf": 0.5},
                   "impact": {"frame": n - 1, "conf": 0.9}},
        "club": {"frames": club_frames},
    }


def _loader_with_streaks(ctx, lo, hi):
    """Black frames except: dropped frames carry a bright streak along the truth path."""
    v = np.zeros((hi - lo + 1, H, W, 3), dtype=np.float32)
    for i in range(v.shape[0]):
        f = lo + i
        if 20 <= f < 23:   # streak frames (subset of the drop window)
            # a real blur streak is many times the head's per-frame step — draw a 60px
            # smear ENDING at the truth position, oriented along the motion
            x1, y1 = _truth(f)
            dx, dy = (_truth(f)[0] - _truth(f - 1)[0],
                      _truth(f)[1] - _truth(f - 1)[1])
            n = float(np.hypot(dx * W, dy * H)) or 1.0
            x0 = x1 * W - dx * W / n * 60
            y0 = y1 * H - dy * H / n * 60
            d = _diff_with_streak(x0, y0, x1 * W, y1 * H)
            v[i, :, :, 0] = v[i, :, :, 1] = v[i, :, :, 2] = d
    return v


def _fake_flow(a, b):
    flow = np.zeros((H, W, 2), dtype=np.float32)
    # constant small drift matching the truth path's local motion
    flow[..., 0] = 1.2
    flow[..., 1] = -0.6
    return flow


class TestTracker:
    def test_registered(self):
        assert "t5_blur_flow" in available()

    def test_streaks_and_advection_fill_the_gap(self):
        ctx = ClubTrackingContext.from_artifacts(_make_doc())
        res = BlurFlowTracker(flow_fn=_fake_flow, loader=_loader_with_streaks).run(ctx)
        by_frame = {o.frame: o for o in res.observations}
        assert res.diagnostics["streaks_used"] >= 2
        assert res.diagnostics["flow_advected"] >= 2
        # Streaks serve the APPEARANCE (frame 20) and DISAPPEARANCE (frame 23) diffs;
        # frames 21-22's near-identical overlapping streaks cancel in the difference
        # image — physically accurate — so advection fills them.
        for f in (20, 23):
            assert by_frame[f].source == "deblatting"
            assert by_frame[f].mode == "mixed"
            assert by_frame[f].visibility == "blur_streak"
        for f in (21, 22, 24, 25):
            assert by_frame[f].source == "raft"
            assert by_frame[f].mode == "inferred"
        # confidence decays through each advected run
        assert by_frame[22].confidence < by_frame[21].confidence
        assert by_frame[25].confidence < by_frame[24].confidence

    def test_insufficient_base_honest(self):
        doc = _make_doc()
        doc["club"]["frames"] = doc["club"]["frames"][:3]
        ctx = ClubTrackingContext.from_artifacts(doc)
        res = BlurFlowTracker(flow_fn=_fake_flow, loader=_loader_with_streaks).run(ctx)
        assert res.observations == []
        assert res.diagnostics["reason"] == "insufficient_base"
