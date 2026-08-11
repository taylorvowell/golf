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

## 02 — Mobile Client Spike and Workspace ✅ 2026-08-11

**Every probe is measured, on real hardware, from decoded artifacts rather than API self-reports.**
Galaxy S25+ (SM-S936U1, Android 36), driven over wireless debugging. Decisions **D34–D40**; the
standing summary is `docs/CURRENT-STATE.md` §11b.

| | Result |
|---|---|
| Overlay locked to the presented frame | **99.2% exact** (n=250), ~49 ms of lead to draw in |
| Frame-exact seeking | **100% exact** once the target became `frame / fps` |
| Seeking over HTTP | **identical to bundled** — the network adds zero error |
| True high-frame-rate capture | **1080p @ 231 fps** |
| Sustained 60 fps capture | 59.5–60.0 fps |
| `analysis.json` parse on device | 13.7 MB in **199 ms** |

**D5's Expo/React Native choice is confirmed on Android.** React is not the overlay bottleneck —
removing it entirely scored no better (99.0% vs 99.2%) — and plain rotated `View`s were fast
enough, so the Skia retest `Skeleton.tsx` warned about is **cancelled rather than deferred**.

**The single most valuable finding is a convention inversion.** media3 resolves a seek FORWARD to
the next frame boundary, so the web player's `(frame + 0.5) / fps` lands on N+1 — 0% exact,
measured. HTML video seeks to the frame *containing* a time; the conventions are opposite. Porting
the web rule to Android silently costs a frame on every seek, and it did. Now a standing warning.

**Two modules must survive the spike's deletion**, and this is written into §11b so it is not lost:
`modules/frame-clock` (no Expo/RN video component surfaces a frame callback) and
`modules/high-speed-camera` (Camera2 constrained high-speed, on the **deprecated** overload — the
modern `SessionConfiguration(SESSION_HIGH_SPEED, …)` is silently swallowed on this device).

**Three libraries were tried for high-speed capture and two lied or refused.** `vision-camera` v5
accepted 240 and delivered 60 without an error; CameraX 1.5 refused honestly, because it gates on a
`CamcorderProfile` this device leaves empty; only Camera2 reads the configuration map the sensor
actually publishes. Both losing paths were removed, with their reasons recorded so they are not
re-attempted.

**The process finding worth carrying forward:** an async probe that throws with no `try`/`catch`
leaves its button dead and nothing logged — indistinguishable from never having been tapped. That
cost a round three separate times. Every probe now reports its own failure and the native side has
a watchdog. A measurement harness that can fail silently is not a harness.

**Open, and named rather than buried:** scrubbing is unmeasured after four instrument revisions
(a seeked frame is displayed on arrival, so there is no lead on that path — reassigned to
`scripts/measure_overlay.py`); 231 fps against a requested 240 is 3.6% short, likely encoder ramp;
iOS is entirely untested with no Mac and no device, which D31's amendment makes non-gating.

Oracles: mobile tsc clean, 54 tests, web tsc/lint clean, 121 vitest, analyzer pytest green.

Next: **07 — API Contract and Shared Schema**.

---

## 09 — Media Storage and Artifact Addressing ✅ 2026-08-11

**Media is no longer bolted to this laptop.** `SWINGSAGE_MEDIA_ROOT` was the single hardest blocker
to the analyzer running anywhere else; it now names only the analyzer's working directory, and no
route reads the filesystem for media at all. Decisions in **D33**.

**The plan said rewrite `media_key` into a storage prefix. The better answer was not to store one.**
A key is derived from identity the database already owns — `u/<userId>/s/<swingId>/v/<viewId>/r<n>/`
— so it cannot drift from what it encodes, needs no backfill, and makes "is this artifact where it
should be" a pure function. That leaves `media_key` holding its one real meaning: the analyzer's
folder name. Conflating those two is what made the media unmovable to begin with.

**Three properties are load-bearing, and each is a test.** The owner leads the key, so a storage
policy can express ownership at all (`storage.foldername(name)[2] = auth.uid()`). The revision
separates analysis runs, because object storage has no rename-into-place — a re-analysis writes
`r<n+1>` and only *then* does the row point at it, so a golfer mid-scrub finishes on what they
started with. And the source sits outside the revision, since re-analysis produces new artifacts
from the same upload.

**The analyzer was not touched — publishing is a separate act.** `burnin.py` still writes
`out/<stem>/`; `lib/media/publish.ts` copies that into the store. That satisfies "change where
artifacts land, not what the analyzer produces" more literally than editing the analyzer would have,
keeps the credential-free CLI loop the pipeline's development depends on, and makes the
`analyzer-service` track a deployment rather than a redesign. **Zero diff under `services/analyzer`.**

**Verified over the real network path, not just compiled.** Both buckets are live in `golf-swing`,
private, with source and artifacts split because D29 expires one and not the other. 11 artifacts
published in 6.1s, `analysis.json` read back, and a signed URL answered `Range: bytes=1000-2999`
with **206 `bytes 1000-2999/5496355`** — frame-accurate scrubbing survives the CDN path, which is
the one property this step could not afford to get wrong. Locally the driver hard-links from the
analyzer's output, so publishing all ten fixtures (104 artifacts) cost ~0 extra disk.

Oracles: web tsc/lint clean, **121 vitest** (18 new), Playwright e2e green, analyzer pytest green,
`db:migrate` idempotent.

**Two findings worth carrying forward.** The Free plan caps uploads at **50 MB per file**, below a
270–330 MB phone video — so `media-pipeline`'s on-device compression is a *fit* requirement, not a
bandwidth optimization, and the provisioning script now says `CAPPED BY PLAN` rather than silently
accepting a default that would fail first on a real golfer's upload. And **storage-level RLS is
deliberately not shipped**: the driver bypasses `storage.objects`, so writing policies now would
ship a second inert boundary — the exact mistake D26 and D30's `clubs` grant each cost a debugging
session. It lands with D24's service-role scoping.

