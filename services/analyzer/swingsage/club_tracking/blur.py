"""Blur-streak extraction (test plan §14, §3.6) — pure numpy/scipy, no I/O, no torch.

A long impact streak is not a failed detection: its support IS the club head's intra-frame
trajectory. From a frame-difference image this module finds elongated motion components
consistent with the expected travel direction and the grip geometry, and reports each as a
BlurTrajectoryObservation whose end is the LEADING tip — never collapsed to a fake crisp
center point (§5.4). Turf/shaft/body can streak too (§14's failure mode), which is what
the direction and grip-band filters are for.
"""
from __future__ import annotations

import numpy as np
from scipy import ndimage

from .model import BlurTrajectoryObservation

DIFF_THRESH = 28.0        # 8-bit difference threshold
AREA_MIN_PX = 25
AREA_MAX_FRAC = 6e-3
MIN_ELONGATION = 3.0      # PCA major/minor ratio
GRIP_BAND = (0.02, 0.65)
MAX_DIR_DEV_DEG = 55.0    # streak orientation vs expected motion direction


def extract_streaks(diff: np.ndarray, expected_dir: tuple[float, float] | None,
                    grip_px: tuple[float, float] | None,
                    frame: int, time_s: float) -> list[BlurTrajectoryObservation]:
    """Streak observations from one absolute-difference image (grayscale, 0-255)."""
    h, w = diff.shape
    mask = diff >= DIFF_THRESH
    labels, n = ndimage.label(mask)
    if not n:
        return []
    out: list[BlurTrajectoryObservation] = []
    for comp in range(1, n + 1):
        ys, xs = np.nonzero(labels == comp)
        if xs.size < AREA_MIN_PX or xs.size > AREA_MAX_FRAC * h * w:
            continue
        pts = np.stack([xs, ys], axis=1).astype(float)
        c = pts.mean(axis=0)
        if grip_px is not None:
            d = float(np.hypot(*(c - grip_px))) / max(h, w)
            if not GRIP_BAND[0] <= d <= GRIP_BAND[1]:
                continue
        cov = np.cov((pts - c).T)
        ev, evec = np.linalg.eigh(cov)
        if ev[0] <= 0 or ev[1] / max(ev[0], 1e-9) < MIN_ELONGATION ** 2:
            continue
        axis = evec[:, 1]
        if expected_dir is not None:
            ed = np.array(expected_dir, dtype=float)
            edn = np.linalg.norm(ed)
            if edn > 1e-9:
                cosang = abs(float(axis @ ed / edn))  # orientation is sign-ambiguous
                if cosang < np.cos(np.deg2rad(MAX_DIR_DEV_DEG)):
                    continue
                if float(axis @ ed) < 0:
                    axis = -axis                       # make axis point along motion
        proj = (pts - c) @ axis
        tail = c + axis * proj.min()
        tip = c + axis * proj.max()
        strength = float(np.clip(xs.size / (AREA_MAX_FRAC * h * w), 0.1, 0.9))
        out.append(BlurTrajectoryObservation(
            frame=frame, source_time_s=time_s,
            start_x=float(np.clip(tail[0] / w, 0, 1)),
            start_y=float(np.clip(tail[1] / h, 0, 1)),
            end_x=float(np.clip(tip[0] / w, 0, 1)),
            end_y=float(np.clip(tip[1] / h, 0, 1)),
            confidence=strength))
    # strongest first
    out.sort(key=lambda b: -b.confidence)
    return out


def advect(pos: tuple[float, float], flow: np.ndarray,
           patch: int = 9) -> tuple[float, float]:
    """Move a normalized position by the mean flow (pixels) in a patch around it."""
    h, w = flow.shape[:2]
    x, y = int(pos[0] * w), int(pos[1] * h)
    x0, x1 = max(0, x - patch), min(w, x + patch + 1)
    y0, y1 = max(0, y - patch), min(h, y + patch + 1)
    if x0 >= x1 or y0 >= y1:
        return pos
    fx = float(flow[y0:y1, x0:x1, 0].mean())
    fy = float(flow[y0:y1, x0:x1, 1].mean())
    return (float(np.clip(pos[0] + fx / w, 0, 1)),
            float(np.clip(pos[1] + fy / h, 0, 1)))
