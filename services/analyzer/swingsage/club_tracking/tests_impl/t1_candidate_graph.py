"""Test 1 — Global Candidate Graph (plan §10).

Low-threshold detections + classical heads in, one Viterbi-style DP over the whole swing
out. Evidence is deduplicated to genuine source observations when source timing is present
(plan §3.1): duplicated CFR frames contribute their candidates once, at the observation's
first normalized frame.
"""
from __future__ import annotations

from ..candidates import harvest
from ..graph import solve
from ..interface import ClubTrackingContext, ClubTrackingResult
from ..model import ClubObservation
from ..registry import TEST_IDS, register


@register
class CandidateGraphTracker:
    id = "t1_candidate_graph"
    label = TEST_IDS["t1_candidate_graph"]
    version = "1.0.0"

    def run(self, ctx: ClubTrackingContext) -> ClubTrackingResult:
        cands = harvest(ctx)

        # One evidence slot per genuine source observation (plan §3.1). Without timing,
        # every normalized frame is its own observation (legacy fallback).
        if ctx.source_timing is not None and ctx.source_timing.observations:
            groups = [o.normalized_frames for o in ctx.source_timing.observations
                      if o.normalized_frames]
        else:
            groups = [[f] for f in sorted(cands)]

        obs_frames: list[int] = []          # representative frame per observation
        cands_by_obs = []
        for gf in groups:
            pooled = []
            for f in gf:
                pooled.extend(cands.get(f, []))
            if not pooled and not any(f in cands for f in gf):
                # keep the slot only if the swing window covers it
                pass
            rep = gf[0]
            if pooled or cands_by_obs:      # skip leading all-empty slots
                obs_frames.append(rep)
                # Duplicated frames repeat the same detections; keep the strongest per
                # (x, y) cell so a 2x-duplicated frame is not double evidence.
                seen: dict[tuple[int, int], object] = {}
                for c in pooled:
                    key = (round(c.x * 400), round(c.y * 400))
                    prev = seen.get(key)
                    if prev is None or c.confidence > prev.confidence:  # type: ignore[union-attr]
                        seen[key] = c
                cands_by_obs.append(list(seen.values()))

        times = [f / ctx.fps for f in obs_frames]
        chain = solve(cands_by_obs, times)

        observations = [
            ClubObservation(
                frame=obs_frames[i], source_time_s=times[i],
                x=c.x, y=c.y, confidence=round(c.confidence, 5),
                mode="observed", source=c.source, visibility="visible")
            for i, c in chain
        ]

        gaps = [observations[k + 1].frame - observations[k].frame
                for k in range(len(observations) - 1)]
        n_cands = sum(len(v) for v in cands.values())
        return ClubTrackingResult(
            test_id=self.id, label=self.label, version=self.version,
            observations=observations,
            diagnostics={
                "candidate_count": n_cands,
                "observation_slots": len(cands_by_obs),
                "chosen": len(observations),
                "longest_skip_frames": max(gaps) if gaps else 0,
            })
