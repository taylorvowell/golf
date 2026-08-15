# 08 - Progress page

**Phase:** Ideal Swing Design System
**Status:** not-started
**Estimated effort:** 1 session

## Overview
Build the Progress screen to the mockup — hero top with the net-gain trend ring and stat
chips, then the sheet: AI coach priorities (stick-figure thumbs, priority pills, before/now
progress tracks), "Where you improved" category trend tiles, the coach note, and the
then-vs-now compare block. Taylor's direction: a placeholder UI is acceptable — the layout
is real and reusable, the numbers may be derived-or-canned until goal-progression and
history-and-trends land. What is real must be real; what is canned must be visibly plumbed
for replacement.

## Dependencies
- Steps 01–04 complete.

## Architectural Context
- Mockup: `.progress-*` sections + `.coach-focus`, `.mini-trend-grid`, `.compare-grid`,
  `.coach-note` (lines ~928–1013).
- Honesty rule: real aggregates where the data already exists (session count, swing count,
  best score, score deltas over the last 30 days — all computable from the swings list);
  the AI-priority *content* (priority names, coach note copy) is placeholder until
  priority-engine/goal-progression, marked in code as `PLACEHOLDER_PRIORITIES` with a
  single swap point. Never present canned numbers as measured — canned copy uses the real
  categories the scoring config names, with progress bars fed from real category scores
  where computable, or rendered without numbers where not.
- The screen is a `SheetOverBackdrop` instance (hero variant, no video). Wave nav visible.
- This page becomes goal-progression's rendering target later — the view-model interface
  (`ProgressViewModel`) is the seam that track will fill; design it now, feed it partly.

## Files & Areas Touched
- `apps/mobile/src/screens/ProgressScreen.tsx` — full rebuild.
- `apps/mobile/src/features/progress/viewModel.ts` (new) — typed view-model + the
  real-data selectors (30-day aggregates from `useSwings` data) + placeholder block.
- `apps/mobile/src/features/progress/` components: `CoachFocusRow`, `MiniTrendTile`,
  `CompareThenNow` — from system primitives + `StickThumb`.
- Tests: selectors (aggregates over fixture-shaped lists), screen states (no data yet →
  the honest empty state, not fake progress).

## Steps
1. View-model + selectors with tests; explicit `placeholder: true` flags on canned blocks.
2. Hero: title, 30-day headline, trend ring (+net from real deltas when ≥2 sessions exist),
   chips (sessions/swings/best real; drop the "coach confidence" chip until it means
   something — a canned trust statement fails the honesty bar; note the omission).
3. Priorities block, trend tiles, coach note, compare block per mockup geometry.
4. Empty/low-data states: fewer than 2 sessions → the mockup layout with honest copy
   ("keep practising to unlock trends"), no invented numbers.
5. Pixel pass vs mockup, both themes.

## Quality Standards
- Placeholder content flows through one named constant, swappable by later tracks without
  layout edits.
- No fabricated measurements presented as fact — abstain visually where data is absent.
- Comment tags name mockup classes.

## Verification
- `pnpm --filter mobile typecheck && pnpm --filter mobile test`
- Emulator screenshots vs mockup regions (hero, priorities, trends, compare), both themes,
  plus the low-data state.

## Definition of Done
- [ ] Progress renders the mockup layout; real aggregates real, placeholders flagged
- [ ] Selector + state tests green
- [ ] Pixel comparison recorded in `_PROGRESS.md`
- [ ] `docs/PRODUCT-COVERAGE.md` note: Progress UI exists ahead of its data tracks