**Open against the DoD:** buckets exist in one environment, not the three D10 wants. A preview
project is free; the third needs Pro at $25/mo. Recorded as a deviation, not a decision.

Next: **07 — API Contract and Shared Schema**.

---

## 06 — Swing, Session, and Equipment Model ✅ 2026-08-11

**A swing is no longer a video.** It is a shot that owns one or more **views**, each with its own
clip, its own `analysis.json` and its own score — §7.1, and the thing four later tracks
(`mobile-player`, `swing-ingest`, `dual-device-capture`, `comparison-and-reference`) were blocked
on. Shipped in two halves per D28: the additive equipment/session/organization model (0005), then
this — the half that changes what a swing *is*. Decisions in **D30**.

**The load-bearing move is not the new table, it is where the frame-indexed data went.** `jobs`,
`scores`, `head_markers` and `swing_stages` all moved from the swing onto the view. A frame number
means nothing without the video that counts it, and two cameras on one swing never agree — left on
the swing, a second view would silently overwrite the first's hand-placed corrections. That is now
a test: one swing with a 60fps DTL view and a 120fps face-on view, each holding its own `impact`
frame, and the database refusing both a second view of a kind and a second primary.

**Identity stopped being a folder name.** `swings.id` was literally the analyzer's `out/<stem>`
directory, and `swings.media_path` held an absolute Windows path. Now the id is a uuid the database
mints and the folder name is the view's `media_key` — a key with no root and no separators,
validated before it is joined to anything. Step 09 turns it into an object-storage prefix by
changing values, not columns.

**Ten fixtures, ten scores, 30 jobs and 5 stage marks all came through intact** — asserted, not
assumed: `src/db/multiView.test.ts` walks the real database and fails if any ready view's artifact
is missing from disk, if any swing lacks exactly one primary view, if any `media_key` looks like a
path, or if a swing's denormalized score disagrees with its primary view's scorecard.

**Two smaller calls worth knowing.** Routes still take a *swing* id plus `?view=dtl|face_on`,
because a golfer's URL names a swing rather than a camera; an unrecognised view type is a 400, not
a silent default, and a pre-0006 bookmark is a 404 rather than a 500. And "is this a bundled
reference swing?" became a column — it used to be answered by matching the id against a hardcoded
`["perfect", "pro_2"]`, which only meant anything while an id was a folder name.

**Fixed on the way:** `clubs` had RLS policies from 0005 and no table grant, so they were inert —
0003's `grant ... on all tables` is a snapshot, not a rule.

Oracles: web tsc/lint clean, **103 vitest tests** (13 new), `db:migrate` idempotent, analyzer
pytest green with **zero diff under `services/analyzer`** (a DoD requirement — the `analysis.json`
contract is untouched), and the Playwright end-to-end path green: browser → Next.js → Postgres →
video on disk, through the rebuilt schema.

**Notes:** `lib/jobs.ts` spawns `burnin.py` for a re-analysis **without** `--club-detector
runs/clubhead/weights/best.pt` — a standing trap CLAUDE.md names by hand ("this has actually
happened"). Pre-existing, deliberately not fixed here because it changes analyzer invocation and
this step's DoD requires the artifact contract untouched. Recorded in D30. Also: `docs/CURRENT-STATE.md`
§7 and `.claude/rules/testing.md` were both stale — the latter still claimed no JS/TS test runner
existed — and are corrected.

Next: **09 — Media Storage and Artifact Addressing**, whose first step is provisioning buckets per
environment.

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

## 03 — Supabase Project and Data Platform Migration 🔄 in progress

**RLS is live on a real hosted project and the coach boundary is tested five phases early.**

Project `golf-swing` (`xjcjqwcmwoouxczrrvar`, us-west-2, Postgres 17) — it already existed, empty.
All four migrations applied. `users.id` is now a FK onto `auth.users` with the default dropped, so
an id comes from the auth system and never from the database (D7). RLS **enabled and forced** on
all eight user-scoped tables, 16 policies. Supabase security advisors: **zero findings** — the one
finding before this step, `public.rls_auto_enable()` being callable by `anon`, is revoked in 0004.

**The call worth knowing about: one migration runs on both Supabase and local Postgres.** 0003
shims `auth`, `auth.uid()` and the three request roles, each guarded so nothing is attempted where
the real ones exist. That is what lets the authorization boundary be proven **in CI with no cloud
credentials** rather than only where it is expensive to test. (`create table if not exists
auth.users` was the first attempt and fails on Supabase — it still needs CREATE on the schema.)

**11 RLS tests, covering the coach feature that is five phases away**: approved coach reads;
pending grants nothing; revoked ends access immediately; an approved coach can never write; and
approval for one golfer leaks nothing about another — the mistake a policy written as "is this
user a coach" instead of "is this user THIS golfer's coach" would make. The suite **fails rather
than skips** without a database.

Also: the service-role boundary has a static test over the request surface; the deletion cascade
is mapped in D24 with the storage-side sweeps enumerated as explicit work; and `db:migrate`'s
hardcoded drizzle-kit path — broken by D21's move to `node-linker=hoisted` — is now a plain
`drizzle-kit migrate`.

Oracles: web tsc/lint clean, 84 web tests, 51 mobile, analyzer pytest green.

**Not done, and why the step stays open:** D10 wants a Supabase project **per environment** and
only one exists — creating preview and production costs money and is Taylor's call. And the
analyzer's service role is not yet scoped to specific tables, because what it actually needs is
defined by the `analyzer-service` track. Decisions in D24.

---

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
