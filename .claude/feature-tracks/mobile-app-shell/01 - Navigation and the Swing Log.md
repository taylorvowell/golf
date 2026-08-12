# 01 - Navigation and the Swing Log

**Phase:** Core Golfer Experience
**Status:** not-started
**Estimated effort:** 1 day

## Overview

The first step of the vertical slice: a golfer signs in on their phone and sees **their own
analysed swings**, as a list they can scroll and tap — not a count.

Two things land together because neither is testable alone. Navigation with nothing to navigate to
is unverifiable ceremony; a swing list with nowhere to go from it is a dead end. Together they are
the honest checkpoint: sign in → see ten swings with thumbnails and scores → tap one → arrive at a
screen that names it. The player behind that screen is the `mobile-player` track, and this step
deliberately stops at its door.

§21's swing log is the surface being built. §41's usability bar is not deferred to step 03 for the
parts that are structural — tap targets and contrast are cheaper to get right than to retrofit —
but the systematic sweep is step 03's.

## Dependencies

- `platform-foundation` step 04 — sign-in works on Android (D43). **Met.**
- `platform-foundation` step 07 — `/api/v1/swings` and the generated `SwingSummary` contract.
  **Met.**
- `platform-foundation` step 09 — media addressed by identity, so `/thumb` resolves. **Met.**
- The ten analysed fixtures are owned by a real account (`db:claim-fixtures`, D46). **Met.**

## Architectural Context

- `PROJECT_MAIN.md` §21 (swing log and history), §41 (accessibility and general usability).
- The API is already complete for this screen. `GET /api/v1/swings` returns `SwingSummary[]` with
  `label`, `overallScore`, `band`, `status`, `createdAt`, `views[]` and `poseCoverage`;
  `GET /api/v1/swings/:id/thumb` serves the analyzer's `contact.jpg`. **No server change belongs
  in this step** — if one seems necessary, that is a signal the client is deriving something the
  contract should carry.
- Both media routes require `Authorization: Bearer`. React Native's `Image` and `expo-video` both
  accept request headers; a `<Image src={url}>` with no headers 401s and renders as a blank box,
  which looks like a missing thumbnail rather than an auth failure.
- D44 renamed `apps/mobile/src/app/` to `src/screens/` precisely so that adopting Expo Router
  would stay a decision somebody makes. This step makes it: `src/app/` becomes the route tree and
  `src/screens/` keeps the screen components, so a route file stays thin.

## Files & Areas Touched

- `apps/mobile/package.json`, `app.json`, `index.ts` — entry point and router config
- `apps/mobile/src/app/` — the route tree (new)
- `apps/mobile/src/screens/` — `SwingLogScreen`, the swing card, the detail placeholder
- `apps/mobile/src/features/swings/` — the data hook and its states (new)
- `apps/mobile/src/platform/client.ts` — authenticated media URLs

## Steps

1. Install and wire Expo Router (`expo-router`, `react-native-safe-area-context`,
   `react-native-screens`, `expo-linking`, `expo-constants`), set `main` to `expo-router/entry`,
   add a `scheme` and typed routes. Keep `AuthProvider`/`AuthGate` at the root layout so every
   route is behind sign-in by default rather than by remembering.
2. Move the existing screens onto routes: the swing log at `/`, the swing detail at
   `/swing/[id]`, delete-account at `/account/delete`. Delete the two-state `useState` in
   `App.tsx`.
3. Build the swing log against `GET /api/v1/swings`: thumbnail, label, score + band, view badges,
   date. Preserve `HomeScreen`'s state machine — "no swings" and "could not ask" must stay
   different answers, and a low-confidence or unscored swing must not render as a zero.
4. Authenticated images: a helper that resolves the current access token and returns a
   `{ uri, headers }` source, so a thumbnail request carries the session.
5. Tapping a swing routes to `/swing/[id]`, which names the swing, shows its score and states
   plainly that playback arrives with the player release. It must not look broken.
6. Pull-to-refresh, and an empty state that says what to do rather than just that nothing is here.

## Quality Standards

- No screen fetches on its own — data access goes through the `platform/client` seam so the
  bearer token and the 426 upgrade path stay in one place.
- A swing with `overallScore: null` renders as "not scored", never as 0. Confidence honesty is a
  product principle, not a player-only concern.
- Tap targets ≥ 44pt. The list is used outdoors, one-handed, in gloves.
- No hardcoded colour values — `src/theme.ts` is the only palette.

## Verification

```
pnpm --filter mobile exec tsc --noEmit
pnpm --filter mobile test
pnpm --filter web exec tsc --noEmit && pnpm --filter web lint
```

Plus: the Android bundle Metro serves contains the swing-log strings, and the app builds
(`assembleDebug`). On-device: sign in and see the ten real swings, tap one, arrive at its detail.

## Definition of Done

- [ ] Expo Router is wired and `App.tsx`'s ad-hoc screen state is gone.
- [ ] The swing log renders real swings from `/api/v1/swings` with thumbnails.
- [ ] "No swings" and "could not reach the server" remain distinguishable (the `HomeScreen`
      invariant survives the rewrite, with its test).
- [ ] An unscored swing does not display a score.
- [ ] Tapping a swing navigates to a detail route that names it.
- [ ] Oracles pass and the app runs on the S25+.

## Notes

The player, overlays and scorecard are **not** in this step — they are `mobile-player`, which
becomes the spine when this track's navigation exists to hang them on. Ending this step at a
detail placeholder is deliberate: it makes the navigation independently verifiable, which is the
same argument the project's Gate 1 / Gate 2 split makes about pose and sync.
