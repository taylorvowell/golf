"""Motion-composite tracing (user brainstorm, 2026-08-08) — pure numpy core.

The physical insight all three second-wave tests share: in a swing clip the only things
moving are the golfer and the club, and the CLUB HEAD sweeps the OUTERMOST arc of all
motion — the hands arc inside it, the body barely translates. So:

  * accumulate per-frame motion energy into one composite ("the images overlaid on one
    another" — a long exposure of the swing);
  * the composite's outer envelope, taken radially from the swing's hub, IS approximately
    the head path;
  * each frame's own motion mask, intersected with the envelope band, pins WHERE ALONG
    the path the head is at that moment.
"""
from __future__ import annotations

import numpy as np

DIFF_THRESH = 22.0
ENVELOPE_BINS = 360
ENVELOPE_BAND = 0.88     # a frame's head pixel must sit beyond this fraction of the
                         # envelope radius at its angle
MIN_RADIUS_FRAC = 0.3    # bins whose envelope never reaches this fraction of the max
                         # only ever saw BODY motion — the club never swept there, so
                         # nothing in them may count as the head


def motion_mask(gray_a: np.ndarray, gray_b: np.ndarray,
                thresh: float = DIFF_THRESH) -> np.ndarray:
    return np.abs(gray_b.astype(np.float32) - gray_a.astype(np.float32)) >= thresh


def composite(masks: list[np.ndarray]) -> np.ndarray:
    """Max-accumulated motion energy — the long-exposure image of the swing."""
    out = np.zeros_like(masks[0], dtype=np.float32)
    for m in masks:
        out = np.maximum(out, m.astype(np.float32))
    return out


def outer_envelope(comp: np.ndarray, center: tuple[float, float],
                   n_bins: int = ENVELOPE_BINS) -> np.ndarray:
    """Per angle bin, the FARTHEST motion pixel from the hub (normalized radius).
    Returns (n_bins,) radii, 0 where the bin saw no motion. Angles bin atan2(dy, dx)
    over [-pi, pi). Coordinates are normalized by the frame's max dimension so radii are
    isotropic."""
    h, w = comp.shape
    ys, xs = np.nonzero(comp > 0)
    if xs.size == 0:
        return np.zeros(n_bins, dtype=np.float32)
    scale = float(max(h, w))
    dx = (xs - center[0] * w) / scale
    dy = (ys - center[1] * h) / scale
    r = np.hypot(dx, dy)
    a = np.arctan2(dy, dx)
    bins = ((a + np.pi) / (2 * np.pi) * n_bins).astype(int) % n_bins
    env = np.zeros(n_bins, dtype=np.float32)
    np.maximum.at(env, bins, r)
    # body-zone suppression: a bin the club never swept holds only body motion
    env[env < MIN_RADIUS_FRAC * env.max()] = 0.0
    return env


def envelope_radius_at(env: np.ndarray, angle: float) -> float:
    """Envelope radius for one angle (radians), with nearest-nonzero fallback."""
    n = env.size
    b = int((angle + np.pi) / (2 * np.pi) * n) % n
    if env[b] > 0:
        return float(env[b])
    for d in range(1, n // 8):
        for bb in ((b + d) % n, (b - d) % n):
            if env[bb] > 0:
                return float(env[bb])
    return 0.0


def frame_head_pick(mask: np.ndarray, center: tuple[float, float],
                    env: np.ndarray, band: float = ENVELOPE_BAND
                    ) -> tuple[float, float, float] | None:
    """The frame's head estimate: the motion pixel at maximal radius whose radius is
    within the envelope band at its angle. Returns (x_norm, y_norm, support) or None.
    `support` is how much of the frame's outer motion agrees (0-1)."""
    h, w = mask.shape
    ys, xs = np.nonzero(mask)
    if xs.size == 0:
        return None
    scale = float(max(h, w))
    dx = (xs - center[0] * w) / scale
    dy = (ys - center[1] * h) / scale
    r = np.hypot(dx, dy)
    a = np.arctan2(dy, dx)
    n = env.size
    bins = ((a + np.pi) / (2 * np.pi) * n).astype(int) % n
    env_r = env[bins]
    ok = (env_r > 0) & (r >= band * env_r)
    if not ok.any():
        return None
    k = int(np.argmax(np.where(ok, r, -1)))
    support = float(ok.sum() / xs.size)
    return float(xs[k]) / w, float(ys[k]) / h, support


def envelope_distance(env: np.ndarray, center: tuple[float, float],
                      x: float, y: float, frame_wh: tuple[int, int]) -> float:
    """|point radius - envelope radius at the point's angle|, normalized units. For the
    corridor prior: a candidate far off the swept path is suspect."""
    w, h = frame_wh
    scale = float(max(h, w))
    dx = (x - center[0]) * w / scale
    dy = (y - center[1]) * h / scale
    r = float(np.hypot(dx, dy))
    er = envelope_radius_at(env, float(np.arctan2(dy, dx)))
    if er <= 0:
        return 1.0
    return abs(r - er)
