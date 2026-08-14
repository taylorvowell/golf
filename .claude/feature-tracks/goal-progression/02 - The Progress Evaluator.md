# 02 - The Progress Evaluator

**Phase:** Improvement Tracking
**Status:** not-started
**Estimated effort:** 2 days

## Overview

The honest core of the system: a deterministic pure function from (stored analyses, goal,
`goal_config`) to an evidence timeline and a progress state. Everything the golfer will ever
be told about progress comes out of this function, so it is built fixture-first with its own
debug script before any UI exists — the debug view is built when the work starts, not after.

## Dependencies

- Step 01 complete (tables, config, shapes).

## Architectural Context

- §16.3.3: verdict per swing is `clean | faulty | no_evidence`; progress is "clean in X of
  the last Y **evidencing** swings"; no-evidence swings move nothing.
- Confidence is truncated, not rounded — the evaluator re-applies the same `MIN_CONF` gate the
  analyzer wrote, exactly as every other consumer does.
- View gating: a check that cannot be evaluated from the swing's camera view yields
  `no_evidence`, mirroring the analyzer's "cannot be evaluated from this angle is a valid
  answer".
- The standing trap applies with full force: **a check that scores well is not evidence the
  check works.** Before trusting any template, print its raw verdicts across all ten fixtures
  and confirm they move the way the band assumes.

## Files & Areas Touched

- `apps/web/src/lib/goals/evaluate.ts` — the pure function + window math.
- `apps/web/src/lib/jobs.ts` — hook: on analysis-complete, evaluate active goals for that
  golfer and append evidence.
- `apps/web/scripts/checkgoals.ts` — the debug script (see Steps 4).
- `pnpm db:backfill` extension — recompute evidence over existing analyses.

## Steps

1. **Per-swing verdict.** Given one analysis artifact and one template: resolve bound checks,
   apply the truncated confidence gate and view gate, then the pass band. Any bound check
   abstaining → the swing is `no_evidence` for that goal (partial evidence is fabricated
   evidence).
2. **Window math.** Over the goal's evidence ordered by swing recency: meter = clean count in
   the last Y evidencing swings; below the minimum evidencing count → state is "no evidence
   yet", never 0%. Achievement = window rule met; the achieving swing id is recorded.
3. **Determinism and recompute.** Evaluation is idempotent per (goal, swing, config version).
   Re-analysis of a swing replaces that swing's evidence row and recomputes downstream state
   — including *un*-achieving a goal only if the achievement swing itself is invalidated;
   an achieved state otherwise stays achieved under the version it was earned (D55).
4. **`checkgoals.ts`.** For every template × every fixture in `out/`: print the raw bound
   metric values, the gate that fired (conf/view/band), and the verdict — one table. This is
   the script that catches a template whose "clean" fires on a fixture that visibly has the
   fault.
5. **Wire the job + backfill.** Analysis-complete triggers evaluation for the swing's owner;
   `db:backfill` replays history so a goal assigned today sees prior swings' evidence
   immediately (assignment-time backfill is what makes the first meter honest).

## Quality Standards

- `evaluate.ts` has no I/O — inputs in, verdicts out; the job layer owns reading/writing.
- Unit tests cover: abstain ≠ fail, truncation boundary (a value rounding *up* onto the
  threshold is excluded), window dent-not-reset, minimum-evidence gating, re-analysis
  replacement, achievement pinned to the exact completing swing.
- Fixture check: for at least two templates, hand-pick one fixture expected `clean` and one
  expected `faulty` from the known fixture set, and assert those verdicts — golden-style, but
  chosen deliberately, never frozen blindly.

## Verification

- `pnpm --filter web exec tsc --noEmit && pnpm --filter web lint`
- `pnpm --filter web test`
- `pnpm --filter web exec tsx scripts/checkgoals.ts` runs over all fixtures and a human looks
  at the table — verdicts must move the way each band assumes (manual, per the standing trap).

## Definition of Done

- [ ] Evaluator unit tests green, including every honesty case in Quality Standards.
- [ ] `checkgoals.ts` prints the template × fixture table; reviewed and recorded in
      `_PROGRESS.md` with any template whose band was corrected as a result.
- [ ] Analysis-complete job appends evidence; `db:backfill` replays clean and idempotent
      (running it twice changes nothing).
- [ ] Web oracle green.

## Notes

If a template's checks turn out untrustworthy across fixtures, the correct move is to remove
the template from `v1.json` and note it — an abstaining goal set is better than a confident
wrong meter. That principle is the product's, not this step's.
