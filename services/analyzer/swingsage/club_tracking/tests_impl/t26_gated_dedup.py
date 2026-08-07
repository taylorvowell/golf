"""Test 26 — Gated, Red, Legacy, Ball, Deduped (user recipe 2026-08-08).

The full rule stack in one tracker, applied in order:

  1. red boxes, green-gated (hard rule), then ISOLATION-gated (t25's three verdicts);
  2. legacy marks ANYWHERE the surviving reds aren't (t22's whole-swing coverage),
     DEDUPED against those reds (same frame, or near one within a few frames), then
     isolation-gated like everything else;
  3. ball-departure impact evidence + gated impact head (t21's cue).
"""
from __future__ import annotations

import json

from ..ball_departure import departure_frame, find_ball_spot
from ..interface import ClubTrackingContext, ClubTrackingResult
from ..model import ClubObservation, EventEvidence
from ..registry import TEST_IDS, register
from .t3_point_tracking import _load_window
from .t19_legacy_isolation_gate import _load_club_only
from .t20_raw_head_trace import _artifact_heads, _sidecar_heads
from .t22_red_dedup import dedupe_legacy
from .t25_gated_red_legacy_ball import UNVERIFIED_FACTOR, isolation_verdict

LEGACY_MIN_CONF = 0.3
BALL_SEARCH_AHEAD = 12


@register
class GatedDedupTracker:
    id = "t26_gated_dedup"
    label = TEST_IDS["t26_gated_dedup"]
    version = "1.0.0"

    def __init__(self, loader=None, raw_models_doc=None, rings_by_frame=None):
        self._loader = loader or _load_window
        self._raw_models_doc = raw_models_doc
        self._rings = rings_by_frame

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

        # ---- 1. reds: green-gated already, now isolation-gated ----
        obs: dict[int, ClubObservation] = {}
        reds_kept: dict[int, tuple[float, float, float]] = {}
        stats = {"red_in": 0, "red_out": 0, "red_unverifiable": 0,
                 "legacy_deduped": 0, "legacy_in": 0, "legacy_out": 0,
                 "legacy_unverifiable": 0}
        for f, (x, y, p) in red_full.items():
            if not n0 <= f <= n1:
                continue
            v = isolation_verdict(rings, f, x, y)
            if v == "out":
                stats["red_out"] += 1
                continue
            reduced = v == "unverifiable"
            stats["red_unverifiable" if reduced else "red_in"] += 1
            reds_kept[f] = (x, y, p)
            obs[f] = ClubObservation(
                frame=f, source_time_s=f / ctx.fps, x=x, y=y,
                confidence=round(p * (UNVERIFIED_FACTOR if reduced else 1.0), 5),
                mode="mixed" if reduced else "observed",
                source="detector", visibility="visible")

        # ---- 2. legacy: whole-swing coverage, deduped vs surviving reds, then gated ----
        legacy = {cf["f"]: (cf["head"][0], cf["head"][1], cf["conf"])
                  for cf in (ctx.doc.get("club") or {}).get("frames") or []
                  if (cf.get("head") and cf.get("conf", 0) >= LEGACY_MIN_CONF
                      and n0 <= cf.get("f", -1) <= n1)}
        survivors, deduped = dedupe_legacy(legacy, reds_kept)
        stats["legacy_deduped"] = deduped
        for f, (x, y, c) in survivors.items():
            v = isolation_verdict(rings, f, x, y)
            if v == "out":
                stats["legacy_out"] += 1
                continue
            reduced = v == "unverifiable"
            stats["legacy_unverifiable" if reduced else "legacy_in"] += 1
            obs[f] = ClubObservation(
                frame=f, source_time_s=f / ctx.fps, x=x, y=y,
                confidence=round(c * 0.8 * (UNVERIFIED_FACTOR if reduced else 1.0), 5),
                mode="mixed", source="classical", visibility="visible")

        # ---- 3. ball impact ----
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
