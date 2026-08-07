"""Test 18 — Shaft-Line Far End (third wave).

The club head must sit at the far end of a line through the hands: Hough line segments on
each frame's motion mask, kept only when their extension passes near the grip, head = the
kept segment's endpoint farther from the grip. The shaft is a far bigger, straighter
target than the head itself — plan §2.3 allows shaft-like geometry internally as long as
the OUTPUT is the head.
"""
from __future__ import annotations

import numpy as np

from ..interface import ClubTrackingContext, ClubTrackingResult
from ..model import ClubObservation
from ..motion_trace import motion_mask
from ..registry import TEST_IDS, register
from .t3_point_tracking import _load_window

GRIP_GATE_PX = 26        # line's closest approach to the grip must be inside this
MIN_LEN_PX = 30


def _point_line_dist(px, py, x1, y1, x2, y2) -> float:
    vx, vy = x2 - x1, y2 - y1
    n = np.hypot(vx, vy)
    if n < 1e-9:
        return float(np.hypot(px - x1, py - y1))
    return float(abs((px - x1) * vy - (py - y1) * vx) / n)


def best_shaft_line(mask: np.ndarray, grip_px: tuple[float, float]):
    """(head_x_px, head_y_px, length, n_lines_considered) or None. cv2 Hough on the
    motion mask; the winning segment maximizes length among grip-passing lines."""
    import cv2
    m = (mask.astype(np.uint8)) * 255
    lines = cv2.HoughLinesP(m, 1, np.pi / 180, threshold=28,
                            minLineLength=MIN_LEN_PX, maxLineGap=6)
    if lines is None:
        return None
    gx, gy = grip_px
    best = None
    # OpenCV returns (N,1,4) or (N,4) depending on version — normalize
    for (x1, y1, x2, y2) in np.asarray(lines).reshape(-1, 4):
        if _point_line_dist(gx, gy, x1, y1, x2, y2) > GRIP_GATE_PX:
            continue
        d1 = np.hypot(x1 - gx, y1 - gy)
        d2 = np.hypot(x2 - gx, y2 - gy)
        hx, hy, far = (x1, y1, d1) if d1 >= d2 else (x2, y2, d2)
        length = float(np.hypot(x2 - x1, y2 - y1))
        score = length + 0.3 * far
        if best is None or score > best[0]:
            best = (score, float(hx), float(hy), length)
    if best is None:
        return None
    return best[1], best[2], best[3], len(lines)


@register
class ShaftLineTracker:
    id = "t18_shaft_line"
    label = TEST_IDS["t18_shaft_line"]
    version = "1.0.0"

    def __init__(self, loader=None):
        self._loader = loader or _load_window

    def run(self, ctx: ClubTrackingContext) -> ClubTrackingResult:
        n0 = ctx.events.get("address", 0)
        n1 = ctx.events.get("impact", ctx.frame_count - 1)
        video = self._loader(ctx, n0, n1)
        if video is None or video.shape[0] < 3:
            return ClubTrackingResult(test_id=self.id, label=self.label,
                                      version=self.version, observations=[],
                                      diagnostics={"reason": "no_video"})
        h, w = video.shape[1:3]
        gray = video.mean(axis=3)

        observations = []
        lines_seen = 0
        for i in range(1, gray.shape[0]):
            f = n0 + i
            g = ctx.grip[f] if 0 <= f < len(ctx.grip) else None
            if not g or g[2] <= 0:
                continue
            hit = best_shaft_line(motion_mask(gray[i - 1], gray[i]),
                                  (g[0] * w, g[1] * h))
            if hit is None:
                continue
            hx, hy, length, n_lines = hit
            lines_seen += n_lines
            conf = float(np.clip(0.25 + length / (0.6 * max(h, w)), 0.15, 0.8))
            observations.append(ClubObservation(
                frame=f, source_time_s=f / ctx.fps,
                x=float(np.clip(hx / w, 0, 1)), y=float(np.clip(hy / h, 0, 1)),
                confidence=round(conf, 5), mode="observed",
                source="shaft_line", visibility="visible"))

        return ClubTrackingResult(
            test_id=self.id, label=self.label, version=self.version,
            observations=observations,
            diagnostics={"frames_with_shaft": len(observations),
                         "hough_lines_total": lines_seen})
