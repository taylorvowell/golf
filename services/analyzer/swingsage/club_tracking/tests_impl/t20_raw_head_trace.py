"""Test 20 — Raw Head Trace (user request 2026-08-08): the red boxes, connected.

The purest possible baseline: the detector's highest-confidence HEAD detection per frame,
no solver, no gating, no other evidence — straight into the path-fit registry. If the raw
overlay looks right, this trace shows exactly what those boxes are worth as a line; every
difference between t20 and the solved tests is the solvers' contribution, for better or
worse.

Falls back to the raw_models.json sidecar's built-in run on swings whose artifact stored
no detector boxes (swing2's case).
"""
from __future__ import annotations

import json

from ..interface import ClubTrackingContext, ClubTrackingResult
from ..model import ClubObservation
from ..registry import TEST_IDS, register

HEAD_CLASS_NAME = "clubhead"

from ..red_gate import gated_heads  # noqa: E402  (the hard rule lives in one place)


def _best_heads(rows, is_head, is_green) -> dict[int, tuple[float, float, float]]:
    """Shared harvest: per frame, the best GREEN-VALIDATED red (red_gate hard rule)."""
    best: dict[int, tuple[float, float, float]] = {}
    for row in rows:
        f = row.get("f")
        for d in gated_heads(row.get("d") or [], is_head, is_green):
            p = d.get("p", 0.0)
            if f not in best or p > best[f][2]:
                best[f] = (d["xy"][0], d["xy"][1], p)
    return best


def _artifact_heads(ctx: ClubTrackingContext) -> dict[int, tuple[float, float, float]]:
    det = (ctx.doc.get("club") or {}).get("detector") or {}
    names = det.get("names") or {}
    head_classes = {int(k) for k, v in names.items() if v == HEAD_CLASS_NAME}
    return _best_heads(det.get("boxes") or [],
                       is_head=lambda d: d.get("c") in head_classes,
                       is_green=lambda d: d.get("c") not in head_classes)


def _sidecar_heads(ctx: ClubTrackingContext) -> dict[int, tuple[float, float, float]]:
    if ctx.out_dir is None:
        return {}
    p = ctx.out_dir / "raw_models.json"
    if not p.exists():
        return {}
    try:
        doc = json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    entry = (doc.get("models") or {}).get("builtin")
    return _best_heads((entry or {}).get("frames") or [],
                       is_head=lambda d: d.get("c") == 0,
                       is_green=lambda d: d.get("c") == 1)


@register
class RawHeadTraceTracker:
    id = "t20_raw_head_trace"
    label = TEST_IDS["t20_raw_head_trace"]
    version = "1.0.0"

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
        gaps = [b.frame - a.frame for a, b in zip(observations, observations[1:])]
        return ClubTrackingResult(
            test_id=self.id, label=self.label, version=self.version,
            observations=observations,
            diagnostics={"boxes_from": source, "kept": len(observations),
                         "longest_gap_frames": max(gaps) if gaps else 0})
