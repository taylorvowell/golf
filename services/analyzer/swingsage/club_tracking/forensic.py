"""Forensic ROI math for Test 9 (plan §18) — pure functions.

The coarse pass says WHERE to look; these helpers turn that into source-resolution crops
and map detections back. The plan's stated failure mode is a too-narrow corridor cropping
out the true head, so the ROI widens as coarse confidence falls — never a fixed size.
"""
from __future__ import annotations

import numpy as np

ROI_BASE = 0.14         # ROI half-size as a fraction of the source's long side
ROI_MAX = 0.30
ROI_CONF_SCALE = 0.16   # low coarse confidence adds up to this much half-size


def roi_for(pred_xy: tuple[float, float], conf: float,
            src_w: int, src_h: int) -> tuple[int, int, int, int]:
    """(x0, y0, x1, y1) pixel box in the UPRIGHT source frame, clamped inside it."""
    long_side = max(src_w, src_h)
    half = min(ROI_MAX, ROI_BASE + ROI_CONF_SCALE * (1.0 - np.clip(conf, 0.0, 1.0)))
    r = int(half * long_side)
    cx, cy = int(pred_xy[0] * src_w), int(pred_xy[1] * src_h)
    x0, y0 = max(0, cx - r), max(0, cy - r)
    x1, y1 = min(src_w, cx + r), min(src_h, cy + r)
    return x0, y0, x1, y1


def roi_to_frame(x_roi: float, y_roi: float,
                 roi: tuple[int, int, int, int],
                 src_w: int, src_h: int) -> tuple[float, float]:
    """Normalized ROI coordinates -> normalized full-frame coordinates."""
    x0, y0, x1, y1 = roi
    return ((x0 + x_roi * (x1 - x0)) / src_w,
            (y0 + y_roi * (y1 - y0)) / src_h)


def coarse_track(experiments: dict, prefer=("t8_phase_fusion", "t10_physics_conic",
                                            "t1_candidate_graph")) -> dict[int, tuple[float, float, float]]:
    """frame -> (x, y, conf) from the strongest cached experiment's default variant."""
    for tid in prefer:
        pts = ((experiments.get(tid) or {}).get("trace", {})
               .get("variants", {}).get("default"))
        if pts and len(pts) >= 5:
            return {p["frame"]: (p["x"], p["y"], p["confidence"]) for p in pts}
    return {}
