# 04 - The slide-up scaffold — sheet over backdrop

**Phase:** Ideal Swing Design System
**Status:** not-started
**Estimated effort:** 1 session

## Overview
Build `SheetOverBackdrop` — the screen-level scaffold behind all three reference screens: a
fixed full-bleed backdrop layer (hero gradient or video) with a rounded sheet that scrolls up
over it, parallax on the backdrop, and a threshold-crossing "backdrop-open" state that swaps
which chrome is visible. This is the single most reused pattern in the new app; Swing Log,
Swing Report and Progress are all instances of it.

## Dependencies
- Step 03 complete (nav visibility context to drive).

## Architectural Context
- Mockup mechanics (the JS at the bottom of the reference file is the spec):
  - Backdrop is position-sticky full-height; content = transparent spacer + sheet.
  - Parallax: backdrop translateY = `min(scrollTop × k, cap)` — Log k=.22 cap=72,
    Report k=.18 cap=64.
  - `backdrop-open` when `scrollTop < 60`: backdrop controls fade/slide in
    (opacity 0→1, translateY 24→0, ~280ms), the pill/wave nav slides away, the sheet gains
    an extra translateY (132px report) so it visually drops off.
  - Initial scroll offset per screen (Log 170, Report 520) so first paint shows the sheet
    riding partway up.
- RN mapping: absolute-fill backdrop under an `Animated.ScrollView`; spacer View of
  backdrop-visible height; sheet = content with radius 30 top corners, `bgElevated` fill,
  the drag handle bar, and the -74/-92px overlap (negative margin over the spacer).
  All animation from ONE `Animated.Value` scroll position with native-driver interpolations;
  the open/closed boolean derives from a scroll listener with hysteresis (crossing 60)
  and only toggles `pointerEvents`/mounted-chrome — never per-frame React state.
- This scaffold is cold code relative to the player's 60Hz path — but the same discipline
  applies: no state churn per scroll tick, interpolations only.

## Files & Areas Touched
- `apps/mobile/src/design/system/SheetOverBackdrop.tsx` (new) — props: `backdrop` (element),
  `backdropHeight`, `parallax {factor, cap}`, `openThreshold` (default 60),
  `initialOffset`, `overlap`, `onOpenChange`, `children` (sheet content),
  `stickyFooter` (e.g. SessionPillNav — sticky inside the sheet, auto-hidden when open).
- `apps/mobile/src/design/system/SheetHandle.tsx` — the 72×6 rounded handle.
- `apps/mobile/src/design/system/HeroBackdrop.tsx` (new) — the reusable gradient hero
  (heroStart 0% → heroMid 54% → heroEnd 120%, aqua radial glow top-right, ring circle
  bottom-left) with slots for topbar/summary/track content. Used by Log + Progress + the
  report's video layer chrome.
- Tests: `SheetOverBackdrop.test.tsx` — open-state transitions, initial offset, footer
  visibility contract, accessibility (sheet content reachable by screen reader).

## Steps
1. Build the scaffold with a plain coloured backdrop; prove spacer/overlap geometry.
2. Add parallax + open-state interpolations; hysteresis on the threshold.
3. Wire `stickyFooter` hide/show through the step-03 visibility mechanism.
4. Build `HeroBackdrop` to the mockup's gradient stops and decorative geometry.
5. Gallery instance with fake content; measure: initial offset lands the sheet at the
   mockup's resting position at 410×780 logical proportions.
6. Verify scroll feel on the emulator (layout only) — jank/fps readings wait for the S25+.

## Quality Standards
- One Animated.Value; zero setState per scroll frame (listener fires state only on
  threshold crossings).
- Scaffold is data-free — it never knows what screen it is hosting.
- Works with `overscroll-behavior: contain` semantics (`overScrollMode`/`bounces` set so
  the parallax cap is never visually exceeded).

## Verification
- `pnpm --filter mobile typecheck && pnpm --filter mobile test`
- Gallery screen recording: scroll from initial offset to top → chrome swap fires once,
  footer slides away, backdrop controls appear; reverse restores. Compared against the
  mockup's behaviour in a browser side-by-side.

## Definition of Done
- [ ] Scaffold + HeroBackdrop in gallery, tests green
- [ ] Threshold behaviour proven in both directions with hysteresis (no flicker at 60px)
- [ ] Behaviour comparison vs mockup recorded in `_PROGRESS.md`
