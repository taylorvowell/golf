# 05 - Swing Log rebuilt to the reference

**Phase:** Ideal Swing Design System
**Status:** not-started
**Estimated effort:** 1 session

## Overview
Rebuild `SwingLogScreen` as the mockup's hero screen — the one Taylor named "100% pixel
perfect and exact". Hero backdrop with the parallax summary, sheet carrying the week strip,
the LATEST session card with its swing timeline, and the older-session list. Real data
throughout (the existing `useSwings`/`sessionize` layer); the mockup's copy is placeholder
content, its layout is law.

## Dependencies
- Steps 01–04 complete.

## Architectural Context
- Mockup: the `log-v2-*` device (hero mockup, lines ~727–791) + `.week-strip`,
  `.latest-wrap`, `.session-mini`, `.swing-stack-mini`, `.log-v2-session-list`.
- Composition: `SheetOverBackdrop` (parallax .22/72, initial offset scaled from 170,
  overlap 74) + `HeroBackdrop` + step-02 primitives. The wave nav stays visible on this
  screen at rest; the mockup ties its hiding to the report state, not the log.
- Data mapping (real → mockup slots):
  - Hero: latest session day + swing count → eyebrow; a deterministic headline (best
    session this week / most recent session) → h4; avg · improvement · best → meta line;
    session average → `ScoreRing`; improvement fraction → track bar.
  - Week strip: last 7 days, dot = day has swings, active = selected/today.
  - LATEST card: newest session → `session-mini` (head grid, avg box, progress row with
    start/improvement/best labels, first-frame thumbnail in the avatar slot, two most
    recent swings as the mini timeline with ring scores + per-swing one-liner).
  - Older sessions → `log-v2-session` rows (small date · name · meta, avg box right).
- The signed-out / unreachable / empty invariants keep their tests — "cannot reach
  SwingSage" must never render as an empty log, now inside the new layout's sheet.
- Headline/one-liner strings are deterministic (from scores/deltas) — no AI dependency.

## Files & Areas Touched
- `apps/mobile/src/screens/SwingLogScreen.tsx` — full rebuild on the scaffold.
- `apps/mobile/src/features/swings/SessionCard.tsx` → superseded by system pieces; the
  latest-card becomes `features/swings/LatestSessionCard.tsx` built from Panel/WeekStrip/
  SwingTimelineList/ProgressTrack primitives.
- `apps/mobile/src/features/swings/sessions.ts` — selectors for hero stats (avg, best,
  improvement, week map) with unit tests.
- `SwingLogScreen.test.tsx` — updated: state invariants + new structure landmarks.

## Steps
1. Selectors first (pure, tested): weekly map, session stats, headline pick.
2. Hero content on `HeroBackdrop` (title 30/900, eyebrow aqua 9/900/+18%, ScoreRing 88,
   track 5px aqua on white-12%).
3. Sheet content: sheet-head row, week strip, LATEST wrap (the label tab riding the top
   edge, cobalt fill, 7px/900), session-mini internals, older-session rows.
4. Pull-to-refresh + the three non-ok states rendered inside the sheet.
5. Navigation: session rows and swing rows push the existing detail/player routes.
6. Pixel pass: emulator at 410-wide logical viewport vs the mockup device frame opened in
   a browser — overlay/side-by-side compare per region (hero, strip, latest, list, nav);
   fix until they match; record the comparison shots.

## Quality Standards
- Every style value traces to a `log-v2-*`/`week-strip`/`session-mini` class (comment tags).
- No diagnostics on screen (no timestamps beyond the mockup's slots, no counts a golfer
  would not act on) — the mockup's fields are the complete field list.
- List virtualization: sessions list stays a FlatList inside the sheet (scroll owned by the
  scaffold; use the scaffold's ScrollView with mapped rows if nesting fights — session
  counts are small; choose the simpler correct one and note it).

## Verification
- `pnpm --filter mobile typecheck && pnpm --filter mobile test`
- Side-by-side screenshots (light + dark, hero at rest + scrolled) vs mockup, kept with
  `_PROGRESS.md` notes.
- All three failure states screenshot-verified inside the new layout.

## Definition of Done
- [ ] Swing Log renders the mockup layout with real data end-to-end on the emulator
- [ ] Parallax + sheet ride behave as the mockup's script defines
- [ ] State-invariant tests green in the new structure
- [ ] Pixel comparison recorded; deviations (if any) named, not silent
