"""Test 21 — Red Boxes + Legacy Fill + Ball Impact (user recipe 2026-08-08).

1. The detector's red (head-class) boxes ARE the heads — best per frame, `observed`.
2. Downswing holes only are filled from the original classical solve (`mixed`) — the
   backswing bridges honestly instead.
3. The ball's disappearance marks impact: an EventEvidence AND an impact head observation
   at the ball spot on the departure frame — the club must be there then. The occlusion
   trap (club sweeping past ≠ ball gone) is handled by the sustained-change rule in
   ball_departure.py.
"""
from __future__ import annotations

import json

from ..ball_departure import departure_frame, find_ball_spot
from ..interface import ClubTrackingContext, ClubTrackingResult
from ..model import ClubObservation, EventEvidence
from ..registry import TEST_IDS, register
from .t3_point_tracking import _load_window
from .t20_raw_head_trace import _artifact_heads, _sidecar_heads

LEGACY_MIN_CONF = 0.3
BALL_SEARCH_AHEAD = 12   # frames past the artifact impact the departure scan may run


@register
class RedBallTracker:
    id = "t21_red_legacy_ball"
    label = TEST_IDS["t21_red_legacy_ball"]
    version = "1.0.0"

    def __init__(self, loader=None, raw_models_doc=None):
        self._loader = loader or _load_window
        self._raw_models_doc = raw_models_doc     # test injection

    def run(self, ctx: ClubTrackingContext) -> ClubTrackingResult:
        n0 = ctx.events.get("address", 0)
        n1 = ctx.events.get("impact", ctx.frame_count - 1)
        top = ctx.events.get("top", (n0 + n1) // 2)

        heads = _artifact_heads(ctx) or _sidecar_heads(ctx)
        if not heads:
            return ClubTrackingResult(
                test_id=self.id, label=self.label, version=self.version,
                observations=[],
                diagnostics={"reason": "no_raw_head_boxes"})

        obs: dict[int, ClubObservation] = {
            f: ClubObservation(frame=f, source_time_s=f / ctx.fps, x=x, y=y,
                               confidence=round(p, 5), mode="observed",
                               source="detector", visibility="visible")
            for f, (x, y, p) in heads.items() if n0 <= f <= n1
        }

        # ---- downswing holes -> legacy solve (the user's fill rule) ----
        legacy_filled = 0
        legacy = {cf["f"]: cf for cf in (ctx.doc.get("club") or {}).get("frames") or []
                  if cf.get("head") and cf.get("conf", 0) >= LEGACY_MIN_CONF}
        for f in range(top, n1 + 1):
            if f in obs or f not in legacy:
                continue
            cf = legacy[f]
            legacy_filled += 1
            obs[f] = ClubObservation(
                frame=f, source_time_s=f / ctx.fps,
                x=cf["head"][0], y=cf["head"][1],
                confidence=round(cf["conf"] * 0.8, 5), mode="mixed",
                source="classical", visibility="visible")

        # ---- ball departure -> impact evidence + impact head ----
        evidence: list[EventEvidence] = []
        diag: dict = {"red_heads": len(heads), "legacy_filled": legacy_filled}
        raw_doc = self._raw_models_doc
        if raw_doc is None and ctx.out_dir is not None:
            p = ctx.out_dir / "raw_models.json"
            if p.exists():
                try:
                    raw_doc = json.loads(p.read_text(encoding="utf-8"))
                except json.JSONDecodeError:
                    raw_doc = None
        spot = find_ball_spot(raw_doc, n0)
        diag["ball_spot"] = ([round(spot[0], 4), round(spot[1], 4)]
                             if spot else None)
        if spot is not None:
            hi = min(n1 + BALL_SEARCH_AHEAD, ctx.frame_count - 1)
            video = self._loader(ctx, n0, hi)
            if video is not None:
                gray = video.mean(axis=3)
                dep = departure_frame(gray, n0, spot, address_frame=n0,
                                      search_from=top)
                diag["ball_departure_frame"] = dep
                if dep is not None:
                    impact_f = max(dep - 1, n0)   # the frame between there and gone
                    evidence.append(EventEvidence(
                        event="impact", time_s=impact_f / ctx.fps,
                        confidence=0.85, source="ball_departure"))
                    prev = obs.get(impact_f)
                    if prev is None or prev.mode != "observed":
                        obs[impact_f] = ClubObservation(
                            frame=impact_f, source_time_s=impact_f / ctx.fps,
                            x=spot[0], y=spot[1], confidence=0.7, mode="mixed",
                            source="ball_departure", visibility="visible")
                        diag["impact_head_from_ball"] = True

        return ClubTrackingResult(
            test_id=self.id, label=self.label, version=self.version,
            observations=[obs[f] for f in sorted(obs)], event_evidence=evidence,
            diagnostics=diag)
