# mobile-player — Progress Log

Append-only. One entry per completed step: timestamp, what changed, anything worth keeping.

Track goal: re-express the frame-accurate player and overlay system on mobile, plus the analysis
results surface and the swing log's detail view. **The rendering RULES survive the port even though
the React components do not** — frame-exact seeking, endpoint-exact trace smoothing, never
interpolating across a gap, and abstaining rather than fabricating.

**Became the spine on 2026-08-12 (D49).** It is the largest unproven risk in the product: the
player exists only as a desktop web app, frame sync is the #1 perceived-quality feature, and D40
already measured that **Android resolves seeks FORWARD, so the web player's midpoint rule is wrong
here**. Nothing about that is discoverable from the web codebase.

**Starting position (2026-08-12):** an Android app that signs in with Google, lists the golfer's
ten analysed swings with thumbnails and scores, and routes to a per-swing detail screen that shows
metadata and says playback is not here yet. `expo-video` is already a dependency;
`modules/frame-clock` and `modules/high-speed-camera` survive from the step 02 spike with **no
consumer in the tree** — `frame-clock` is this track's, and it is why the spike was run.

**What already exists to build against, so none of it is re-derived:**

| | |
|---|---|
| The artifacts | Ten analysed swings on disk, owned by a real account, every one serving `analysis.json`, `normalized.mp4` and `contact.jpg` over `/api/v1/…` — verified by `pnpm --filter web verify:media` |
| The contract | `@swingsage/schema` generates `Analysis` from the same JSON Schema the analyzer validates against (D41). Do not hand-type a shape. |
| The reference implementation | `apps/web/src/components/SwingStage.tsx`, `SwingTransport.tsx`, `SwingWorkspace.tsx` and `lib/usePlayer.ts` — the RULES to port, not the code |
| The measurements | D34–D40: overlay 99.2% frame-locked at ~49ms draw budget, seeking 100% frame-exact once the target is frame/fps, network adds zero seek error |

---

## 02 - Overlays on the Proven Clock — BLOCKED on one on-device reading
**Started:** 2026-08-12 09:05 UTC
**Phase:** Core Golfer Experience
**Summary:** The swing is drawn on the phone: skeleton, club, trace, orientation rods and angle
arcs, as rotated React Native `View`s (D23/D36), locked to the transport's frame and committed to
native with `markOverlayCommitted`. `useAnalysis` fetches `analysis.json` and treats a 404 as
**not-analysed** rather than an error, so a swing with no artifact still plays and steps. The
transport is now bounded by `playback_window` — `frames.ts` takes an `Extent` (a `{first, last}`
span or a bare frame count meaning the whole file) because the window rarely starts at zero.
`tsc` clean, **180 jest (+95)**, and Metro bundles for Android (HTTP 200, 6.5 MB) — no native change,
so the installed dev build needs a Reload and not a Gradle rebuild.

**Notes:**

- **Gate 3's geometry half was automated instead of waiting for the phone, and it earned its keep
  on the first run.** `scripts/checkoverlay.ts` imports the very modules the device executes and
  lays their output over the analyzer's own `overlay.mp4` as a magenta hairline. Verified at
  Address, Top and Impact on all ten fixtures. It found a bug **no test would have caught**: the
  port drew `analysis.club` — the deliberately conservative `primary` solve — while the web player
  draws whatever `defaultClubVar` selects (`model_traj_moving` on these fixtures). Nothing failed
  anywhere; the only symptom was a differently-shaped line over the same swing. `selectedClub` now
  makes that choice once and the shaft, head ring, trace and club-anchored angles all read it.
- **The trace's cost is measured, its frame-lock is not, and the difference is the whole open
  question.** On a 360pt stage: skeleton alone **59–61 views**, peak **461 at impact on `pro_3`
  (400 of them trace)** — against roughly 77 for the measurement D23's 99.2% figure came from, which
  contained no trace at all. Two render-time reductions carry it: RDP simplification at 0.6 stage
  pixels with both endpoints preserved exactly, and dashing, which emits one view per dash rather
  than one per sample and is therefore a *saving*. **Do not conclude anything about Skia from the
  count** — D23 rejected it on cost rather than merit, so reversing that needs the drift number.
- **Blocked, USER-ACTION-NEEDED:** Overlay drift with the trace on and with it off. The phone is not
  connected and Samsung's Accidental touch protection swallows `adb shell input` while it is
  covered, so this is not self-servable. One screen, two readings — RUNBOOK §12b, HANDOFF row open.
