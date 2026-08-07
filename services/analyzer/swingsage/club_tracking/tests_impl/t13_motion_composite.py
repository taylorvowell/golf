"""Test 13 — Motion Composite / Long-Exposure Envelope (user brainstorm).

Accumulate every frame's motion energy into one composite (the images overlaid on one
another), take its outer envelope from the swing's hub — the head sweeps the outermost
arc — and pin each frame's position by its own motion against that envelope.
"""
from __future__ import annotations

import numpy as np

from ..interface import ClubTrackingContext, ClubTrackingResult
from ..model import ClubObservation
from ..motion_trace import (composite, frame_head_pick, motion_mask, outer_envelope)
from ..registry import TEST_IDS, register
from .t3_point_tracking import _load_window


def _hub(ctx: ClubTrackingContext, n0: int, n1: int) -> tuple[float, float]:
    """The swing's hub: mean grip position over the window (the hands are the axle the
    club sweeps around)."""
    pts = [g for g in (ctx.grip[f] for f in range(n0, min(n1 + 1, len(ctx.grip))))
           if g and g[2] > 0]
    if not pts:
        return 0.5, 0.5
    return (float(np.mean([p[0] for p in pts])),
            float(np.mean([p[1] for p in pts])))


@register
class MotionCompositeTracker:
    id = "t13_motion_composite"
    label = TEST_IDS["t13_motion_composite"]
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

        gray = video.mean(axis=3)
        masks = [motion_mask(gray[i - 1], gray[i]) for i in range(1, gray.shape[0])]
        comp = composite(masks)
        hub = _hub(ctx, n0, n1)
        env = outer_envelope(comp, hub)
        if not (env > 0).any():
            return ClubTrackingResult(test_id=self.id, label=self.label,
                                      version=self.version, observations=[],
                                      diagnostics={"reason": "no_motion"})

        observations = []
        for i, m in enumerate(masks):
            f = n0 + i + 1
            pick = frame_head_pick(m, hub, env)
            if pick is None:
                continue
            x, y, support = pick
            conf = float(np.clip(0.3 + 0.5 * support, 0.1, 0.8))
            observations.append(ClubObservation(
                frame=f, source_time_s=f / ctx.fps, x=x, y=y,
                confidence=round(conf, 5),
                mode="observed" if support > 0.08 else "mixed",
                source="motion_envelope", visibility="visible"))

        cov = (env > 0).mean()
        return ClubTrackingResult(
            test_id=self.id, label=self.label, version=self.version,
            observations=observations,
            diagnostics={"envelope_coverage": round(float(cov), 4),
                         "hub": [round(hub[0], 4), round(hub[1], 4)],
                         "frames_picked": len(observations)})
