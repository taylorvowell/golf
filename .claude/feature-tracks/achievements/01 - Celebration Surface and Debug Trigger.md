# 01 - Celebration Surface and Debug Trigger

**Phase:** Improvement Tracking
**Status:** complete
**Estimated effort:** half a day

## Overview

The client-side celebration surface: a top **toaster** notification (deliberately not the
bottom sheet system) with a confetti burst, fed by an app-wide queue, plus debug-menu actions
to fire one on demand. Pure UI — no awarding logic, no persistence; those are steps 02–03.

## Dependencies

- None (first step). `DebugOverlay`'s `useDebugGroups` registry already exists.

## Architectural Context

- DESIGN.md in this track; PROJECT_MAIN §16.3.5 D62 amendment.
- Toast celebration is queue-serialised: one at a time, extras wait. The provider is the
  single mouth for toast-level celebrations app-wide.
- Themed (light + dark), flat UI rules apply: no borders, no shadows; the toast floats on the
  `glass` token. Confetti colors are the theme's accent tokens only.
- Core `Animated` with the native driver — reanimated is not a dependency and this does not
  justify one (APK-weight rule).

## Files & Areas Touched

- `apps/mobile/src/features/achievements/celebration.ts` — types + pure queue helpers
- `apps/mobile/src/features/achievements/CelebrationToast.tsx`
- `apps/mobile/src/features/achievements/Confetti.tsx`
- `apps/mobile/src/features/achievements/CelebrationProvider.tsx` — context, queue, debug group
- `apps/mobile/App.tsx` — provider mounted between `DebugProvider` and `Root`
- `apps/mobile/src/features/achievements/celebration.test.tsx`

## Steps

1. Define `Celebration` (id, kind badge|rank|record, title, detail?, icon, points?) and pure
   enqueue/advance helpers.
2. Build `Confetti` — a one-shot burst of animated pieces falling from the top edge,
   `pointerEvents="none"`, unmounted when done.
3. Build `CelebrationToast` — slides down under the top inset, auto-dismisses, tap to dismiss,
   accessible (button role, live region).
4. Build `CelebrationProvider` exposing `useCelebrate()`; renders toast + confetti above
   children; contributes a "Celebrations" debug group with sample triggers.
5. Mount in `App.tsx`; verify in the debug sheet.

## Quality Standards

- Queue logic is pure and unit-tested (order, one-at-a-time, dedupe by id).
- No `borderWidth`/shadow styles; only semantic tokens.
- All animation `useNativeDriver: true`; timers cleaned up on unmount.

## Verification

- `pnpm --filter mobile typecheck`
- `pnpm --filter mobile test`
- Manual: DEBUG pill → Celebrations → Run — toast + confetti on any screen (Taylor's pass).

## Definition of Done

- [x] `useCelebrate()` shows the toast + confetti; queued items play in order
- [x] Debug actions fire sample celebrations from any screen
- [x] Typecheck + tests green

## Notes

Built 2026-08-19 in the session that created the track. Real award data arrives in step 03 —
until then the debug sheet is the only trigger.
