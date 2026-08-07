# 09 - Test 10: Physics-Constrained Conic / Factor-Graph + Event Refiner

**Phase:** Phase 1 — Deterministic baselines
**Status:** complete
**Estimated effort:** 2 days

## Overview

Plan §19's question: how much does better MATHEMATICS over ordinary noisy candidates buy,
with no better visual sensor? Solve the whole trajectory as robust nonlinear least squares
over the fixed baseline candidate source (low-threshold detector + grip), with motion
smoothness, a soft slowly-varying grip-radius factor, and a LOCAL conic prior confined to
the lower downswing. Plus the plan §24 common event refiner (address onset, top reversal,
impact corridor) shared by later tests.

## Dependencies

- Steps 02, 05, 08 complete (candidates.py is the §19 "fixed baseline source").

## Architectural Context / Decisions

- Sensor input frozen per §19: `candidates.harvest` only — no kinematic tracker, no future
  experts. T10 is deliberately blind to t6.
- State: positions per genuine source observation; velocities/accelerations as finite
  differences (dense scipy `least_squares`, Huber loss — a factor-graph library is
  explicitly deferred by the plan until an experiment proves the need).
- Factors: robust nearest-candidate measurement (conf-weighted, gated, re-associated per
  IRLS round), acceleration + jerk penalties, soft second-difference penalty on
  |p − grip| (slowly-varying projected radius, NEVER constant), local conic factor on the
  lower-downswing window only (algebraic ellipse fit, soft weight), endpoint anchoring on
  strong address/impact candidates.
- Mode honesty: an observation with no associated candidate within the gate emits
  `inferred` (source `fused`); associated ones `observed`/`mixed` by residual size.
- `event_refiner.py` (plan §24, shared): address = last sustained-stillness observation
  before monotonic departure; top = trajectory direction reversal (not max height); impact
  = corridor crossing (region around the address head position) at maximum speed. Emits
  `EventEvidence` → `build_experiment` prefers them over artifact events.
- §19's metric ablation grid is NOT built — ablations are visual per the user's directive;
  the conic/grip factors carry config constants so a future A/B is a one-line change.

## Files & Areas Touched

- `services/analyzer/swingsage/club_tracking/physics_fit.py`
- `services/analyzer/swingsage/club_tracking/conic.py`
- `services/analyzer/swingsage/club_tracking/event_refiner.py`
- `services/analyzer/swingsage/club_tracking/tests_impl/t10_physics_conic.py` (+ import)
- `services/analyzer/tests/test_t10_physics.py`
- `apps/web/src/lib/clubTests.ts` — IMPLEMENTED_TESTS

## Steps

1. `conic.py`: algebraic ellipse fit (Fitzgibbon-style, degenerate-safe) + normalized
   algebraic distance — pure numpy.
2. `physics_fit.py`: `solve(cands_by_obs, times, grip, impact_idx) -> (points, assoc)` —
   init from per-obs best candidate with linear infill, 3 IRLS rounds of scipy
   `least_squares(loss="huber")` with the factor set above.
3. `event_refiner.py`: `refine(points, times, grip, artifact_events, fps) ->
   list[EventEvidence]`.
4. `t10_physics_conic.py`: `@register` tracker composing 1–3; diagnostics: association
   fraction, mean residual, conic window span, refined-vs-artifact event deltas.
5. Hermetic tests: noisy-arc recovery below raw RMS with outliers present; gap interior
   `inferred`; conic window activates only below the wrist-height threshold; refiner finds
   top at the synthetic reversal ±2; determinism.
6. Mirror update; run all seven fixtures; gates.

## Verification

1. `python -m pytest tests` green; `pnpm --filter web exec tsc --noEmit && pnpm --filter web lint` clean.
2. `scripts/club_test.py out/<stem> --test t10_physics_conic` — all seven exit 0.

## Definition of Done

- [ ] Suite green, t10 registered (3/12), mirror in sync.
- [ ] All seven fixtures carry a merged t10 experiment with refined events.
- [ ] Synthetic outlier/gap tests pass.
