# platform-foundation — Progress Log

Append-only. One entry per completed step: timestamp, what changed, anything worth keeping.

Track goal: close the architecture questions `PROJECT_MAIN.md` §44 deliberately left open,
then build the platform every later track assumes — identity, the real data model, a versioned
API with a generated shared schema, the entitlement seam, media addressing, and a release
pipeline for all three artifacts.

**10 steps, and deliberately front-loaded.** This track delivers no user-visible value. It
exists because a native app cannot be force-updated, so API versioning, the shared contract,
and the entitlement seam get permanently more expensive after the first store release. See
`docs/DECISIONS.md` D3 for the review that shaped it.

**Starting position (2026-08-08):** a proof-of-concept analyzer + desktop web player running
against local Docker Postgres and a single seeded admin user, with media on local disk. See
[`docs/CURRENT-STATE.md`](../../../docs/CURRENT-STATE.md) for what that includes and
[`docs/PRODUCT-COVERAGE.md`](../../../docs/PRODUCT-COVERAGE.md) for the gap this track starts
closing.

---

## 01 — Architecture Decisions ✅ 2026-08-08

Closed the questions `PROJECT_MAIN.md` §44 left open. **13 decisions recorded as D5–D17** in
`docs/DECISIONS.md`, synthesised into a new `docs/ARCHITECTURE.md`.

**The decision that turned out to be forced rather than chosen:** the only dev machine is
Windows with no Xcode, verified this session. iOS binaries cannot be built locally under *any*
framework, so a cloud build service is mandatory rather than a convenience. That, plus the fact
that the rendering rules worth keeping (`usePlayer.ts`, `traceSmoothing.ts`, `overlays.ts`,
`skeleton.ts`, `angleOverlay.ts`) are already TypeScript, settled the client on **React Native
via Expo with EAS Build** — Flutter would discard all of it and still not solve the build
problem.

Research done ahead of the step and recorded in the step file: VisionCamera covers 30–240 fps
capture on both platforms; frame-exact seeking is reachable on both, and Stage 0's existing
GOP of 10 — chosen originally for browser scrubbing — bounds ExoPlayer's decode-and-skip to
≤9 frames. **The unresolved risk is the Android per-frame overlay callback**, which iOS has a
clean analogue for and Android does not confirm. Step 02 now leads with proving it on Android,
and D5 is explicitly provisional until it does.

Other notable calls: the Next.js app becomes the coach/admin surface rather than being retired
(D6), so the existing player keeps a production home. §39's Azure preference is deliberately
**not** followed for media (D8) — splitting storage from the auth system would create a second
authorization path for user video — with a revisit trigger recorded. SLO targets are numeric
(D13), and the analysis p95 target is openly **not yet known to be achievable**: a 520-frame
fixture takes ~5.5 min on this machine, and `analyzer-service` must measure the hosted worker
and revise rather than quietly miss it.

Verification: `services/analyzer/swingsage` untouched (a DoD requirement — a decisions step
that edits the pipeline has the boundary wrong), `tsc --noEmit` clean, `eslint` clean,
pytest green.

Next: **02 — Mobile Client Spike and Workspace**, running Android-first.

## 02 — Mobile Client Spike and Workspace 🔄 in progress

Workspace done, measurements pending — they need hands on a device.

**Done:** `apps/mobile` scaffolded on **Expo 57 / React Native 0.86 / React 19 / TS 6**,
registered in the pnpm workspace (`apps/*` was already globbed), typechecking clean alongside
`apps/web`. `App.tsx` is a spike harness rather than product code: a Device card reading what is
knowable without native modules, and three probe cards ordered by risk rather than convenience —
overlay-sync first, because that is the one step 01's research could not confirm on Android.
Android run instructions are in `docs/RUNBOOK.md` §6.

**Deliberately not done:** `packages/` holds no contract types. Step 07 generates those from
JSON Schema, and hand-writing them now would only create the duplicate that step deletes.

**Blocked on external input, not on work:** all three probes need a development build, since
Expo Go cannot host native modules. That needs an Expo/EAS account, and the measurements
themselves need the phone in hand. The client test harness (also part of this step) lands with
the dev build so it can cover the probe code it exists to protect.

Status stays `in-progress` — the step's Definition of Done is measured numbers per device, and
there are none yet.

### Session 2 — 2026-08-11: the instrument exists and compiles; still no numbers

**The blocker recorded above was wrong on its central claim.** A dev build does *not* need an
Expo/EAS account for Android: this machine already has the Android SDK, NDK and JDK 17, so
`npx expo run:android` builds locally. Taylor chose to wire **both** routes — local as the
day-to-day path, `eas.json` committed because EAS is still the only way to reach iOS.

**Built the thing that makes probe 1 measurable at all.** `apps/mobile/modules/frame-clock` is a
local Expo module over Media3's `VideoFrameMetadataListener` (Kotlin) and
`AVPlayerItemVideoOutput` + `CADisplayLink` (Swift); `expo-video` surfaces neither. Drift is a
**closed loop timed in native code** — native reports the frame about to be rendered, JS draws and
calls back, native scores the callback against the frame actually on the glass. Neither end is a
JS self-report. Bars are D13's: overlay drift p95 = 0 frames, seek error max = 0. Recorded as D21.

`assets/frameclock.mp4` is generated and committed — 600 frames, exactly 60fps CFR, GOP 10, frame
number burned in, plus a bar advancing 1/599 of the width per frame. GOP 10 matches Stage 0, which
is what makes probe 2's worst case (a seek target just *before* a keyframe) reachable at all. A
JS-drawn marker sits over the burned-in bar, so drift is visible by eye as well as counted —
the phone-side analogue of the analyzer's Gate 1 burn-in.

**Verified as far as it can be without a device:** `./gradlew :app:assembleDebug` is **green**,
`:frame-clock:compileDebugKotlin` executed, and the debug APK exists. Compiling is not measuring —
**every probe number is still absent**, and D5 remains provisional on probe 1 exactly as before.
The iOS half has never been compiled; there is no Mac.

**Three environment faults found and fixed on the way**, all pre-existing, all of which broke
*every* Android build on this machine:
- `ANDROID_SDK_ROOT`'s value contains its own name. AGP prefers it over the correct `ANDROID_HOME`
  and fails with "The filename, directory name, or volume label syntax is incorrect".
  **Still needs a manual fix** — it is a Windows user environment variable. Overridden per-build
  meanwhile.
- NDK `27.1.12297006` was an empty directory from an interrupted install in May 2025, and RN 0.86
  asks for that exact version. Stub deleted; Gradle re-downloaded it. Fixed.
- pnpm's symlinked layout makes CMake/ninja loop forever
  (`manifest 'build.ninja' still dirty after 100 tries`). Repo moved to `node-linker=hoisted`.
  Requires deleting every `node_modules` first — a leftover `.pnpm` keeps resolving and
  reproduces the identical failure, which cost two rebuilds to spot.

**Test strategy is now real on both clients**, which was step 7 of this step file. Web gained a
Playwright end-to-end path (`pnpm --filter web test:e2e`) that drives a browser through
Next.js → Postgres → video on disk and asserts the player reaches `HAVE_METADATA` with real
dimensions. Mobile **component rendering now works** — previously recorded in the RUNBOOK as
unusable because `render()` "returned an object with no query functions". That object was a
Promise: RNTL v14 made `render`/`fireEvent` async, and it peer-depends on `test-renderer`, not
`react-test-renderer`. Mobile is 33 tests (logic + components), web 71 + 1 E2E.

**Remaining before this step can close:** the measurements themselves (Android device on USB),
probe 3's camera path, and iOS.
