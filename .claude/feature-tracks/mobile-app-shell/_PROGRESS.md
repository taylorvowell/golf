# mobile-app-shell — Progress Log

Append-only. One entry per completed step: timestamp, what changed, anything worth keeping.

Track goal: the mobile client scaffold for iPhone and Android — navigation, auth flows, onboarding
with role selection, profile and goals, the shared design system, and §41's real-golf-conditions
usability bar as stated acceptance criteria rather than an aspiration.

**Became the spine on 2026-08-12 (D46).** Phone OTP was held for want of an SMS provider and the
build turned to core functionality: a golfer signing in on a phone and seeing their own analysed
swing. `platform-foundation` stays active and launch-blocking — its remaining steps gate the coach
persona, billing and deployment, none of which gates the vertical slice.

**Starting position (2026-08-12):** an Expo 57 / RN 0.86 Android app installed on the S25+ that
does exactly two things — Google sign-in (D43) and a placeholder home screen showing a swing
*count*. No navigation library, no swing list, no player. The API it needs already exists and is
versioned (`/api/v1/swings`, `/analysis`, `/video`, `/thumb`), the data model is real, and the ten
analysed fixtures now belong to a real Google account rather than the development identity.

---

## 01 — Navigation and the Swing Log ✅ 2026-08-12

**Completed:** 2026-08-12 03:55 UTC
**Phase:** Core Golfer Experience

**Summary:** The phone stopped showing a *count* and started showing swings. React Navigation 7
native-stack, a swing log against `/api/v1/swings` with authenticated thumbnails, scores and bands,
pull-to-refresh, and a per-swing detail screen. `assembleDebug` BUILD SUCCESSFUL and installed on
the S25+.

**Notes:**

- **Expo Router was adopted, built, and then reversed on evidence (D47).** It was the reasoned
  choice — first-party for SDK 57, deep linking for §35 and §29, and D44 had deliberately left
  `src/app/` free for exactly this. It does not compile here: it peers on
  `react-native-gesture-handler`, whose C++ codegen object paths run past **260 characters**, and
  the `ninja` bundled with the Android SDK's CMake refuses those. **`LongPathsEnabled` is already
  `0x1` on this machine and makes no difference** — the limit is inside ninja, which is exactly the
  wrong place to look first.
- **Removing `expo-router` did not remove the package.** It is a peer of `@expo/cli`, which ships
  inside `expo`, so pnpm's hoisted linker (D21) leaves it in the root `node_modules` where RN
  autolinking compiles it whether or not anything imports it. Excluded explicitly in
  `react-native.config.js` + `expo.autolinking` — accurate rather than a workaround, since the app
  has no drawer and no swipeable rows. One file to delete the day it does.
- **A real bug, found by a test written for something else.** `db:claim-fixtures` moved ten swings
  onto the real account and left their media behind: D33 keys lead with the owner id, so every
  artifact silently resolved to a namespace nothing was published to. The symptom is not an error —
  it is a full swing log with no thumbnails and no video. `multiView.test.ts` caught it.
  `MediaStore` gained `movePrefix`, and `claim-fixtures` now sweeps **unconditionally**, so
  re-running the command repairs the state it previously produced.
- **The invariant survived its screen.** `HomeScreen` is deleted, but its rule — a request that
  never reached the server never renders as "no swings yet" — moved to `SwingLogScreen` with its
  test. Added alongside it: an unscored swing renders "not scored", never `0`.
- **Verified:** mobile tsc clean, 41 jest (+2 suites), web tsc/lint clean, 167 vitest, 100 schema
  vitest, `assembleDebug` BUILD SUCCESSFUL, APK installed, and the served Metro bundle contains
  every swing-log string.
- **Followed up on the device: every thumbnail was blank, and the cause was none of the obvious
  ones (D48).** React Native's `Image` accepts `headers` on its source and **silently does not send
  them on Android**. The request then arrived unauthenticated, was answered as the `DEV_USER_EMAIL`
  identity — which owns nothing since the fixture claim — and the route correctly returned **404**,
  not 401. Every other layer verified clean, which is what made it expensive: objects on disk at
  the right keys, database agreeing, `multiView.test.ts` green, and `verify:media` fetching all
  thirty artifacts over HTTP with a real session for `200` each. Instrumenting the route to log
  `auth?` alongside the status collapsed it to one line: `auth? false`.
- **Fixed with `expo-image`** (honours `headers`, plus `cachePolicy: "disk"` — the route serves the
  analyzer's full-resolution `contact.jpg`, ~13 MB across ten cards uncached). Confirmed on the
  device: all ten thumb requests now return 200.
- **Two things stop it recurring:** `SwingCard.test.tsx` asserts the source handed to the image
  component carries its `Authorization` header, and `pnpm --filter web verify:media <email>` makes
  "server or client?" one command. A third thing held on its own: `service-role.test.ts` failed the
  build until `verify:media` declared itself unreachable from a request, which produced
  `db/cliOnly.ts` — a guard a script imports to *prove* it is CLI-only rather than being
  allowlisted by name.

---
