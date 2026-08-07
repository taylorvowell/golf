"""Pure logic for Test 4's mask tracking (plan §13) — no torch, no I/O.

The segmenter backend produces masks; everything that decides what a mask MEANS lives
here so it can be hermetic-tested: centroid/area stats, the sanity gate that terminates a
propagation branch (mask exploded / attached to golfer or background / left the swing
corridor), and the constant-velocity predictor that repositions the prompt when motion is
fast (§13's Kalman assistance).
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

# Area fractions of the whole frame. A club head at 720p analysis res is tens to a few
# hundred pixels; a mask that grows past AREA_MAX has flooded into the golfer/background.
AREA_MIN = 5e-6
AREA_MAX = 4e-3
JUMP_GATE = 0.08          # normalized centroid distance from prediction that ends a branch
GRIP_BAND = (0.02, 0.65)  # same plausibility band as the candidate graph


@dataclass
class MaskStats:
    cx: float                 # centroid, normalized
    cy: float
    area_frac: float
    ecc: float                # 0 = circle, ->1 = elongated (a blur streak is fine)


def mask_stats(mask: np.ndarray) -> MaskStats | None:
    """Centroid/area/eccentricity of a boolean mask. None for an empty mask."""
    ys, xs = np.nonzero(mask)
    if xs.size == 0:
        return None
    h, w = mask.shape
    cx = float(xs.mean()) / w
    cy = float(ys.mean()) / h
    area = xs.size / (w * h)
    if xs.size < 3:
        ecc = 0.0
    else:
        cov = np.cov(np.stack([xs, ys]).astype(float))
        ev = np.linalg.eigvalsh(cov)
        ecc = float(np.sqrt(max(0.0, 1.0 - ev[0] / max(ev[1], 1e-9))))
    return MaskStats(cx=cx, cy=cy, area_frac=area, ecc=ecc)


def branch_verdict(stats: MaskStats | None,
                   predicted: tuple[float, float] | None,
                   grip: tuple[float, float] | None) -> str:
    """'ok' | 'marginal' | 'dead'. Dead terminates the branch (§13): the §13 failure mode
    — a tiny blurred head below stable mask granularity — must surface as a GAP, never as
    a confident wrong centroid."""
    if stats is None:
        return "dead"
    if not AREA_MIN <= stats.area_frac <= AREA_MAX:
        return "dead"
    if grip is not None:
        d = float(np.hypot(stats.cx - grip[0], stats.cy - grip[1]))
        if not GRIP_BAND[0] <= d <= GRIP_BAND[1]:
            return "dead"
    if predicted is not None:
        jump = float(np.hypot(stats.cx - predicted[0], stats.cy - predicted[1]))
        if jump > JUMP_GATE:
            return "dead"
        if jump > JUMP_GATE / 2:
            return "marginal"
    return "ok"


class VelocityPredictor:
    """Constant-velocity point predictor — enough to reposition a prompt between frames.
    Deliberately not a full Kalman filter: there is no measurement noise model worth
    fitting here, and the branch verdict already gates bad measurements."""

    def __init__(self):
        self._last: tuple[float, float] | None = None
        self._vel = (0.0, 0.0)

    def update(self, x: float, y: float) -> None:
        if self._last is not None:
            self._vel = (x - self._last[0], y - self._last[1])
        self._last = (x, y)

    def predict(self) -> tuple[float, float] | None:
        if self._last is None:
            return None
        return (self._last[0] + self._vel[0], self._last[1] + self._vel[1])

    def reset(self) -> None:
        self._last = None
        self._vel = (0.0, 0.0)
