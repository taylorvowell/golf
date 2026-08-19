# Step 04 — Progress page to the pinned sample

## Goal

`.claude/SAMPLE-progress-page.html` followed exactly (Taylor, 2026-08-19: "I want this
followed exactly"). The page already matches the sample's ancestor; this pass adds what the
pinned revision adds.

## Steps

1. Hero: the description line under the headline ("Coach focus is shifting…" voice) and the
   fourth chip ("Coach confidence rising") — canned during the stub phase, flagged at the
   view-model swap point.
2. Priorities: Before/Now/+delta values and the gradient progress bar per focus row
   (`focus-progress` in the sample) — placeholder numbers at the swap point.
3. Trends: the per-category delta chips (+9/+6/+11 pattern) — placeholder numbers.
4. Coach note: the sample's fuller narrative shape.

## Verification

- `pnpm --filter mobile typecheck && pnpm --filter mobile test` green.
- Manual (step 05): side-by-side with the sample in both themes — layout, spacing, type scale
  and colour match; placeholder numbers render exactly like the sample's.