- **Named as absent rather than left to be discovered:** the silhouette, the isolation scrim, the
  butt line and fit-to-golfer crop. The scrim needs `Path2D` + even-odd fill to put its holes back,
  which plain `View`s cannot express. `PRODUCT-COVERAGE.md` §14 drops from ✅ to 🟡 to say so, since
  the phone is the primary product.
- **Three files are duplicated from `apps/web/src/lib/`, knowingly** (`traceSmoothing`,
  `playbackWindow`, `skeleton`, plus `clubVariants`), each with a banner. The trigger to
  un-duplicate is the third consumer or the first divergence. Adding a workspace package means
  Metro config and a native rebuild on a tree already hoisted (D21) just to build for Android.

---

## 01 - Frame-Exact Playback and Transport — IN PROGRESS
**Worked:** 2026-08-12 · **Phase:** Core Golfer Experience
**Status:** everything except the on-device seek measurement. Blocked on a physical device
condition, not on code — see the blocker in `_STATUS.json` and the `OPEN` row in `docs/HANDOFF.md`.

**The decision that shaped the step (D50).** The step file said to render through `expo-video` and
separately wire `frame-clock` to observe the presented frame. Those two are not compatible, and the
reason is only visible from inside the module: **`frame-clock` is not an observer, it is a player.**
`FrameClockView` builds its own `ExoPlayer`, owns its own `SurfaceView`, sets `SeekParameters.EXACT`
and exposes `setSource`/`play`/`pause`/`seekToFrame`. Composing the two would put two decoders on one
clip, and `expo-video` still exposes no per-frame callback for anything to observe — which is the
module's own stated reason for existing. So `frame-clock` renders the picture and `expo-video`
renders nothing. A note is appended to the step file; `expo-video` stays installed and unclaimed,
and if nothing claims it by the end of this track it should be deleted.

**What that forced natively**, none of which a spike playing a bundled asset could have hit:

| Addition | Why |
|---|---|
| `headers` | `MediaItem.fromUri` cannot carry an `Authorization` header, and the media driver here is `local`, so `/video` streams bytes itself and requires the bearer token. Unauthenticated, it is answered as the `DEV_USER_EMAIL` identity and returns **404 not 401** — D48's trap in native form. Fixed with a `DefaultHttpDataSource.Factory`, cross-protocol redirects allowed so the Supabase driver's 307-to-signed-URL path also works. |
| `positionMs` | The player's own bookkeeping — the third column of the sync panel. |
| `playing` | The transport reflects the player's real state, not JS's intent. |

**The bug the device found, and it cost a build cycle.** `httpFactory` was declared *below* the
`init` block. Kotlin runs initializers in source order, so it was null when `buildPlayer()` read it;
Expo caught the throw and substituted an `ErrorGroupView`, and the only visible symptom was
`ErrorGroupView cannot be cast to FrameClockView` raised by `getStats` — a message naming a healthy
function, about a view that was never built. Recorded in `decisions/mobile-client.md` because it
will bite any future local Expo module. The panel's stats poll now catches, too: four uncaught
rejections a second buried the one log line that said why.

**Design choices worth keeping.** Seeks are **coalesced, one in flight** — a drag emits a seek per
touch sample and firing them all puts the picture as far behind the finger as the queue is deep. It
also makes the measurement honest: one request produces exactly one landing to score against it.
Exactness is counted **twice**, in JS and natively, because they measure the same thing through
different clocks and a divergence is the bridge dropping events. The transport is bounded by the
**file**, not by `playback_window` — that needs `analysis.json`, which step 02 loads for the overlay.

**Verified:** mobile `tsc` clean · **83 jest tests** (+38) · `verify:media` 10/10 against the running
server · `gradlew :app:assembleDebug` BUILD SUCCESSFUL · APK installed on the S25+ · app launched and
a swing opened with a **clean logcat** · the player renders — video stage, scrub bar, transport, and
the frame-sync panel reading *519 frames at 60 fps*, Requested 0 / Presented 0, Drift `0 — locked`.

**Not verified, and the only thing outstanding:** that seeking is frame-exact on the glass. The
phone's proximity sensor is covered, so Samsung's *Accidental touch protection* swallows every
`adb shell input` event; `settings put system screen_off_pocket 0`, `dumpsys sensorservice restrict`
and force-stopping `com.samsung.android.gesture` were all tried and all failed. The instrument for
it is built and shipped: **Run 250 seeks** in the panel, which waits for each landing before asking
for the next so the sample size is real. `CURRENT-STATE.md` §11b still records scrubbing as
unmeasured and stays that way until the number exists.

