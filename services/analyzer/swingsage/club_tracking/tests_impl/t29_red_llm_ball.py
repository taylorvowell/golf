"""Test 29 — Red Box Only + LLM + Ball (user request 2026-08-08).

t28 verbatim — green-gated reds, LLM verify/adjust on the five highest-momentum downswing
frames — plus t21's ball-departure cue: the ball vanishing marks impact, and an impact
head lands at the ball spot when no full-strength red already owns that frame.
"""
from __future__ import annotations

import json

from ..ball_departure import departure_frame, find_ball_spot
from ..interface import ClubTrackingContext, ClubTrackingResult
from ..model import ClubObservation, EventEvidence
from ..registry import TEST_IDS, register
from .t28_red_llm import RedLlmTracker

BALL_SEARCH_AHEAD = 12


@register
class RedLlmBallTracker(RedLlmTracker):
    id = "t29_red_llm_ball"
    label = TEST_IDS["t29_red_llm_ball"]
    version = "1.0.0"

    def __init__(self, provider=None, loader=None, raw_models_doc=None):
        super().__init__(provider=provider, loader=loader)
        self._raw_models_doc = raw_models_doc

    def run(self, ctx: ClubTrackingContext) -> ClubTrackingResult:
        res = super().run(ctx)
        res.test_id, res.label = self.id, self.label
        if not res.observations:
            return res

        n0 = ctx.events.get("address", 0)
        n1 = ctx.events.get("impact", ctx.frame_count - 1)
        top = ctx.events.get("top", (n0 + n1) // 2)

        raw_doc = self._raw_models_doc
        if raw_doc is None and ctx.out_dir is not None:
            p = ctx.out_dir / "raw_models.json"
            if p.exists():
                try:
                    raw_doc = json.loads(p.read_text(encoding="utf-8"))
                except json.JSONDecodeError:
                    raw_doc = None
        spot = find_ball_spot(raw_doc, n0)
        res.diagnostics["ball_spot"] = ([round(spot[0], 4), round(spot[1], 4)]
                                        if spot else None)
        if spot is None:
            return res

        hi = min(n1 + BALL_SEARCH_AHEAD, ctx.frame_count - 1)
        video = self._loader(ctx, n0, hi)
        if video is None:
            return res
        dep = departure_frame(video.mean(axis=3), n0, spot,
                              address_frame=n0, search_from=top)
        res.diagnostics["ball_departure_frame"] = dep
        if dep is None:
            return res
        impact_f = max(dep - 1, n0)
        res.event_evidence.append(EventEvidence(
            event="impact", time_s=impact_f / ctx.fps,
            confidence=0.85, source="ball_departure"))
        by = {o.frame: o for o in res.observations}
        prev = by.get(impact_f)
        if prev is None or prev.mode != "observed":
            by[impact_f] = ClubObservation(
                frame=impact_f, source_time_s=impact_f / ctx.fps,
                x=spot[0], y=spot[1], confidence=0.7, mode="mixed",
                source="ball_departure", visibility="visible")
            res.diagnostics["impact_head_from_ball"] = True
            res.observations = [by[f] for f in sorted(by)]
        return res
