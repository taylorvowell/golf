"""Test 22 — Red + Deduped Legacy (user recipe 2026-08-08, v2).

"Red boxes are most reliable, but the legacy trace does a good job": red heads rule; a
legacy mark is REMOVED when a red already represents that moment and place (same frame,
or a red within a few frames sitting within the dedupe radius); every other legacy mark is
KEPT — they are the coverage the reds missed, anywhere in the swing, not just the
downswing. Ball-departure impact anchoring rides along from t21.
"""
from __future__ import annotations

import json

import numpy as np

from ..ball_departure import departure_frame, find_ball_spot
from ..interface import ClubTrackingContext, ClubTrackingResult
from ..model import ClubObservation, EventEvidence
from ..registry import TEST_IDS, register
from .t3_point_tracking import _load_window
from .t20_raw_head_trace import _artifact_heads, _sidecar_heads

LEGACY_MIN_CONF = 0.3
DEDUP_RADIUS = 0.05      # normalized distance to a nearby red that makes legacy redundant
DEDUP_FRAMES = 3         # how many frames away that red may sit
BALL_SEARCH_AHEAD = 12


def dedupe_legacy(legacy: dict[int, tuple[float, float, float]],
                  reds: dict[int, tuple[float, float, float]]
                  ) -> tuple[dict[int, tuple[float, float, float]], int]:
    """Legacy marks minus the ones a red already represents. Pure.

    Dropped when: a red exists on the SAME frame (red wins the frame outright), or a red
    within ±DEDUP_FRAMES sits within DEDUP_RADIUS (the mark duplicates the red path).
    Returns (survivors, dropped_count)."""
    red_frames = sorted(reds)
    out: dict[int, tuple[float, float, float]] = {}
    dropped = 0
    for f, (x, y, c) in legacy.items():
        if f in reds:
            dropped += 1
            continue
        redundant = False
        for rf in red_frames:
            if abs(rf - f) > DEDUP_FRAMES:
                continue
            rx, ry, _ = reds[rf]
            if np.hypot(rx - x, ry - y) <= DEDUP_RADIUS:
                redundant = True
                break
        if redundant:
            dropped += 1
        else:
            out[f] = (x, y, c)
    return out, dropped


@register
class RedDedupTracker:
    id = "t22_red_dedup"
    label = TEST_IDS["t22_red_dedup"]
    version = "1.0.0"

    def __init__(self, loader=None, raw_models_doc=None):
        self._loader = loader or _load_window
        self._raw_models_doc = raw_models_doc

    def run(self, ctx: ClubTrackingContext) -> ClubTrackingResult:
        n0 = ctx.events.get("address", 0)
        n1 = ctx.events.get("impact", ctx.frame_count - 1)
        top = ctx.events.get("top", (n0 + n1) // 2)

        reds = {f: h for f, h in (_artifact_heads(ctx) or _sidecar_heads(ctx)).items()
                if n0 <= f <= n1}
        if not reds:
            return ClubTrackingResult(
                test_id=self.id, label=self.label, version=self.version,
                observations=[], diagnostics={"reason": "no_raw_head_boxes"})

        legacy = {cf["f"]: (cf["head"][0], cf["head"][1], cf["conf"])
                  for cf in (ctx.doc.get("club") or {}).get("frames") or []
                  if (cf.get("head") and cf.get("conf", 0) >= LEGACY_MIN_CONF
                      and n0 <= cf.get("f", -1) <= n1)}
        survivors, dropped = dedupe_legacy(legacy, reds)

        obs: dict[int, ClubObservation] = {}
        for f, (x, y, p) in reds.items():
            obs[f] = ClubObservation(frame=f, source_time_s=f / ctx.fps, x=x, y=y,
                                     confidence=round(p, 5), mode="observed",
                                     source="detector", visibility="visible")
        for f, (x, y, c) in survivors.items():
            obs[f] = ClubObservation(frame=f, source_time_s=f / ctx.fps, x=x, y=y,
                                     confidence=round(c * 0.8, 5), mode="mixed",
                                     source="classical", visibility="visible")

        # ---- ball departure -> impact evidence + impact head (t21's cue) ----
        evidence: list[EventEvidence] = []
        diag: dict = {"red_heads": len(reds), "legacy_kept": len(survivors),
                      "legacy_deduped": dropped}
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
                    if impact_f not in obs or obs[impact_f].mode != "observed":
                        obs[impact_f] = ClubObservation(
                            frame=impact_f, source_time_s=impact_f / ctx.fps,
                            x=spot[0], y=spot[1], confidence=0.7, mode="mixed",
                            source="ball_departure", visibility="visible")

        return ClubTrackingResult(
            test_id=self.id, label=self.label, version=self.version,
            observations=[obs[f] for f in sorted(obs)], event_evidence=evidence,
            diagnostics=diag)