---

## 01 — the swing plays, and the two bugs the device found
**Worked:** 2026-08-12 (same day, after the first on-device pass)

**Reported: "the swing would not play — source error".** True, and it was mine. Not auth, not the
media pipeline: **HTTP 400**, from `requireViewAccess`. `SwingDetailScreen` passed
`swing.primaryViewId` into `/video?view=`, and that parameter takes a view **TYPE** (`dtl` /
`face_on`), not a view **id** (a uuid). The route answers an unrecognised view with 400 rather than
falling back — deliberately, and its own comment says why: silently serving down-the-line for
`?view=overhead` would look like the parameter worked. `SwingSummary` carries both fields and they
are one word apart. Fixed by passing nothing at all, which is what a single-view player wants — the
route already orders by `is_primary`. The prop is now typed `SwingViewSummary["view"]`, so the same
mistake no longer compiles, and a test asserts both the typed form and the omitted form.

**The 400 was masking a worse one.** `setSource` and `setHeaders` each prepared the player, so
whichever prop Expo applied first decided whether the fetch carried a session. On the pass where
`source` won, the request went out unauthenticated, was answered as the development fallback
identity, and came back **404 rather than 401** (D48) — then self-healed on the next apply. An
intermittent bug that repairs itself is the worst kind to be left holding. Both setters now only
record, and `OnViewDidUpdateProps` prepares once after the whole batch has landed. Same change on
iOS, still uncompiled.

**Then it played.** Real footage on the S25+, 59.9 fps UI, **0 stutters**, 1889 frames at 60 fps,
and the panel reporting **container fps 60.00 vs 60 declared** — the check that would catch every
frame index being wrong while each number looked individually right.

**A partial sweep ran before the phone was picked up: 30 seeks, native 100.0% exact, p95 0, max 0,
worst seek error 0 frames.** Consistent with D40, and not yet the n≥200 the step asks for.

**Two flaws in the instrument, both visible in that screenshot and both fixed.** *Seeks exact (JS)*
divided by seeks **issued**, so the one still in flight counted as a failure and it read
`30/31 · 96.8%` about a run in which nothing had missed — it now divides by seeks **landed**, with a
regression test. And *Drift* showed `−1114` mid-seek, because while a seek is outstanding the
presented frame is the old one and the difference is the distance jumped, not an error; it now reads
`seek in flight`. An oracle that cries wolf is one people stop reading, which is the same failure
this project's own measurement history keeps repeating.

Verified: mobile tsc clean · **85 jest** (+2) · assembleDebug SUCCESSFUL · installed · swing opened
and played with a clean logcat.

---

## 01 - Frame-Exact Playback and Transport — COMPLETE
**Completed:** 2026-08-12 08:40 UTC · **Phase:** Core Golfer Experience
**Summary:** A golfer can play a swing frame by frame on the phone. Video surfaced by
`modules/frame-clock` (D50), transport with play/pause, ±1 and ±10 frame steps and a scrub bar, and
a development-only frame-sync panel that is the step's own oracle. No overlays — by design.

**The measurement, stated the way this project has learned to state them.** What was *directly
observed on screen*: **30 seeks · 100.0% exact · p95 0 · max 0**, worst seek error 0 frames,
`container fps 60.00 vs 60 declared`, 59.9 fps UI, 0 stutters, on a 1889-frame 60 fps clip. The
sweep was interrupted at 31/250 when the phone was picked up. Taylor confirmed the full run — "seek
looks good" — but **the figure was not read back, so nothing above n=30 is claimed anywhere.** The
step asked for n≥200; that shortfall is named in `CURRENT-STATE.md` §11b rather than rounded away,
and re-running it is one tap. This is the same discipline that should have applied when event
accuracy was once reported "verified ±2 frames" while Address was 48 frames early.

**Notes:** Overlays being absent is the deliverable, not an omission — Gate 2 ships a proven clock
with nothing drawn on it so that a later overlay bug is diagnosable as an overlay bug rather than as
a sync bug. Step 02 is scaffolded while this context was live, the way step 01 was (D49), and it
carries three things forward that were decided here and would otherwise be re-derived: the transport
is still bounded by the **file** rather than `playbackWindow` (which needs `analysis.json`, so it is
step 02's to adopt); the silhouette is **deferred out of the track** because its even-odd fill
cannot be expressed as plain `View`s; and whether a hundred-segment club trace survives the
plain-`View` decision (D23, D36) is an open question step 02 must answer **with a number** rather
than by reaching for Skia.

---
