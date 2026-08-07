"""Test 25 — Gated, Red, Legacy, Ball (user recipe 2026-08-08).

t21's full recipe under t19's isolation gate: green-gated red boxes as heads, legacy
filling downswing holes, ball-departure marking impact — and EVERY position must answer
to the club-only motion rings:

    inside a ring (+margin) -> kept at full strength
    outside every ring      -> dropped, whatever said it
    no rings on that frame  -> kept at reduced confidence (the gate cannot testify)
"""
from __future__ import annotations

import json

from ..ball_departure import departure_frame, find_ball_spot
from ..interface import ClubTrackingContext, ClubTrackingResult
from ..model import ClubObservation, EventEvidence
from ..registry import TEST_IDS, register
from .t3_point_tracking import _load_window
from .t19_legacy_isolation_gate import _load_club_only, near_rings
from .t20_raw_head_trace import _artifact_heads, _sidecar_heads

LEGACY_MIN_CONF = 0.3
BALL_SEARCH_AHEAD = 12
UNVERIFIED_FACTOR = 0.7   # confidence multiplier when isolation has no rings to check


def isolation_verdict(rings_by_frame: dict[int, list], f: int,
                      x: float, y: float) -> str:
    """'in' | 'out' | 'unverifiable' against the club-only rings."""
    rings = rings_by_frame.get(f)
    if not rings:
        return "unverifiable"
    return "in" if near_rings(x, y, rings) else "out"


@register
class GatedRedLegacyBallTracker:
    id = "t25_gated_red_legacy_ball"
    label = TEST_IDS["t25_gated_red_legacy_ball"]
    version = "1.0.0"

    def __init__(self, loader=None, raw_models_doc=None, rings_by_frame=None):
        self._loader = loader or _load_window
        self._raw_models_doc = raw_models_doc
        self._rings = rings_by_frame          # test injection

    def run(self, ctx: ClubTrackingContext) -> ClubTrackingResult:
        rings = self._rings if self._rings is not None else _load_club_only(ctx)
        if rings is None:
            return ClubTrackingResult(
                test_id=self.id, label=self.label, version=self.version,
                observations=[],
                diagnostics={"reason": "no_club_only_artifact",
                             "hint": "run scripts/isolate.py"})

        n0 = ctx.events.get("address", 0)
        n1 = ctx.events.get("impact", ctx.frame_count - 1)
        top = ctx.events.get("top", (n0 + n1) // 2)

        red_full = _artifact_heads(ctx) or _sidecar_heads(ctx)
        if not red_full:
            return ClubTrackingResult(
                test_id=self.id, label=self.label, version=self.version,
                observations=[], diagnostics={"reason": "no_raw_head_boxes"})

        obs: dict[int, ClubObservation] = {}
        stats = {"red_in": 0, "red_out": 0, "red_unverifiable": 0,
                 "legacy_in": 0, "legacy_out": 0, "legacy_unverifiable": 0}

        for f, (x, y, p) in red_full.items():
            if not n0 <= f <= n1:
                continue
            v = isolation_verdict(rings, f, x, y)
            if v == "out":
                stats["red_out"] += 1
                continue
            reduced = v == "unverifiable"
            stats["red_unverifiable" if reduced else "red_in"] += 1
            obs[f] = ClubObservation(
                frame=f, source_time_s=f / ctx.fps, x=x, y=y,
                confidence=round(p * (UNVERIFIED_FACTOR if reduced else 1.0), 5),
                mode="mixed" if reduced else "observed",
                source="detector", visibility="visible")

        legacy = {cf["f"]: cf for cf in (ctx.doc.get("club") or {}).get("frames") or []
                  if cf.get("head") and cf.get("conf", 0) >= LEGACY_MIN_CONF}
        for f in range(top, n1 + 1):
            if f in obs or f not in legacy:
                continue
            hx, hy = legacy[f]["head"]
            v = isolation_verdict(rings, f, hx, hy)
            if v == "out":
                stats["legacy_out"] += 1
                continue
            reduced = v == "unverifiable"
            stats["legacy_unverifiable" if reduced else "legacy_in"] += 1
            conf = legacy[f]["conf"] * 0.8 * (UNVERIFIED_FACTOR if reduced else 1.0)
            obs[f] = ClubObservation(
                frame=f, source_time_s=f / ctx.fps, x=hx, y=hy,
                confidence=round(conf, 5), mode="mixed",
                source="classical", visibility="visible")

        # ---- ball impact, isolation-gated like everything else ----
        evidence: list[EventEvidence] = []
        diag: dict = dict(stats)
        raw_doc = self._raw_models_doc
        if raw_doc is None and ctx.out_dir is not None:
            p_ = ctx.out_dir / "raw_models.json"
            if p_.exists():
                try:
                    raw_doc = json.loads(p_.read_text(encoding="utf-8"))
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
                    v = isolation_verdict(rings, impact_f, spot[0], spot[1])
                    if v != "out" and (impact_f not in obs
                                       or obs[impact_f].mode != "observed"):
                        obs[impact_f] = ClubObservation(
                            frame=impact_f, source_time_s=impact_f / ctx.fps,
                            x=spot[0], y=spot[1],
                            confidence=round(0.7 * (UNVERIFIED_FACTOR
                                                    if v == "unverifiable" else 1.0), 5),
                            mode="mixed", source="ball_departure",
                            visibility="visible")

        return ClubTrackingResult(
            test_id=self.id, label=self.label, version=self.version,
            observations=[obs[f] for f in sorted(obs)], event_evidence=evidence,
            diagnostics=diag)
