# 08 - Test 1: Global Candidate Graph

**Phase:** Phase 1 — Deterministic baselines
**Status:** complete
**Estimated effort:** 1–2 days

## Overview

Plan §10: generate many club-head candidates per frame and solve the whole swing globally
with dynamic programming, instead of trusting the top per-frame detection. The artifact
already carries the raw low-threshold detector stream (`club.detector.boxes`, class
`clubhead`, conf floor 0.15) — exactly the §3.4 "detection generates hypotheses" input —
plus the classical solve's heads as weak fallback candidates. The solver decides membership:
a low-conf candidate on the plausible path beats a high-conf one off it.

## Dependencies

- Steps 02, 05, 06, 07 complete.

## Architectural Context / Decisions

- Candidates: (a) every class-`clubhead` raw detection; (b) classical solve heads at reduced
  weight (they are already a solved opinion, not raw evidence). No motion-blob generator in
  v1 — the raw stream is already dense on these fixtures; blobs join when a fixture shows
  the need (logged as the step's known limit).
- Evidence deduplication (plan §3.1): the graph is built over DISTINCT SOURCE OBSERVATIONS
  when `source_timing` is present — duplicated CFR frames contribute their candidates once.
- Solve: Viterbi-style DP, state = (observation, candidate), skip edges up to ~12
  observations with per-skip penalty; transition cost = speed penalty (implausible jump per
  unit time) + curvature penalty vs the predecessor's implied velocity + node cost from
  detection confidence + grip-distance plausibility (soft radius band around `grip_center`,
  handedness-agnostic). Phase-direction and conic terms deliberately deferred to Test 10.
- Output: chosen candidates as `observed` observations (source `detector`/`classical`);
  un-chosen frames simply absent — the path-fit registry bridges them honestly as
  `inferred`.
- Registered as `t1_candidate_graph`; TS mirror's `IMPLEMENTED_TESTS` gains the id (the
  sync pytest enforces it).

## Files & Areas Touched

- `services/analyzer/swingsage/club_tracking/candidates.py`
- `services/analyzer/swingsage/club_tracking/graph.py`
- `services/analyzer/swingsage/club_tracking/tests_impl/t1_candidate_graph.py` (+ package import)
- `services/analyzer/tests/test_t1_candidate_graph.py`
- `apps/web/src/lib/clubTests.ts` — IMPLEMENTED_TESTS

## Steps

1. `candidates.py`: `harvest(ctx) -> dict[int, list[ClubCandidate]]` from the raw detector
   boxes (class name looked up from `detector.names`, never a hardcoded class index) and
   the classical heads (weight × 0.6); features carry det score and grip distance.
2. `graph.py`: `solve(cands_by_obs, times, grip_at, max_skip=12) -> list[(obs_idx, ClubCandidate)]`
   — pure DP, no I/O; costs as above; returns the min-cost chain.
3. `t1_candidate_graph.py`: `@register` tracker mapping ctx → distinct observations →
   harvest → solve → `observed` ClubObservations (+ diagnostics: candidates/observation,
   chosen fraction, longest skip).
4. Hermetic tests: high-conf off-path decoy rejected in favor of low-conf on-path chain;
   gap bridged by skip edges; duplicated-CFR dedup (two normalized frames, one source
   observation → one evidence use); determinism.
5. Mirror update + full fixture runs.

## Verification

1. `python -m pytest tests` — green (incl. mirror sync showing t1 implemented).
2. `pnpm --filter web exec tsc --noEmit && pnpm --filter web lint` — clean.
3. `scripts/club_test.py out/<stem> --test t1_candidate_graph` over all seven fixtures —
   exit 0, merged experiments with 10 variants each.

## Definition of Done

- [ ] Suite green; t1 registered; decoy-rejection test passes.
- [ ] All seven fixtures carry a merged t1 experiment.
- [ ] TS mirror updated and in sync by test.
