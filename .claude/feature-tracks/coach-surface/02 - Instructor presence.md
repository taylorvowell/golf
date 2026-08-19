# Step 02 — Instructor presence

## Goal

The human professional becomes the **Instructor** everywhere user-facing. A debug-driven
"has local instructor" flag shows/hides the instructor bubble (face disc, bottom-right above
the nav, optional notification dot) and switches the profile menu between instructor details
and "find a local instructor". Placeholder Instructor and Instructor-chat pages.

## Steps

1. `apps/mobile/src/features/instructor/useInstructor.ts` — module-level store (AsyncStorage-
   persisted, listener set — the `useStarred` shape): `useInstructor()` returns the sample
   instructor when the debug flag is on, null otherwise (and always null in release).
   Replaces `features/profile/useConnectedCoach.ts`.
2. Debug toggle: contribute an "Instructor" group ("Has local instructor") to the app-wide
   `DebugOverlay` from an always-mounted registrar next to it in `App.tsx`.
3. `InstructorBubble` on the Coach tab: 56px face disc bottom-right above `WAVE_NAV_CLEARANCE`,
   notification dot, opens the Instructor page.
4. New stack routes `Instructor` and `InstructorChat` with placeholder screens.
5. Rename sweep (user-facing copy only): ProfileScreen coach block → Instructor block
   ("Your instructor", "Message instructor", "Local instructor directory", "Find instructor"),
   menu rows' copy, and any other user-visible "coach"-as-human strings in the mobile app.

## Verification

- `pnpm --filter mobile typecheck && pnpm --filter mobile test` green (ProfileScreen tests
  updated with the rename).
- Manual (step 05): toggle on → bubble appears on Coach tab + profile shows instructor card;
  toggle off → bubble gone + profile shows find-an-instructor.
