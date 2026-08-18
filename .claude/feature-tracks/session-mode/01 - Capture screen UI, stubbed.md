# 01 - Capture screen UI, stubbed

**Phase:** Session Mode — UI
**Status:** complete
**Estimated effort:** 1 session

## Overview

The session-mode capture screen as fully clickable UI with a stubbed camera: every control
Taylor specced is on screen, tappable, and holds real client-side state — but nothing records,
uploads, or persists. The goal is that he can open the Record door and walk the entire capture
experience on a device the same day.

## Dependencies

- None (first step). `design-system` track is complete and is the component source.

## Architectural Context

- Spec: `DESIGN-session-mode.md` (this directory) — binding for every control and default.
- `PROJECT_MAIN.md` §8.1/§8.6/§9.5; `docs/decisions/mobile-client.md` "Session mode is the
  capture surface" (D61).
- The `Record` route already exists as a full-screen dark modal (`App.tsx` → `RecordDark` →
  `RecordScreen`). Session mode replaces `RecordScreen`'s body; its filming checklist moves
  into the help sheet (the screen's own header comment anticipates exactly this).
- Capture surfaces are pinned dark (`FixedDarkTheme`, `COLORS`) — D-entry "The app is pinned
  light; the video surfaces are pinned dark".
- Flat UI: no borders, no drop shadows (`.claude/rules/react-native.md`). Icons from
  `lucide-react-native`. No Reanimated/gesture-handler — `Animated` + `PanResponder` only.
- **Deck absorption starts here (D61):** the slide-up panels use a NEW `design/system` sheet
  primitive re-expressing `DeckSheet`'s mechanics (Modal, statusBarTranslucent, drag detents,
  fling projection, hardware back, closed = unmounted) on system tokens. Do not adopt Deck.

## Files & Areas Touched

- `apps/mobile/src/features/session/` (new) —
  `SessionScreen.tsx` (state machine + composition),
  `CameraStage.tsx` (the stub camera seam),
  `SessionTitle.tsx`, `SessionTypeToggle.tsx`, `SettingsPills.tsx`,
  `AlignmentGhost.tsx`, `CountdownOverlay.tsx`, `RecordingFrame.tsx`,
  `SessionDock.tsx`, `DelaySelect.tsx`,
  `sheets/SessionSettingsSheet.tsx`, `sheets/SessionTypeInfoSheet.tsx`,
  `sheets/HelpSheet.tsx`,
  `sessionState.ts` (types + reducer: settings, type, name, mode
  `idle|countdown|recording`), `sessionDefaults.ts` (AsyncStorage-backed defaults,
  `useStarred.ts` pattern).
- `apps/mobile/src/design/system/Sheet.tsx` (new) — the system sheet primitive.
- `apps/mobile/src/screens/RecordScreen.tsx` — becomes a thin host of `SessionScreen`;
  checklist content moves to `HelpSheet`.
- `apps/mobile/src/screens/SystemGalleryScreen.tsx` — add the new sheet primitive.

## Steps

1. Build `design/system/Sheet.tsx` by re-expressing `DeckSheet` on system tokens (fixed-dark
   friendly — it must read correctly over the dark capture surface). Port the mechanics, not
   the skin. Unit-test detent/fling math if extracted pure.
2. `sessionState.ts`: one reducer for the whole screen — session name (default
   `Session N | <date>`; N = placeholder count in the stub), session type
   (`swing_analysis | practice_drills | video_only`), settings (delay 3s, replay on,
   auto-end on, ai-analysis on, ai-tips on, ai-voice on), mode
   (`idle → countdown → recording → idle`). Type locks once `swingsRecorded > 0`.
3. `CameraStage`: full-bleed dark stage with a `__DEV__` placeholder frame; expose the seam
   (`children` overlay slots) the real preview will fill in step 04. The alignment ghost
   (faint address-pose silhouette, reuse/scale `StickFigure` from `StickThumb.tsx`) fades
   out when recording starts.
4. Top chrome over a top scrim (LinearGradient, dark → transparent): `SessionTitle` (name,
   pencil → inline edit of the `Session N` segment only, save button), `SessionTypeToggle`
   (large 3-segment control — start from `Segmented`, sized up for the dark surface) with
   the info icon → `SessionTypeInfoSheet`, then `SettingsPills` (delay, auto-end, voice…)
   + the FPS pill (stub value `60 FPS`); any pill or the cog opens `SessionSettingsSheet`.
5. `SessionDock` (styled on `SessionPillNav`'s glass-dock language): Cancel · `DelaySelect`
   clock (popover ABOVE the dock: Off/3/5/10) · big red **Record Swing** centre button
   (becomes Stop while countdown/recording) · AI-audio toggle · cog. Help orb bottom-right
   above the dock → `HelpSheet` (seeded with the old checklist).
6. Recording flow, stubbed: Record → `CountdownOverlay` (huge numerals, per-second tick,
   abortable) → `RecordingFrame` red treatment (outline pulse + edge wash — style it, per
   the spec) with an elapsed indicator → Stop → navigate to the post-swing screen (step 02;
   until it exists, stop just returns to idle and increments `swingsRecorded`).
7. `SessionSettingsSheet`: the six settings + "Save as my defaults" checkbox →
   `sessionDefaults.ts` (AsyncStorage). Auto-end row renders in its "coming soon" state.
8. Cancel: with 0 swings recorded, plain `goBack()`; with >0, label/behavior switches to End
   session (stub: goBack).

## Quality Standards

- All state through the reducer — no scattered `useState` for settings.
- Nothing on the hot path re-renders per frame (there is no frame yet — keep it that way:
  countdown ticks via `Animated`/interval state local to `CountdownOverlay`).
- Every touch target ≥ 44pt; the record button is the biggest thing on screen (§41).
- No borders/shadows; `COLORS` only (no themed tokens on the pinned-dark surface).
- Strings are golfer-facing words, no diagnostics except the sanctioned FPS pill.

## Verification

- `pnpm --filter mobile exec tsc --noEmit`
- `pnpm --filter mobile test` (new: `sessionState.test.ts` — reducer transitions incl. type
  lock; `sessionDefaults.test.ts` — save/load round-trip; `Sheet.test.tsx` — renders, closes
  on hardware back, unmounts when closed)
- Manual (emulator, sanctioned for this step's end only if needed for the step's own
  self-check — the real look-pass is step 03): Record door opens session mode; every control
  responds; countdown → recording → stop cycles cleanly.

## Definition of Done

- [ ] `tsc --noEmit` and `jest --ci` pass
- [ ] Record door opens the new capture screen (old checklist gone from the body, present in
      the help sheet)
- [ ] Name edit, type toggle + info sheet, pills, delay select, settings sheet with defaults
      checkbox, help sheet, AI-audio toggle all function on stub state
- [ ] Countdown → recording treatment → stop round-trips; countdown abortable
- [ ] `design/system/Sheet.tsx` exists, tested, and no new Deck imports appear in
      `features/session/`

## Notes

Stub only — no camera, no permissions prompt, no persistence beyond defaults. Real camera is
step 04; do not install any camera package in this step.
