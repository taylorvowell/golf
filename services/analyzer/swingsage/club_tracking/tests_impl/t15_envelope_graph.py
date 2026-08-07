"""Test 15 — Envelope-Constrained Candidate Graph (user brainstorm combo).

t13's motion envelope as a hard corridor prior inside t1's global solve: a detection must
live on or near the swept outer path, or it pays. The combo the brainstorm asked for —
motion isolation constraining the detector stream.
"""
from __future__ import annotations

import numpy as np

from ..candidates import harvest
from ..graph import solve
from ..interface import ClubTrackingContext, ClubTrackingResult
from ..model import ClubObservation
from ..motion_trace import (composite, envelope_distance, motion_mask, outer_envelope)
from ..registry import TEST_IDS, register
from .t3_point_tracking import _load_window
from .t13_motion_composite import _hub

W_ENVELOPE = 9.0        # candidate confidence decay per unit off-corridor distance


@register
class EnvelopeGraphTracker:
    id = "t15_envelope_graph"
    label = TEST_IDS["t15_envelope_graph"]
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

        cands = harvest(ctx)
        # corridor prior: decay each candidate's confidence by its envelope distance
        rejected = 0
        for f, slot in cands.items():
            kept = []
            for c in slot:
                d = envelope_distance(env, hub, c.x, c.y, (w, h))
                c.features["envelope_distance"] = d
                c.confidence = float(np.clip(
                    c.confidence * np.exp(-W_ENVELOPE * max(0.0, d - 0.02)), 0.01, 1.0))
                if c.confidence < 0.03:
                    rejected += 1
                    continue
                kept.append(c)
            cands[f] = kept

        if ctx.source_timing is not None and ctx.source_timing.observations:
            groups = [o.normalized_frames for o in ctx.source_timing.observations
                      if o.normalized_frames]
        else:
            groups = [[f] for f in sorted(cands)]
        obs_frames, cands_by_obs = [], []
        for gf in groups:
            pooled = []
            for f in gf:
                pooled.extend(cands.get(f, []))
            if pooled or cands_by_obs:
                obs_frames.append(gf[0])
                cands_by_obs.append(pooled)
        times = [f / ctx.fps for f in obs_frames]
        chain = solve(cands_by_obs, times)

        observations = [
            ClubObservation(frame=obs_frames[i], source_time_s=times[i],
                            x=c.x, y=c.y, confidence=round(c.confidence, 5),
                            mode="observed", source=c.source, visibility="visible")
            for i, c in chain
        ]
        return ClubTrackingResult(
            test_id=self.id, label=self.label, version=self.version,
            observations=observations,
            diagnostics={"corridor_rejected": rejected,
                         "chosen": len(observations),
                         "envelope_coverage": round(float((env > 0).mean()), 4)})
