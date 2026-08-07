"""Test 16 — Motion Ridge Centerline (third wave).

t13 follows the composite's outer EDGE, which drags toward whichever side of the motion
pair a frame-diff lit up. This test follows the swept ribbon's CENTERLINE instead: per
angle bin, the radial centroid of the outer motion band; per frame, the frame's own
outer-band motion decides the angle, the centerline decides the radius.
"""
from __future__ import annotations

import numpy as np

from ..interface import ClubTrackingContext, ClubTrackingResult
from ..model import ClubObservation
from ..motion_trace import (ENVELOPE_BINS, composite, motion_mask, outer_envelope)
from ..registry import TEST_IDS, register
from .t3_point_tracking import _load_window
from .t13_motion_composite import _hub

BAND_LO = 0.62           # the head ribbon: pixels beyond this fraction of the envelope


def ridge_centerline(comp: np.ndarray, center: tuple[float, float],
                     env: np.ndarray) -> np.ndarray:
    """(n_bins,) centerline radius: radial centroid of composite motion in the outer
    band per angle bin; 0 where the bin has no swept motion."""
    h, w = comp.shape
    ys, xs = np.nonzero(comp > 0)
    n = env.size
    out = np.zeros(n, dtype=np.float32)
    if xs.size == 0:
        return out
    scale = float(max(h, w))
    dx = (xs - center[0] * w) / scale
    dy = (ys - center[1] * h) / scale
    r = np.hypot(dx, dy)
    bins = ((np.arctan2(dy, dx) + np.pi) / (2 * np.pi) * n).astype(int) % n
    keep = (env[bins] > 0) & (r >= BAND_LO * env[bins])
    if not keep.any():
        return out
    num = np.zeros(n)
    den = np.zeros(n)
    np.add.at(num, bins[keep], r[keep])
    np.add.at(den, bins[keep], 1.0)
    nz = den > 0
    out[nz] = (num[nz] / den[nz]).astype(np.float32)
    return out


@register
class RidgeTraceTracker:
    id = "t16_ridge_trace"
    label = TEST_IDS["t16_ridge_trace"]
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
        masks = [motion_mask(gray[i - 1], gray[i]) for i in range(1, gray.shape[0])]
        comp = composite(masks)
        hub = _hub(ctx, n0, n1)
        env = outer_envelope(comp, hub)
        if not (env > 0).any():
            return ClubTrackingResult(test_id=self.id, label=self.label,
                                      version=self.version, observations=[],
                                      diagnostics={"reason": "no_motion"})
        ridge = ridge_centerline(comp, hub, env)

        scale = float(max(h, w))
        observations = []
        for i, m in enumerate(masks):
            f = n0 + i + 1
            ys, xs = np.nonzero(m)
            if xs.size == 0:
                continue
            dx = (xs - hub[0] * w) / scale
            dy = (ys - hub[1] * h) / scale
            r = np.hypot(dx, dy)
            a = np.arctan2(dy, dx)
            bins = ((a + np.pi) / (2 * np.pi) * ENVELOPE_BINS).astype(int) % ENVELOPE_BINS
            keep = (env[bins] > 0) & (r >= BAND_LO * env[bins]) & (ridge[bins] > 0)
            if not keep.any():
                continue
            # the frame's angle = motion-weighted mean angle of its outer band (unit
            # vectors so the wrap at +-pi cannot average to garbage)
            ux, uy = np.cos(a[keep]).mean(), np.sin(a[keep]).mean()
            ang = float(np.arctan2(uy, ux))
            b = int((ang + np.pi) / (2 * np.pi) * ENVELOPE_BINS) % ENVELOPE_BINS
            rr = float(ridge[b]) if ridge[b] > 0 else float(r[keep].max())
            x = hub[0] + rr * np.cos(ang) * scale / w
            y = hub[1] + rr * np.sin(ang) * scale / h
            support = float(keep.sum() / xs.size)
            observations.append(ClubObservation(
                frame=f, source_time_s=f / ctx.fps,
                x=float(np.clip(x, 0, 1)), y=float(np.clip(y, 0, 1)),
                confidence=round(float(np.clip(0.3 + 0.5 * support, 0.1, 0.8)), 5),
                mode="mixed", source="motion_ridge", visibility="visible"))

        return ClubTrackingResult(
            test_id=self.id, label=self.label, version=self.version,
            observations=observations,
            diagnostics={"ridge_bins": int((ridge > 0).sum()),
                         "frames_picked": len(observations)})
