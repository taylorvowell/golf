"""Test 8 — Phase-Adaptive Multi-Tracker Fusion (plan §17).

Fuses the CACHED experiments already merged into the artifact — run the individual tests
first (the runner caches them; plan §28) and t8 reads their observations per frame,
weights by phase/confidence/mode, ejects outliers, and records disagreement. Event
evidence: the highest-confidence per event across expert experiments (t12's audio impact
included) is re-emitted, so fusion inherits the refined boundaries too.
"""
from __future__ import annotations

from ..fusion import fuse_frame, phase_of
from ..interface import ClubTrackingContext, ClubTrackingResult
from ..model import ClubObservation, EventEvidence
from ..registry import TEST_IDS, register

EXPERT_IDS = ("t1_candidate_graph", "t3_point_tracking", "t4_video_segmentation",
              "t5_blur_flow", "t6_grip_kinematic", "t10_physics_conic")


@register
class PhaseAdaptiveFusionTracker:
    id = "t8_phase_fusion"
    label = TEST_IDS["t8_phase_fusion"]
    version = "1.0.0"

    def run(self, ctx: ClubTrackingContext) -> ClubTrackingResult:
        experiments = ((ctx.doc.get("club_tracking") or {}).get("experiments") or {})
        experts = {tid: exp for tid, exp in experiments.items() if tid in EXPERT_IDS}
        if len(experts) < 2:
            return ClubTrackingResult(
                test_id=self.id, label=self.label, version=self.version,
                observations=[],
                diagnostics={"reason": "needs_cached_expert_experiments",
                             "found": sorted(experts)})

        # per-frame pool of expert opinions, from each experiment's DEFAULT variant —
        # the tracker's own recommended fit, already sampled on the shared frame grid
        pool: dict[int, list[tuple[str, float, float, float, str]]] = {}
        for tid, exp in experts.items():
            for p in (exp.get("trace", {}).get("variants", {}).get("default") or []):
                pool.setdefault(p["frame"], []).append(
                    (tid, p["x"], p["y"], p["confidence"], p["mode"]))

        observations = []
        disagreements = []
        contributor_counts: dict[str, int] = {}
        for f in sorted(pool):
            fused = fuse_frame(pool[f], phase_of(f, ctx.events))
            if fused is None:
                continue
            x, y, conf, mode, disagreement, contributors = fused
            disagreements.append(disagreement)
            for c in contributors:
                contributor_counts[c] = contributor_counts.get(c, 0) + 1
            observations.append(ClubObservation(
                frame=f, source_time_s=f / ctx.fps, x=x, y=y,
                confidence=round(conf, 5), mode=mode, source="fused",
                visibility="visible" if mode != "inferred" else "unobservable"))

        # inherit the best event evidence across experiments (incl. t12's audio impact)
        evidence: list[EventEvidence] = []
        best: dict[str, tuple[float, float, str]] = {}
        for tid, exp in experiments.items():
            for name, ev in (exp.get("events") or {}).items():
                if ev.get("source") in (None, "artifact"):
                    continue
                cur = best.get(name)
                if cur is None or ev["confidence"] > cur[1]:
                    best[name] = (ev["time_s"], ev["confidence"], tid)
        for name, (t, c, tid) in best.items():
            if name in ("address", "top", "impact"):
                evidence.append(EventEvidence(event=name, time_s=t, confidence=c,
                                              source="club_trajectory"))

        import numpy as np
        return ClubTrackingResult(
            test_id=self.id, label=self.label, version=self.version,
            observations=observations, event_evidence=evidence,
            diagnostics={
                "experts_used": sorted(experts),
                "expert_agreement": round(
                    1.0 - float(np.mean(disagreements)) / 0.06, 4)
                if disagreements else 0.0,
                "mean_disagreement": round(float(np.mean(disagreements)), 5)
                if disagreements else None,
                "contributions": contributor_counts,
            })
