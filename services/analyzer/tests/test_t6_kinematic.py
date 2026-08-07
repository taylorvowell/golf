"""Test 6 grip-kinematic tracker (track step 06) — hermetic reconstruction check.

Synthetic swing: grip translates along a path while the head rides a rotating arm with a
slowly varying projected radius. Hide a contiguous span of anchors; T6 must put the head
back within tolerance, honestly marked `inferred`."""
from __future__ import annotations

import numpy as np

from swingsage.club_tracking import ClubTrackingContext, available, get_test

FPS = 60.0
N = 80          # address at 0, impact at N-1
HIDE = (30, 55)  # hidden anchor span — ~31% of the swing


def _truth(f):
    t = f / FPS
    gx = 0.45 + 0.05 * np.sin(2.0 * t)
    gy = 0.50 - 0.03 * t
    radius = 0.22 + 0.04 * np.sin(1.1 * t)          # slowly varying, never constant
    theta = -1.2 + 2.4 * t                           # sweeping arm
    hx = gx + radius * np.cos(theta)
    hy = gy + radius * np.sin(theta)
    return (gx, gy), (hx, hy)


def _make_doc():
    names = ["kp_a", "grip_center", "kp_b"]
    frames, club_frames = [], []
    for f in range(N):
        (gx, gy), (hx, hy) = _truth(f)
        kp = [[0.0, 0.0, 0.0], [float(gx), float(gy), 0.95], [0.0, 0.0, 0.0]]
        frames.append({"f": f, "kp": kp, "st": 1, "interp": False})
        if not HIDE[0] <= f < HIDE[1]:
            club_frames.append({"f": f, "head": [float(hx), float(hy)],
                                "conf": 0.9, "interp": False})
    return {
        "video": {"fps": FPS, "frame_count": N, "width": 1080, "height": 1920,
                  "view": "dtl", "handedness": "right", "source": {"path": "x.mp4"}},
        "pose": {"model": "synthetic", "keypoint_names": names, "frames": frames},
        "events": {"address": {"frame": 0, "conf": 0.9},
                   "top": {"frame": 40, "conf": 0.5},
                   "impact": {"frame": N - 1, "conf": 0.9}},
        "club": {"frames": club_frames},
    }


def _run():
    ctx = ClubTrackingContext.from_artifacts(_make_doc())
    return get_test("t6_grip_kinematic").run(ctx), ctx


def test_t6_is_registered():
    assert "t6_grip_kinematic" in available()


def test_full_frame_coverage_and_modes():
    res, ctx = _run()
    frames = [o.frame for o in res.observations]
    assert frames == list(range(0, N))
    by_frame = {o.frame: o for o in res.observations}
    for f in range(N):
        expected = "inferred" if HIDE[0] <= f < HIDE[1] else "observed"
        assert by_frame[f].mode == expected, f"frame {f}"


def test_hidden_span_reconstructed_within_tolerance():
    res, _ = _run()
    by_frame = {o.frame: o for o in res.observations}
    errs = []
    for f in range(*HIDE):
        _, (hx, hy) = _truth(f)
        o = by_frame[f]
        errs.append(float(np.hypot(o.x - hx, o.y - hy)))
    assert max(errs) < 0.03, f"worst reconstruction error {max(errs):.4f}"


def test_inferred_confidence_below_anchor_confidence_and_decaying():
    res, _ = _run()
    by_frame = {o.frame: o for o in res.observations}
    mid = by_frame[(HIDE[0] + HIDE[1]) // 2]
    edge = by_frame[HIDE[0]]
    anchor = by_frame[HIDE[0] - 1]
    assert mid.confidence < edge.confidence <= anchor.confidence
    assert mid.source == "kinematic"


def test_too_few_anchors_reports_honestly():
    doc = _make_doc()
    doc["club"]["frames"] = doc["club"]["frames"][:3]
    ctx = ClubTrackingContext.from_artifacts(doc)
    res = get_test("t6_grip_kinematic").run(ctx)
    assert res.observations == []
    assert res.diagnostics["reason"] == "insufficient_anchors"
