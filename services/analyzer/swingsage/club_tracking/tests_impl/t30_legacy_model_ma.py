"""Test 30 — Legacy Model Head + Moving-Average Trace, SG-smoothed (user focus 2026-08-08).

Sources the LEGACY solver's own `model_trace_moving` variant — "Model head + trace:
moving average", i.e. the classical solve run with the detector's head and its trace
moving-averaged — and renders it with pure Savitzky-Golay by default
(`default_style = "savgol"`), which preserves the top and impact extrema better than the
moving average alone does.

This is the one legacy solution the user singled out, brought into the experiment
framework so it gets endpoint anchoring, the honest mode/confidence treatment and all 17
path fits like every other test.
"""
from __future__ import annotations

from ..interface import ClubTrackingContext, ClubTrackingResult
from ..model import ClubObservation
from ..registry import TEST_IDS, register

# preference order: the moving-average trace, then its unsmoothed and smoothed kin
VARIANT_ORDER = ("model_trace_moving", "model_trace_robust", "model_trace_measured",
                 "model_smooth", "model")
SPANS = ("backswing", "downswing")


@register
class LegacyModelMaTracker:
    id = "t30_legacy_model_ma"
    label = TEST_IDS["t30_legacy_model_ma"]
    version = "1.0.0"
    default_style = "savgol"

    def run(self, ctx: ClubTrackingContext) -> ClubTrackingResult:
        variants = ((ctx.doc.get("club") or {}).get("variants") or {})
        key = next((k for k in VARIANT_ORDER if k in variants), None)
        if key is None:
            return ClubTrackingResult(
                test_id=self.id, label=self.label, version=self.version,
                observations=[],
                diagnostics={"reason": "no_model_club_variant",
                             "hint": "re-run burnin.py with --club-detector"})
        var = variants[key]

        n0 = ctx.events.get("address", 0)
        n1 = ctx.events.get("impact", ctx.frame_count - 1)

        # per-frame confidence from the variant's own club frames, where it has them
        conf_by_frame = {cf["f"]: cf.get("conf", 0.0)
                         for cf in (var.get("frames") or []) if cf.get("f") is not None}

        # The TRACE carries the moving average (the frames do not) — that is the point of
        # this variant, so the trace points are the observations.
        pooled: dict[int, tuple[float, float]] = {}
        trace = var.get("trace") or {}
        tframes = var.get("trace_frames") or {}
        for span in SPANS:
            pts = trace.get(span) or []
            fs = tframes.get(span) or []
            if len(fs) != len(pts):
                continue                      # no honest frame mapping for this span
            for f, (x, y) in zip(fs, pts):
                if n0 <= f <= n1:
                    pooled[f] = (x, y)

        if len(pooled) < 4:
            return ClubTrackingResult(
                test_id=self.id, label=self.label, version=self.version,
                observations=[],
                diagnostics={"reason": "trace_too_sparse", "variant": key,
                             "points": len(pooled)})

        observations = [
            ClubObservation(
                frame=f, source_time_s=f / ctx.fps, x=x, y=y,
                confidence=round(max(conf_by_frame.get(f, 0.6), 0.05), 5),
                mode="observed", source="classical", visibility="visible")
            for f, (x, y) in sorted(pooled.items())
        ]
        gaps = [b.frame - a.frame for a, b in zip(observations, observations[1:])]
        return ClubTrackingResult(
            test_id=self.id, label=self.label, version=self.version,
            observations=observations,
            diagnostics={"variant": key, "label": var.get("label"),
                         "points": len(observations),
                         "longest_gap_frames": max(gaps) if gaps else 0})
