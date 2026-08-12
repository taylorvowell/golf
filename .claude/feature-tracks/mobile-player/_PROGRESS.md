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
