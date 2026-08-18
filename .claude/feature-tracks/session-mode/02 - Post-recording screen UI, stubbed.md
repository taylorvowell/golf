# 02 - Post-recording screen UI, stubbed

**Phase:** Session Mode — UI
**Status:** complete
**Estimated effort:** 1 session

> **Execution note (2026-08-18):** built as an internal VIEW of the existing `Record` route
> (`PostSwingView` rendered by `SessionScreen` when `state.reviewing` is set), not the
> `SessionSwing` route this file planned. One reducer owns the whole session — capture and
> post-swing share name, type, settings and the swing list without a cross-route store —
> and the hardware back returns to capture via a `BackHandler` guard instead of popping the
> session. The previous-swing dock slot draws a film glyph in the stub; the real thumbnail
> arrives with the media wiring (step 06). The analyzing bar lives at the top of the report
> sheet's content ("below the playback" — the sheet IS below the playback), so completion
> reuses the sheet's own `presented` entrance exactly as specced.

## Overview

The post-recording screen as clickable UI: the one-shape report player wearing session-mode
chrome — analyzing bar, session dock, quick-access swing list, and the analysis-complete →
sheet-slide-up moment — running on a stubbed session (an existing analysed swing playing the
part of "just recorded"). Completes the walkable loop: record → post-swing → record again.

## Dependencies

- Step 01 complete (session state, dock language, system sheet primitive).

## Architectural Context

- Spec: `DESIGN-session-mode.md`; `PROJECT_MAIN.md` §9.6.
- **One player (Taylor 2026-08-17):** every door opens the report shape. This screen is
  `ReportVideoLayer` + `ReportSheet` on `SheetOverBackdrop` with session chrome — the
  "after-swing session chrome" deferral from the SwingPlayer deletion, landing now.
- `SwingDetailScreen.tsx` is the composition template (memoized `stickyFooter` +
  `sheetContent`; per-frame re-render discipline in its header comments).
- The scrubber must not show phase markers before analysis: `SwingScrub` renders phase
  blocks from the artifact — the pre-analysis state is a plain track (no artifact loaded).
- The report sheet's `presented`/`presentDrop` entrance is the "analysis complete → sheet
  slides up" mechanism — reuse it, don't reinvent.

## Files & Areas Touched

- `apps/mobile/src/features/session/` —
  `PostSwingScreen.tsx`, `AnalyzingBar.tsx` (spinner + staged progress),
  `SessionSwingDock.tsx` (previous-swing thumb · end session · swing list · Record New
  Swing · delete/favorite/cog), `sheets/SessionSwingListSheet.tsx` (rows with
  view/delete/star; current row "analyzing…"), `AnalysisCompleteOverlay.tsx`,
  `sessionState.ts` (extend: swings-in-session list, per-swing stub status).
- `apps/mobile/src/navigation.ts` — add the in-session swing route
  (`SessionSwing: { swingId: string }` on the root stack, same dark full-screen treatment
  as `Record`).
- `App.tsx` — register the route (module-scope wrapper, `FixedDarkTheme`).

## Steps

1. Route + screen shell: `PostSwingScreen` renders the report player for a stub swing (use
   the newest real swing from `useSwings` under `__DEV__`; the screen takes `swingId` so the
   wiring only changes who mints it). Autoplays looping — the player already does this.
2. `AnalyzingBar` below the transport in the video-open chrome area: spinner left, staged
   bar (stages: Uploading → Queued → Analyzing pose → Tracking club → Scoring). Stub: a
   timed progression (~15s) driven by session state, restartable per swing. Video-Only
   sessions never mount it.
3. `SessionSwingDock` replacing the standard dock via the layer's `stickyFooter` seam:
   previous-swing thumbnail item (hidden when none; `expo-image` + `api.mediaSource()`
   headers for real thumbs, stub uses the fixture thumb), End session, Swing log (opens
   `SessionSwingListSheet`), centre red **Record New Swing** (→ back to capture, one tap),
   then unlabelled delete / favorite / cog icons (cog reopens the session settings sheet).
4. `SessionSwingListSheet` on the system sheet: this session's swings newest-first, each
   row: thumb, "Swing N", status (score orb once analyzed / "analyzing…" for the current
   stub), view · delete · star actions. Row tap opens that swing via the same
   `SessionSwing` route (still in session mode).
5. Completion moment: when the stub progression finishes and the golfer is still on this
   swing, show `AnalysisCompleteOverlay` (brief, non-blocking) then drive the report
   sheet's `presented` entrance so the analysis slides up.
6. End session: navigate to the Swing Log tab (`navigate("Tabs", { screen: "SwingLog" })` —
   nested form, the bare form fails at runtime) and reset session state.
7. Delete/favorite on the dock: stub to session-state changes (favorite via `useStarred`
   pattern is fine already); delete confirms (`Alert`, destructive) and returns to capture.

## Quality Standards

- Dock and sheet contents memoized — the video layer re-renders per presented frame
  (follow `SwingDetailScreen`'s discipline).
- The analyzing bar owns its ticking; nothing above it re-renders per tick.
- No phase markers, no scores, no stats shown before "analysis" completes — the
  pre-analysis state is honest emptiness, not placeholders that look like data.
- Tab navigation uses the nested `navigate("Tabs", { screen })` form.

## Verification

- `pnpm --filter mobile exec tsc --noEmit`
- `pnpm --filter mobile test` (new: dock renders all items / hides previous-swing on first
  swing; swing-list sheet row states; analyzing-stage progression model test)
- Manual: full loop on the emulator — record (stub) → post-swing autoplaying → analyzing
  stages → analysis complete → sheet slides up → Record New Swing → capture screen; swing
  list shows both swings; End session lands on Swing Log.

## Definition of Done

- [ ] `tsc --noEmit` and `jest --ci` pass
- [ ] The full session loop is walkable end to end on stub state, both directions
- [ ] Analyzing bar stages, completion overlay, and auto sheet slide-up all demonstrate
- [ ] Session swing list sheet functions with view/delete/star and "analyzing…" state
- [ ] End session lands on the Swing Log tab and resets session state

## Notes

Everything remains stubbed: no recording artifact exists yet, so the player shows a real
analysed swing under `__DEV__`. That is a stub choice, not a design one — the wiring swaps
the swing id, not the screen.
