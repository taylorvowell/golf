# 05 - `analysis.json` Experiment Schema and Atomic Merge

**Phase:** Phase 0 — Ground truth and shared infrastructure (revised arc)
**Status:** complete
**Estimated effort:** 1 day
**human-review-required:** waived — user directive 2026-08-07: full autonomy, decide + log
+ proceed. The change is append-only, so it stays reversible; decisions recorded as D55.

## Overview

Give experiment results a home in the artifact: the plan §25 `clubTracking` block, stored
per test with all ten path-fit variants precomputed, merged atomically so two test runs can
never corrupt one artifact (§29.7). Plus the runner (`scripts/club_test.py`) that executes a
registered test over an analysed swing and merges its result — the analyzer half of what the
step-06 debug menu will trigger.

## Dependencies

- Steps 01–04 complete (sidecar, context/result/registry, path-fit registry).

## Architectural Context / Decisions (D55)

- **Key style: snake_case** (`club_tracking`, `schema_version`) — the plan's §25 sketch is
  camelCase, but the artifact is uniformly snake_case; artifact consistency wins.
- **Append-only, optional block**: added to `analysis.json` only when an experiment merges;
  legacy artifacts simply lack it. `burnin.py`'s `SCHEMA_VERSION` is untouched (same
  reasoning as resegment's posture patch — the artifact gains an optional block, it does not
  assert a new full-contract version).
- **Trace scope address→impact only** (§2.1): variants are sampled over
  `[address, impact]`; `phase_spans` = backswing (address→top, color role `backswing`) +
  downswing (top→impact, `downswing`). No follow-through samples exist at all.
- **Continuity gate v1** (§2.4/§23 minimum): `display_mode = "split_at_top"` iff the fitted
  default variant's samples around top are `inferred` for a span exceeding ~150 ms
  (9 frames) — the "bridging would be unjustified" rule; else `continuous`. Full §23
  quality metrics deferred until a real tracker gives them meaning.
- **Single writer per swing** (§29.7): merge takes a `.experiment.lock` beside the artifact
  (stale-safe), writes tmp, `os.replace`.
- Events in the experiment block: address/top/impact with frame + time + confidence,
  preferring the test's own `event_evidence`, falling back to the artifact's events.

## Files & Areas Touched

- `services/analyzer/swingsage/club_tracking/experiment_store.py` — build + merge
- `services/analyzer/scripts/club_test.py` — runner CLI
- `services/analyzer/tests/test_experiment_store.py` — hermetic tests
- `docs/DECISIONS.md` — D55

## Steps

1. `experiment_store.py`: `build_experiment(result, ctx, variants, models=None) -> dict`
   (test identity, models used, events, trace{display_mode, phase_spans, variants},
   diagnostics + source-timing summary); `merge_experiment(out_dir, experiment) -> Path`
   (lock, read, `setdefault("club_tracking", ...)`, replace that experiment id only, atomic
   write); `split_gate(default_variant, top_frame, fps) -> str`.
2. `scripts/club_test.py`: `--list` (12 ids, implemented or not), `<out_dir> --test <id>`
   → load context, `get_test`, run, `fit_variants` over address→impact with
   `top_frame`, build, merge, print a one-line summary. Exit 2 with the catalogue on an
   unimplemented test.
3. Tests: build shape (all 10 variants, spans, snake_case keys), merge onto a synthesized
   out dir (other artifact keys untouched, re-merge replaces only its own experiment,
   second experiment coexists), split gate (continuous on solid bridge, split on a long
   inferred top gap), lock file removed after merge.
4. Append D55 to `docs/DECISIONS.md`.

## Verification

From `services/analyzer` with `.venv\Scripts\python.exe`:

1. `python -m pytest tests` — green.
2. `python scripts/club_test.py --list` — prints 12 rows, exit 0.
3. `python scripts/club_test.py out/swing1 --test t6_grip_kinematic` — exits 2 (declared,
   not yet implemented) with a clear message; artifact untouched.

## Definition of Done

- [ ] `pytest tests` green with `test_experiment_store.py` collected.
- [ ] Merge is atomic + lock-serialized; re-merge idempotent per test id.
- [ ] Legacy `analysis.json` without the block loads and gains it on first merge.
- [ ] D55 appended.
