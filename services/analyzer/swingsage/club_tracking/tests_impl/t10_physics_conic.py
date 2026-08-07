"""Test 10 — Physics-Constrained Conic / Factor-Graph Optimization (plan §19).

Ordinary noisy candidates + better mathematics, nothing else. The mode split is the
honesty line: an observation whose solution point has an associated candidate within the
gate is `observed` (tight) or `mixed` (loose); no candidate at all -> `inferred`.
"""
from __future__ import annotations

import numpy as np

from ..candidates import harvest
from ..event_refiner import refine
from ..interface import ClubTrackingContext, ClubTrackingResult
from ..model import ClubObservation
from ..physics_fit import ASSOC_GATE, solve
from ..registry import TEST_IDS, register


@register
class PhysicsConicTracker:
    id = "t10_physics_conic"
    label = TEST_IDS["t10_physics_conic"]
    version = "1.0.0"

    def run(self, ctx: ClubTrackingContext) -> ClubTrackingResult:
        cands = harvest(ctx)

        if ctx.source_timing is not None and ctx.source_timing.observations:
            groups = [o.normalized_frames for o in ctx.source_timing.observations
                      if o.normalized_frames]
        else:
            n0 = ctx.events.get("address", 0)
            n1 = ctx.events.get("impact", ctx.frame_count - 1)
            groups = [[f] for f in range(n0, n1 + 1)]

        obs_frames: list[int] = []
        cands_by_obs = []
        grip_rows = []
        for gf in groups:
            rep = gf[0]
            pooled = []
            for f in gf:
                pooled.extend(cands.get(f, []))
            g = ctx.grip[rep] if 0 <= rep < len(ctx.grip) else None
            if g is None:
                continue
            obs_frames.append(rep)
            cands_by_obs.append(pooled)
            grip_rows.append((g[0], g[1]))

        # trim to the address->impact span that actually has candidates
        has = [i for i, c in enumerate(cands_by_obs) if c]
        if len(has) < 6:
            return ClubTrackingResult(test_id=self.id, label=self.label,
                                      version=self.version, observations=[],
                                      diagnostics={"reason": "insufficient_candidates"})
        lo, hi = has[0], has[-1]
        obs_frames = obs_frames[lo:hi + 1]
        cands_by_obs = cands_by_obs[lo:hi + 1]
        grip = np.array(grip_rows[lo:hi + 1])
        times = [f / ctx.fps for f in obs_frames]

        top_f = ctx.events.get("top")
        down_from = None
        if top_f is not None:
            down_from = int(np.searchsorted(np.array(obs_frames), top_f))
            if not 0 < down_from < len(obs_frames) - 4:
                down_from = None

        solved = solve(cands_by_obs, times, grip, downswing_from=down_from)
        if solved is None:
            return ClubTrackingResult(test_id=self.id, label=self.label,
                                      version=self.version, observations=[],
                                      diagnostics={"reason": "solve_failed"})
        pts, assoc = solved

        observations = []
        residuals = []
        for i, f in enumerate(obs_frames):
            a = assoc[i]
            x = float(np.clip(pts[i, 0], 0.0, 1.0))
            y = float(np.clip(pts[i, 1], 0.0, 1.0))
            if a is not None:
                r = float(np.hypot(a.x - x, a.y - y))
                residuals.append(r)
                mode = "observed" if r <= ASSOC_GATE / 3 else "mixed"
                conf = a.confidence * (1.0 - min(r / ASSOC_GATE, 1.0) * 0.5)
                src = a.source
                vis = "visible"
            else:
                mode, conf, src, vis = "inferred", 0.25, "fused", "unobservable"
            observations.append(ClubObservation(
                frame=int(f), source_time_s=times[i], x=x, y=y,
                confidence=round(max(conf, 0.01), 5), mode=mode, source=src,
                visibility=vis))

        evidence = refine(pts, np.asarray(times),
                          artifact_top_time=(top_f / ctx.fps
                                             if top_f is not None else None))

        n_assoc = sum(1 for a in assoc if a is not None)
        return ClubTrackingResult(
            test_id=self.id, label=self.label, version=self.version,
            observations=observations, event_evidence=evidence,
            diagnostics={
                "association_fraction": round(n_assoc / len(assoc), 4),
                "mean_residual": round(float(np.mean(residuals)), 5) if residuals else 0.0,
                "conic_window": int(down_from is not None),
            })
