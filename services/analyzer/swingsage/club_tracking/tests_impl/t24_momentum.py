"""Test 24 — Momentum (user design, 2026-08-08).

t21's recipe under physics discipline: green-gated red boxes are both the authority and
the physics source — their timing gives the club's momentum — and every fill (legacy
downswing patches, the ball-impact head) must live inside the momentum corridor the reds
imply. Rendered as centripetal Catmull-Rom by default (`default_style = "catmull"`).
Knobs live in momentum.py.
"""
from __future__ import annotations

import json

from ..ball_departure import departure_frame, find_ball_spot
from ..interface import ClubTrackingContext, ClubTrackingResult
from ..model import ClubObservation, EventEvidence
from ..momentum import momentum_ok, red_velocities
from ..registry import TEST_IDS, register
from .t3_point_tracking import _load_window
from .t20_raw_head_trace import _artifact_heads, _sidecar_heads

LEGACY_MIN_CONF = 0.3
BALL_SEARCH_AHEAD = 12


@register
class MomentumTracker:
    id = "t24_momentum"
    label = TEST_IDS["t24_momentum"]
    version = "1.0.0"
    default_style = "catmull"

    def __init__(self, loader=None, raw_models_doc=None):
        self._loader = loader or _load_window
        self._raw_models_doc = raw_models_doc

    def run(self, ctx: ClubTrackingContext) -> ClubTrackingResult:
        n0 = ctx.events.get("address", 0)
        n1 = ctx.events.get("impact", ctx.frame_count - 1)
        top = ctx.events.get("top", (n0 + n1) // 2)

        red_full = _artifact_heads(ctx) or _sidecar_heads(ctx)
        reds = {f: (x, y) for f, (x, y, _p) in red_full.items() if n0 <= f <= n1}
        if len(reds) < 4:
            return ClubTrackingResult(
                test_id=self.id, label=self.label, version=self.version,
                observations=[], diagnostics={"reason": "too_few_verified_reds"})
        vels = red_velocities(reds, ctx.fps)

        obs: dict[int, ClubObservation] = {
            f: ClubObservation(frame=f, source_time_s=f / ctx.fps, x=x, y=y,
                               confidence=round(red_full[f][2], 5), mode="observed",
                               source="detector", visibility="visible")
            for f, (x, y) in reds.items()
        }

        # ---- legacy fills, momentum-gated ----
        filled = vetoed = 0
        legacy = {cf["f"]: cf for cf in (ctx.doc.get("club") or {}).get("frames") or []
                  if cf.get("head") and cf.get("conf", 0) >= LEGACY_MIN_CONF}
        for f in range(top, n1 + 1):
            if f in obs or f not in legacy:
                continue
            hx, hy = legacy[f]["head"]
            if momentum_ok(f, hx, hy, reds, vels, ctx.fps):
                filled += 1
                obs[f] = ClubObservation(
                    frame=f, source_time_s=f / ctx.fps, x=hx, y=hy,
                    confidence=round(legacy[f]["conf"] * 0.8, 5), mode="mixed",
                    source="classical", visibility="visible")
            else:
                vetoed += 1

        # ---- ball impact, momentum-gated the same way ----
        evidence: list[EventEvidence] = []
        diag: dict = {"verified_reds": len(reds), "legacy_filled": filled,
                      "momentum_vetoed": vetoed}
        raw_doc = self._raw_models_doc
        if raw_doc is None and ctx.out_dir is not None:
            p = ctx.out_dir / "raw_models.json"
            if p.exists():
                try:
                    raw_doc = json.loads(p.read_text(encoding="utf-8"))
                except json.JSONDecodeError:
                    raw_doc = None
        spot = find_ball_spot(raw_doc, n0)
        if spot is not None:
            hi = min(n1 + BALL_SEARCH_AHEAD, ctx.frame_count - 1)
            video = self._loader(ctx, n0, hi)
            if video is not None:
                dep = departure_frame(video.mean(axis=3), n0, spot,
                                      address_frame=n0, search_from=top)
                diag["ball_departure_frame"] = dep
                if dep is not None:
                    impact_f = max(dep - 1, n0)
                    evidence.append(EventEvidence(
                        event="impact", time_s=impact_f / ctx.fps,
                        confidence=0.85, source="ball_departure"))
                    if ((impact_f not in obs or obs[impact_f].mode != "observed")
                            and momentum_ok(impact_f, spot[0], spot[1], reds, vels,
                                            ctx.fps)):
                        obs[impact_f] = ClubObservation(
                            frame=impact_f, source_time_s=impact_f / ctx.fps,
                            x=spot[0], y=spot[1], confidence=0.7, mode="mixed",
                            source="ball_departure", visibility="visible")

        return ClubTrackingResult(
            test_id=self.id, label=self.label, version=self.version,
            observations=[obs[f] for f in sorted(obs)], event_evidence=evidence,
            diagnostics=diag)
