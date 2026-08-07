"""Test 27 — Red Boxes + Legacy Fill (user request 2026-08-08): the plain one.

Green-gated red boxes are the heads; the legacy solve fills EVERY frame that has no red,
across the whole swing window. Nothing else — no ball cue, no isolation gate, no momentum,
no dedupe radius. The simplest composite of the two sources the user trusts.
"""
from __future__ import annotations

from ..interface import ClubTrackingContext, ClubTrackingResult
from ..model import ClubObservation
from ..registry import TEST_IDS, register
from .t20_raw_head_trace import _artifact_heads, _sidecar_heads

LEGACY_MIN_CONF = 0.3


@register
class RedLegacyTracker:
    id = "t27_red_legacy"
    label = TEST_IDS["t27_red_legacy"]
    version = "1.0.0"

    def run(self, ctx: ClubTrackingContext) -> ClubTrackingResult:
        n0 = ctx.events.get("address", 0)
        n1 = ctx.events.get("impact", ctx.frame_count - 1)

        reds = {f: h for f, h in (_artifact_heads(ctx) or _sidecar_heads(ctx)).items()
                if n0 <= f <= n1}
        if not reds:
            return ClubTrackingResult(
                test_id=self.id, label=self.label, version=self.version,
                observations=[], diagnostics={"reason": "no_raw_head_boxes"})

        obs: dict[int, ClubObservation] = {
            f: ClubObservation(frame=f, source_time_s=f / ctx.fps, x=x, y=y,
                               confidence=round(p, 5), mode="observed",
                               source="detector", visibility="visible")
            for f, (x, y, p) in reds.items()
        }

        filled = 0
        for cf in (ctx.doc.get("club") or {}).get("frames") or []:
            f, head, conf = cf.get("f"), cf.get("head"), cf.get("conf", 0.0)
            if (head is None or f is None or not n0 <= f <= n1
                    or f in obs or conf < LEGACY_MIN_CONF):
                continue
            filled += 1
            obs[f] = ClubObservation(
                frame=f, source_time_s=f / ctx.fps, x=head[0], y=head[1],
                confidence=round(conf * 0.8, 5), mode="mixed",
                source="classical", visibility="visible")

        return ClubTrackingResult(
            test_id=self.id, label=self.label, version=self.version,
            observations=[obs[f] for f in sorted(obs)],
            diagnostics={"red_heads": len(reds), "legacy_filled": filled})
