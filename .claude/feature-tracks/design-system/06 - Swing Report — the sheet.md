# 06 - Swing Report — the sheet

**Phase:** Ideal Swing Design System
**Status:** not-started
**Estimated effort:** 1 session

## Overview
Rebuild the swing detail surface as the report sheet from the mockup — everything that shows
when the sheet is up: header, session indicator, the focus block (video thumb + biggest
opportunity + coach advice), the orbital Swing Profile board, the split panels, metric chips,
and the sticky SessionPillNav. The full-screen video layer behind it is step 07; this step
mounts a static video thumbnail region in its place.

## Dependencies
- Steps 01–04 complete (05 recommended first for shared selectors).

## Architectural Context
- Mockup: `.report-content` inside `.report-v2-sheet` (lines ~840–917) — header
  (`Swing #N`, meta line club · view · fps), `.session-indicator`, `.report-focus` grid,
  `.report-board` with `.swing-profile`, `.report-split`, `.report-metrics`, and the sticky
  `.session-pill-nav`.
- Data: the analysis artifact + scores already served to the player (`AnalysisPanel` /
  `SummaryCover` data paths). Mapping:
  - Biggest opportunity ← lowest-scoring actionable check's coaching copy (the existing
    priority/summary source; deterministic fallback when AI narrative is absent).
  - Swing Profile ← overall score core; nodes/callouts ← phase scores (setup/impact/tempo)
    from the artifact's scoring block; callouts show strongest phase, biggest opportunity,
    tempo ratio. "Cannot be evaluated" phases render as abstentions (muted node, no
    fabricated number) — confidence-honesty is non-negotiable.
  - Split panels ← primary positive / main opportunity strings; metric chips ← the 3–4
    headline metrics only (balance, path, rotation, posture pattern) — never the full
    metric dump.
- This screen replaces the current `SwingDetailScreen` presentation; the player remains
  the playback engine underneath (step 07 joins them).
- The report surface is pinned dark backdrop + light sheet exactly as the mockup draws it;
  the sheet itself follows the ambient theme.

## Files & Areas Touched
- `apps/mobile/src/features/report/ReportSheet.tsx` (new) + subcomponents
  (`ReportHeader`, `SessionIndicator`, `FocusBlock`, `ReportBoard`, `ReportSplit`,
  `MetricChips`) — all from step-02 primitives.
- `apps/mobile/src/features/report/selectors.ts` — pure mapping from artifact/scores →
  report view-model, unit-tested against fixture-shaped data (incl. abstained phases).
- `apps/mobile/src/screens/SwingDetailScreen.tsx` — hosts the scaffold with a static
  backdrop placeholder this step.
- Tests for selectors + sheet states (loading/failed analysis render the mockup-consistent
  degraded states, not blank panels).

## Steps
1. Selectors + view-model with tests (abstention cases explicit).
2. Header + session indicator + focus block (thumb 126px column grid, eyebrow "Biggest
   opportunity", issue 18/900, coach advice sub-panel surface2).
3. Report board: kicker, headline, SwingProfile full variant with real phase data.
4. Split panels + metric chips.
5. SessionPillNav as the scaffold's stickyFooter, actions wired to existing handlers
   (delete confirms; favourite/latest/swings navigate or no-op with TODO notes where the
   backing feature is a later track — visible but honest).
6. Pixel pass vs mockup report sheet, both themes.

## Quality Standards
- No fabricated numbers: every value on the board traces to the artifact; abstentions
  render as abstentions.
- The golfer-actionable rule: fields limited to the mockup's slots.
- Comment tags name the mockup classes reproduced.

## Verification
- `pnpm --filter mobile typecheck && pnpm --filter mobile test`
- Emulator screenshots vs mockup sheet regions; degraded-state screenshots (analysis
  failed, club excluded) reviewed against "degrade, don't crash".

## Definition of Done
- [ ] Report sheet renders real fixture-backed data in the mockup layout
- [ ] Selector tests cover scored, partial, and abstained inputs
- [ ] Pill nav actions wired or honestly stubbed with named follow-ups
- [ ] Pixel comparison recorded in `_PROGRESS.md`
