# 07 - Swing Report — the video layer and video-open state

**Phase:** Ideal Swing Design System
**Status:** not-started
**Estimated effort:** 1 session

## Overview
The report's signature interaction: the real player becomes the full-screen layer behind the
step-06 sheet. Scrolling the sheet down reveals the video; at the top threshold the screen
enters **video-open** — the sheet drops away, the pill nav slides out, and the full player
controls slide up (speed pills, play button, phase-labelled swing scrub, Overlays/Compare
tools). Scrolling back restores the report. This must match the mockup's behaviour exactly.

## Dependencies
- Step 06 complete. The mobile-player track's transport (`useFramePlayer`, frame-clock
  surface, overlay stack) is the engine — reused, not rebuilt.

## Architectural Context
- Mockup: `.report-v2-video-layer` + `.report-v2-controls-shell` + the scroll script
  (k=.18 cap=64, `video-open` at scrollTop<60, sheet +132px translate, controls
  opacity/translateY 280ms, initial offset 520).
- **Hot-path discipline is binding here** (.claude/rules/react-native.md): the scroll
  animation must not touch the 60Hz frame path. Scroll interpolations ride the scaffold's
  Animated.Value; the player's per-frame state stays in its refs. The video surface and
  overlay mount once — never remounted on state crossings (pause/play policy only).
- Controls mapping to existing capabilities:
  - Speed pills 0.1×/0.5×/1× ← existing rate control (replaces the three-way slider
    decision — decision register edit: the speed control is now the mockup's pill group).
  - Phase scrub ← `PhaseStrip` + `ScrubBar` logic re-skinned: segment widths proportional
    to phase frame ranges from the artifact (mockup's 14/30/18/10/18 are placeholder),
    labels Address/Backswing/Approach/Impact/Finish per the existing event vocabulary,
    white dot indicator + stem. Seeks stay preemptible (media3 scrubbing mode, D-seek
    rules unchanged).
  - Overlays / Compare pills ← open the existing overlay controls sheet and compare panel.
  - Score pill bottom-left ← overall score; view pill top ← view + swing number.
- Playback policy: video pauses when the sheet covers ≥ the video (report state), may play
  in video-open; scrubbing allowed any time the controls are visible. AppState rules hold.
- The video layer is `FixedDarkTheme` (control surface over footage — existing decision).

## Files & Areas Touched
- `apps/mobile/src/features/report/VideoLayer.tsx` (new) — player surface + overlay +
  the video-open control shell (`ReportPlayerBar`, `SwingScrub` components).
- `apps/mobile/src/screens/SwingDetailScreen.tsx` — scaffold backdrop = VideoLayer;
  open-state plumbing (onOpenChange → controls/pill nav/wave chrome).
- `apps/mobile/src/features/player/*` — touched only where a control's skin moves into
  system components; transport logic untouched.
- Tests: open-state contract (controls hidden/shown, nav hidden/shown, pause policy),
  scrub → seek mapping (frame math unchanged: `frame/fps` on Android).

## Steps
1. Mount the real player as the backdrop with the step-06 sheet over it; prove overlay
   correctness is unaffected (Gate 3 spot-check on a fixture).
2. Build the control shell with mockup geometry; wire to transport.
3. Phase scrub: segment layout from artifact events; drag = preemptible seeks; release
   exact. Accessibility: adjustable role + increment/decrement.
4. Open-state choreography: sheet drop, controls in, pill nav out, wave nav out (this
   screen sits on the stack above tabs — confirm and wire whichever chrome is present).
5. Behaviour pass vs the mockup in a browser: initial position, both transitions, restored
   state. Screen-record both.
6. FrameSyncPanel reading on the emulator for regression *smoke* only; the real
   measurement is the S25+ HANDOFF row (emulator numbers are meaningless — do not quote).

## Quality Standards
- Zero per-scroll-frame React state; zero remounts of the video surface on crossings.
- Seek/frame rules untouched (D40); no new frame math anywhere in this step.
- Controls never hide except as the deterministic scroll-state function (amended rule).

## Verification
- `pnpm --filter mobile typecheck && pnpm --filter mobile test`
- `npx tsx scripts/checkoverlay.ts` if any overlay-adjacent file moved (Gate 3).
- Screen recordings of both transitions compared against the mockup; posted to
  `_PROGRESS.md` notes.

## Definition of Done
- [ ] Full interaction matches the mockup's script in both directions
- [ ] Player transport/overlay tests green and untouched paths verified unchanged
- [ ] Pause/play policy tested; AppState behaviour intact
- [ ] S25+ frame-lock re-measurement filed as the named shortfall in HANDOFF (device pass)
