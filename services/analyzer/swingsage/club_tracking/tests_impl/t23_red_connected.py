"""Test 23 — Frame Red Box Connected (user request 2026-08-08).

The red boxes joined by STRAIGHT LINES — nothing else. `default_style = "linear"` makes
the Default variant pure chord connection (via the runner -> pathfit), so what you see first
is exactly the dots connected; every lettered smoothing then applies to that same whole
polyline, so clicking through them shows precisely what each method does to the raw line.
"""
from __future__ import annotations

from ..interface import ClubTrackingContext, ClubTrackingResult
from ..model import ClubObservation
from ..registry import TEST_IDS, register
from .t20_raw_head_trace import _artifact_heads, _sidecar_heads


@register
class RedConnectedTracker:
    id = "t23_red_connected"
    label = TEST_IDS["t23_red_connected"]
    version = "1.0.0"
    default_style = "linear"  # the runner passes this to fit_variants

    def run(self, ctx: ClubTrackingContext) -> ClubTrackingResult:
        heads = _artifact_heads(ctx)
        source = "artifact"
        if not heads:
            heads = _sidecar_heads(ctx)
            source = "raw_models_sidecar"
        if not heads:
            return ClubTrackingResult(
                test_id=self.id, label=self.label, version=self.version,
                observations=[],
                diagnostics={"reason": "no_raw_head_boxes",
                             "hint": "run scripts/rawmodels.py --model builtin"})

        n0 = ctx.events.get("address", 0)
        n1 = ctx.events.get("impact", ctx.frame_count - 1)
        observations = [
            ClubObservation(frame=f, source_time_s=f / ctx.fps, x=x, y=y,
                            confidence=round(p, 5), mode="observed",
                            source="detector", visibility="visible")
            for f, (x, y, p) in sorted(heads.items()) if n0 <= f <= n1
        ]
        return ClubTrackingResult(
            test_id=self.id, label=self.label, version=self.version,
            observations=observations,
            diagnostics={"boxes_from": source, "kept": len(observations),
                         "default_is": "straight_chords"})
