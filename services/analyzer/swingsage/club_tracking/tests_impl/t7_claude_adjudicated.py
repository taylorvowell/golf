"""Test 7 — Claude Bounded Adjudication (plan §16).

Deterministic candidate solutions first (t8 fused, t10 physics, t1 graph — whatever is
cached); Claude is consulted ONLY when they genuinely disagree, answers multiple-choice,
and any failure falls back to the deterministic winner. Easy swings cost 0 AI calls.
"""
from __future__ import annotations

from pathlib import Path

from ..adjudication import (adjudicate, build_prompt, deterministic_winner,
                            hypothesis_divergence)
from ..interface import ClubTrackingContext, ClubTrackingResult
from ..model import ClubObservation, EventEvidence
from ..registry import TEST_IDS, register

HYPO_IDS = ("t8_phase_fusion", "t10_physics_conic", "t1_candidate_graph")
N_CROPS = 6
DOT_COLORS = {0: (60, 60, 235), 1: (60, 200, 60), 2: (235, 120, 60)}  # BGR: A red, B green, C blue


def _write_crops(ctx: ClubTrackingContext, hypos: dict[str, list[dict]],
                 frames: list[int]) -> list[str]:
    if ctx.out_dir is None:
        return []
    import cv2
    video = ctx.out_dir / "analysis.mp4"
    if not video.exists():
        return []
    dbg = ctx.out_dir / "debug" / "club" / "t7"
    dbg.mkdir(parents=True, exist_ok=True)
    wanted = set(frames)
    by_frame = {tid: {p["frame"]: p for p in pts} for tid, pts in hypos.items()}
    ordered = sorted(hypos)
    out: list[str] = []
    cap = cv2.VideoCapture(str(video))
    f = 0
    while wanted:
        ok, img = cap.read()
        if not ok:
            break
        if f in wanted:
            wanted.discard(f)
            h, w = img.shape[:2]
            for k, tid in enumerate(ordered):
                p = by_frame[tid].get(f)
                if p is None:
                    continue
                c = DOT_COLORS[k]
                cv2.circle(img, (int(p["x"] * w), int(p["y"] * h)), 9, c, 2)
                cv2.putText(img, chr(ord("A") + k),
                            (int(p["x"] * w) + 12, int(p["y"] * h) - 8),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.7, c, 2)
            path = dbg / f"frame_{f:04d}.jpg"
            cv2.imwrite(str(path), img, [cv2.IMWRITE_JPEG_QUALITY, 85])
            out.append(str(path))
        f += 1
    cap.release()
    return out


@register
class ClaudeAdjudicatedTracker:
    id = "t7_claude_adjudicated"
    label = TEST_IDS["t7_claude_adjudicated"]
    version = "1.0.0"

    def __init__(self, provider=None, crop_writer=None):
        self._provider = provider          # None -> real CLI inside adjudicate()
        self._crop_writer = crop_writer or _write_crops

    def run(self, ctx: ClubTrackingContext) -> ClubTrackingResult:
        experiments = ((ctx.doc.get("club_tracking") or {}).get("experiments") or {})
        hypos = {tid: (experiments[tid].get("trace", {}).get("variants", {})
                       .get("default") or [])
                 for tid in HYPO_IDS if tid in experiments}
        hypos = {tid: pts for tid, pts in hypos.items() if len(pts) >= 5}
        if len(hypos) < 2:
            return ClubTrackingResult(
                test_id=self.id, label=self.label, version=self.version,
                observations=[], diagnostics={
                    "reason": "needs_cached_hypotheses", "found": sorted(hypos)})

        events_by_hypo = {tid: experiments[tid].get("events", {}) for tid in hypos}
        div = hypothesis_divergence(hypos, events_by_hypo)

        winner = deterministic_winner(hypos)
        status = "no_adjudication_needed"
        decision_meta: dict = {}

        if div["ambiguous"]:
            top_f = ctx.events.get("top", ctx.frame_count // 2)
            imp_f = ctx.events.get("impact", ctx.frame_count - 1)
            frames = sorted({top_f - 3, top_f, top_f + 3,
                             imp_f - 4, imp_f - 2, imp_f})
            images = self._crop_writer(ctx, hypos, frames)
            labels = {tid: experiments[tid]["test"]["label"] for tid in hypos}
            prompt = build_prompt(labels, {"divergence": div}, images)
            cache = (ctx.out_dir / "debug" / "club" / "t7" / "cache.json"
                     if ctx.out_dir else None)
            resp, status = adjudicate(prompt, n_candidates=len(hypos),
                                      cache_path=cache, provider=self._provider)
            if resp is not None:
                decision_meta = resp   # recorded even for "none" — the refusal is data
                if resp["decision"] != "none":
                    idx = ord(resp["decision"][-1]) - ord("a")
                    ordered = sorted(hypos)
                    if 0 <= idx < len(ordered):
                        winner = ordered[idx]

        pts = hypos[winner]
        ai_decided = bool(decision_meta) and decision_meta.get("decision") != "none"
        observations = [
            ClubObservation(
                frame=p["frame"], source_time_s=p["frame"] / ctx.fps,
                x=p["x"], y=p["y"], confidence=p["confidence"],
                mode=p["mode"],
                source="claude_choice" if ai_decided else "fused",
                visibility="visible" if p["mode"] != "inferred" else "unobservable")
            for p in pts
        ]

        evidence: list[EventEvidence] = []
        if ai_decided:
            for name, key in (("top", "top_adjustment_frames"),
                              ("impact", "impact_adjustment_frames")):
                adj = decision_meta.get(key, 0)
                base = ctx.events.get(name)
                if adj and base is not None:
                    evidence.append(EventEvidence(
                        event=name, time_s=(base + adj) / ctx.fps,
                        confidence=min(decision_meta.get("confidence", 0.5), 0.9),
                        source="existing_event_model"))

        return ClubTrackingResult(
            test_id=self.id, label=self.label, version=self.version,
            observations=observations, event_evidence=evidence,
            diagnostics={
                "hypotheses": sorted(hypos), "winner": winner,
                "adjudication": status, **div,
                **({"decision": decision_meta} if decision_meta else {}),
            })
