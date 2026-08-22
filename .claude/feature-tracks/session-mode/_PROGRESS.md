# session-mode — Progress

Append-only log. Spec: `DESIGN-session-mode.md`. Decision: ARCHIVE D61.
**2026-08-20:** `.claude/golf_swing_capture_spec/` (00–12) adopted as the governing contract
for the capture subsystem — where it and older notes disagree, the spec wins.

## 06 - Upload and analysis wiring — a recorded swing reaches a real score
**Date:** 2026-08-22
**Phase:** Session Mode — Wiring
**Summary:** A swing recorded in session mode now uploads, analyses and comes back as a report.
Proven, not assumed: `pnpm --filter web capture:e2e` runs the whole loop through the same
functions the phone calls and passed on a real clip — **view ready at r2, 322 frames @ 60fps,
score 61.6**.

**The server already had two-phase ingest; what it did not have was a way to run the FIRST
analysis locally.** `startReanalysis`'s spawn path re-runs from an existing `analysis.json`, and
a swing recorded ten seconds ago does not have one — so every local capture would have sat in the
queue forever. `startCaptureAnalysis` now routes on `JOBS_DRIVER` (QStash for the hosted worker,
a child process here) and a shared `spawnAnalysis` serves both first-analysis and re-analysis, so
the ordering that makes publishing safe exists once rather than twice. `MediaStore.localPath`
answers where a stored clip is on this machine and the cloud driver returns **null** — which is
what stops a production deployment quietly assuming its objects are local.

**Progress is the job's, never a clock.** `AnalyzingBar` lost its 12-second timer: the segment lit
is the segment the job row reports, mapped from the analyzer's own stage strings, and it never
moves backwards when a stage name is unrecognised. A queue nobody drains reads "Queued" for as
long as that is true.

**The pipeline lives outside React.** `processing.ts` is module-level because the golfer records,
walks back to the ball and hits again — the screen that started the upload is gone long before the
analyzer finishes, and a hook would have aborted it. `useSessionPipeline` is the thin part that
must be in React: it starts a run per saved swing and folds only TERMINAL answers into the
reducer, so per-stage ticks never re-render a live camera preview.

**Failure never costs the video.** A failed run swaps the progress track for a notice carrying the
analyzer's own sentence plus Try again; the clip keeps playing behind it. The reason is shown
rather than mapped to a friendly generic, because "we couldn't find a swing" and "the upload was
refused" need different actions.

**Notes / named shortfalls.** Transport is one `PUT` of the trimmed clip — **no resumability, no
background survival, no wifi policy, no offline queue**; all four are `media-pipeline`'s behind the
`uploadSwingVideo()` seam. Video-only sessions upload and enqueue nothing (`analyze: false` →
`{status: "idle"}`), because skipping ingest would leave the only copy of the swing in a cache the
app sweeps; `analyze` defaults to true so an older client cannot trigger it. Both spawn paths now
pass `--club-detector` when `WORKER_CLUB_DETECTOR` names one — re-analysis never did, which was
the CLI trap applied silently to the server. `expo-file-system` was declared as a direct dependency
(it was already autolinked as a dependency of `expo`, so **no native rebuild is needed**).
Decisions recorded in `docs/decisions/media-storage.md`; `capture:e2e` documented in RUNBOOK §5.
**Device pass on the S25+ is the outstanding shortfall** — the emulator cannot record.

---

## 05 - Sessions become real
**Date:** 2026-08-22
**Phase:** Session Mode — Wiring
**Summary:** A practice session is now a row the server mints on the FIRST recorded swing, and the
swing log groups by it. Migration 0016 adds `sessions.name` (nullable) and `sessions.session_type`
(CHECK-constrained text, default `swing_analysis`); `GET`/`POST /api/v1/sessions` and
`PATCH /api/v1/sessions/:id` join the versioned API; `SwingSummary` grows `sessionId`.

**The two rules that carry the design, both pinned by tests.** `name` is **null until the golfer
renames it** — the app's own "Session 4" is a number it counted, and storing it would make every
session look renamed to a log whose title rule is "the date, unless they named it". And
`session_type` **locks once the session has swings** (409 `type_locked`), because every swing in a
session was captured under one promise and drills/video-only are quarantined from durable
averages; a late flip would rewrite what the golfer's history claims about swings already hit.

**Grouping now has two kinds and always will.** `sessionize()` groups by real `sessionId` where
there is one and falls back to the two-hour time gap where there is not — every swing recorded
before session mode has no id, so replacing the inference would have orphaned the existing log.
A session that knows its name and mode says so; one that does not abstains rather than inventing
them. Quarantine (`isQuarantined`) removes drills and video-only from `sessionStats`, `logStats`
averages, the home screen's `latestSessionStats`, and the progress window's compare — **absent,
never zero**: the session still counts, still shows its swings, and simply contributes no number.

**Notes:** The mint is fire-and-forget and does not block the save — the golfer sees their swing
the moment the trim finishes, and `session-minted` is dispatched only from the confirmed response
(no optimistic writes, matching `deleteSwing`'s discipline). A failed mint releases the guard so
the next saved swing retries; until one succeeds those swings group by time, which is exactly what
the log did before. Default numbering now comes from the server's session count rather than
`sessionize(swings).length` — a golfer who hit two balls and left still had a session, and the
old inference skipped it. Swing creation with the `sessionId` is step 06's; the seam is in state.
`route-auth.test.ts`'s `[id]` rule was widened from "must use requireViewAccess" to "requireViewAccess
OR listed in `ROW_SCOPED` **and** demonstrably running inside `withUser`" — a session id is not a
swing id, and the mechanical check had to stay total rather than be scoped to swings.
Decision recorded in `docs/decisions/platform-data.md` (edited in place).

---

## 04 - Recording WORKS on the S25+ — 1080p240 with a live preview
**Date:** 2026-08-21
**Phase:** Session Mode — Wiring
**Summary:** The record chain runs end to end on the phone. Confirmed in logcat:
`take RUNNING on rung 0 (240-240 +preview)` — 1920x1080 at **240 fps with the preview live
through the take**, which is the configuration this project had assumed was impossible here.

**What actually fixed it, after a day of wrong guesses.** The binding rule is in
`CameraConstrainedHighSpeedCaptureSession`'s own contract: *"If both preview and recording
Surfaces are specified in the request, the target FPS range in the input request must be a
fixed frame rate FPS range, where the minimal FPS == maximum FPS."* The S25+ publishes 1080p
at BOTH `[30,240]` (batch 8) and `[240,240]` (batch 4) — read off `dumpsys media.camera` — and
both report `upper == 240`, so ordering candidates by rate tie-broke between the VALID and the
INVALID combination arbitrarily. The invalid one does not throw on this HAL; it hangs, leaks
fences in `RealTimePreviewVideoHFR`, and triggers the HAL's own recovery. Every "the camera
froze" symptom traces to that one coin flip.

**Now: capture is a LADDER, asked of the device, never predicted** — fixed 240+preview → 240
record-only → 120+preview → 120 record-only, first configuration that actually configures
wins, 4s watchdog treats silence as refusal, and the log names the rung that ran. Variable
ranges are gone entirely (a floating rate writes timestamps that disagree with
`setCaptureRate` — D37's amendment).

**Four other real bugs found on the way, each worth keeping in mind:**
1. **Everything camera-related ran on the MAIN thread.** Expo dispatches a VIEW AsyncFunction
   on the UI thread, so `MediaRecorder.prepare()`/`.stop()` froze the whole screen including
   Stop. The `record:` log line coming from `tid == pid` is what gave it away.
2. **`stopRepeating()` was missing on the session swap.** Creating a session waits for the
   device to idle; a repeating request nobody stopped meant an 11-second block and a drain
   timeout. `close()` is the wrong tool here — it forces a drain this HAL times out on.
3. **The watchdog was posted to the camera thread**, queued behind the blocking call it
   existed to time out, so it never fired. It runs on the main handler now.
4. **`app.json` → manifest drift** shipped a build with no RECORD_AUDIO, and Android denies an
   undeclared permission instantly with no prompt. `dev-device.mjs` now auto-prebuilds on an
   app.json hash change, and also warms the bundle before launch (the white-screen race) and
   actually kills the port squatter (its taskkill flags were git-bash-escaped and silently
   failed from Node).

**Also shipped this session:** front camera removed entirely (high-speed is a rear-sensor
feature); an FPS pill was added and then REMOVED again the same day (Taylor — the rate is an
instrument; the never-degrade-silently promise is kept by the failure message and the capture
ladder's log); review screen rebuilt as a
**mark-the-strike** interaction — paused frame, scrub moves the frame, a small handle instead
of a range box, filmstrip from a new native `clipThumbnails`, delete confirms; 30s cap with a
5s on-screen countdown; `CONTROL_EDGE` (20% aqua) on capture controls as a named exception to
the no-borders rule.
**Audited 2026-08-21** — `.claude/audits/session-capture-2026-08-21/`. Four parallel reviewers
(fresh-eyes JS, native Kotlin, spec-conformance, tooling/reuse) found 4 native criticals, ~12
highs and a broken Metro launcher; all fixed in the same pass. The two worth remembering:
hardware BACK during a take finalised the recording natively with no path in JS and wedged the
reducer in `recording` forever (a lost swing AND a dead Record button), and nothing ever deleted
capture leftovers — a real phone had 1.8GB of stranded takes and filmstrips.
**Notes:** Orphan recovery added after a Fast Refresh remount mid-take desynced JS from
native and left "already recording" forever — native now abandons an unclaimable take rather
than refusing Record. Remaining shortfalls are in `_STATUS.json`: an outdoor pass (audio-seed
accuracy against real strikes, reliability over a bucket, thermals) and the provisional
bitrate constants.

---

## 04 - Camera preview and real recording
**Reconciled:** 2026-08-20 21:00 UTC  →  complete (partial — device pass pending)
**Phase:** Session Mode — Wiring
**Evidence:** Native half in commit `66a3479` (`HighSpeedCameraView` dual-session recording,
`SwingClip.kt` detect/trim, `SwingReview.tsx`); the joining wiring this session:
`sessionState.ts` (`pendingTake` stage; `take-ready`/`save-take`/`discard-take`;
review-before-mint per capture spec §01.5), `useTakeRecorder.ts` (240 ceiling, 23 s cap, 17 s
warning tone), `captureConstants.ts` (spec §11.7 values in one home), `SessionScreen.tsx`
(records for real, renders `SwingReview`, Save → `trimClip` → swing minted with its clip,
Delete discards take+file), `LocalClipPlayer.tsx` + `PostSwingView.tsx` (post-swing plays the
trimmed clip), `CameraStage.tsx` (camera ref + `onRecordingEnded` passthrough). Dead
`camera2Record` standalone path deleted (`Camera2HighSpeed.kt` is capabilities-only now);
`deleteClip` added. Oracles: mobile tsc clean, 411 jest tests green,
`:app:compileDebugKotlin` BUILD SUCCESSFUL.
**Notes:** Named shortfalls — S25+ device pass (HANDOFF row filed: real fps, take
reliability, audio-seed accuracy, trim playback); emulator flow walk needs a native rebuild
(module functions changed — `pnpm --filter mobile emu:native`). Source-deletion contract's
local half: untrimmed source deleted only after a successful trim; a failed trim saves the
take untrimmed (never lose the only copy). Deviations logged in `mobile-client.md`: plain
track not thumbnail filmstrip, no delete-Undo yet, detection post-hoc audio only (Tier C),
telemetry waits for step 06. Step 03 stays in-progress on Taylor's sign-off gate only — its
build half shipped; the wiring did not wait on it (his ask for the live camera authorized
pulling wiring forward, recorded 2026-08-18).

---

## 04 - Capture, audio-seeded review, ingest (partial — NOT wired end to end)
**Date:** 2026-08-20
**Commit:** `66a3479` — everything below is in that one commit, so it reverts as a unit.
**Summary:** Real recording and a confirm-before-save review screen exist and compile; the
SessionScreen wiring that joins them does not. Read this before planning capture work.

**Built and green** (Kotlin `BUILD SUCCESSFUL`; web tsc+lint clean, 232 tests; mobile tsc
clean, 407 tests):
- `HighSpeedCameraView` — ONE camera device, two session shapes. Idle is a repeating preview;
  a take reconfigures the same device as a constrained high-speed session carrying BOTH the
  preview and recorder surfaces. `startRecording(maxFps, maxSeconds)` / `stopRecording()` are
  view methods via ref. Back-lens only. Rate first, resolution second (smallest size ≥720
  short side). Hard cap via `MediaRecorder.setMaxDuration`, settled through a new
  `onRecordingEnded` event; tap and cap route through one `settle` function.
- Bitrate formula changed to `w*h*30*0.15*sqrt(fps/30)` — constants PROVISIONAL, pending a
  sweep diffed with `compare_analysis.py` against club coverage.
- Audio recording added (`CAMCORDER`, 44.1kHz mono) + `RECORD_AUDIO` in `app.json`.
- `SwingClip.kt` — `detectImpacts()` (5ms peak envelope, picks on ATTACK TIME not loudness;
  empty is a normal answer) and `trim()` (MediaMuxer remux, no re-encode, seeks to the
  PREVIOUS sync frame so a cut never clips the takeaway).
- `SwingReview.tsx` — loops a 6s window, scrubber slides the WHOLE window, candidate ticks,
  seeds on the LAST plausible transient (practice swing comes first), defaults to clip end
  when nothing is heard. Red Delete / green Save.
- Web ingest is two-phase: `POST /api/v1/swings` → `UploadTarget`, client PUTs the bytes
  directly, `POST /api/v1/swings/:id/source/complete` verifies and enqueues.
  `MediaStore.signedUploadUrl` + `enqueueCapture`.

**NOT wired — the flow cannot be walked yet:**
1. `SessionScreen` still dispatches the stub `{type:"stop"}`; nothing calls `startRecording`
   or `stopRecording`, and nothing routes a finished take to `SwingReview`.
2. Save does not call `trimClip`, and no `uploadSwingVideo()` seam exists — nothing reaches
   the ingest routes from the phone.
3. No scrubber thumbnails (needs a `MediaMetadataRetriever` native function).
4. No contract types or tests for the new ingest routes.

**If a new capture spec supersedes this, the conflict surface is:**
- `docs/decisions/mobile-client.md` → "Preview and recording share ONE camera device and one
  session" (one-device/one-session, back-lens-only, rate-over-resolution, cap mechanism,
  bitrate formula, audio-as-only-impact-signal).
- `docs/decisions/media-storage.md` → "Ingest is two-phase and the client uploads directly to
  storage".
Both are edited IN PLACE per the register rule — never appended to with a "previously we…".
The **web ingest layer is a different concern from capture flow** and probably survives a
capture-spec rewrite; the native session shape and `SwingReview` are what a new flow would
change or delete.

---

## 03/04 - Live camera preview pulled forward (in progress)
**Date:** 2026-08-18
**Summary:** Taylor asked for the camera during UX iteration — the exact scenario step 03's
notes anticipated, and his request authorizes the step-04 preview piece early.
`modules/high-speed-camera` gained `HighSpeedCameraView`: a Camera2 TextureView preview
(ordinary session for now; merging with the constrained record session is the rest of step
04) with `facing` + `zoom` props (CONTROL_ZOOM_RATIO, clamped to the device range),
centre-crop transform, generation-guarded lifecycle, released on every teardown path.
`CameraStage` mounts it behind a real permission state (denied = readable screen with a
Settings door, never an alert) and keeps the stub ground as fallback. Jest mocks the native
view like frame-clock's.
**Notes:** Recording remains the stub. Native change → dev-client rebuild required on both
emulator and S25+.
**Verified on the emulator (2026-08-18):** live preview renders under the full session chrome
— permission dialog → grant → synthetic camera scene with the DTL ghost, zoom stops, flip,
view switcher and dock all over it. Layout/flow only; no fps or reliability claim (emulator
rule).
**A pre-existing trap ate the first hour:** the rebuilt client hung on "Loading from…" —
NOT this feature's code (reproduced with the View registration stripped) and NOT the
hung-Metro trap (/status passed). RN 0.86.2's Kotlin `MultipartStreamReader` dies on Metro's
chunked multipart bundle response (`ProtocolException: Expected leading [0-9a-fA-F] character
but was 0xd`), content-dependent — today's bundle triggers it, last week's didn't — upstream
closed unfixed (facebook/react-native#56034). Standing fix: `apps/mobile/metro.config.js`
strips `Accept: multipart/mixed` from bundle requests (Metro then answers plain
Content-Length; only cost is the splash's download percentage). Recorded in ENVIRONMENT.md;
any Metro started before this file must be restarted.

---

## 03 - UX iteration (in progress) — round 4: camera controls + view toggle
**Date:** 2026-08-18
**Summary:** Left edge above the bar: camera flip orb + zoom stops (stub 0.5×/1×/2×). Right
edge above the help orb: the DTL/Front View toggle — and the alignment ghost now has a
face-on pose that follows it. All reducer state (`view`/`facing`/`zoom`), gated to idle so
nothing changes mid-capture; each swing is stamped with its view at stop. Step 04's Notes
gained the binding list (flip/zoom range/`--view` threading). `tsc` clean; 367 tests green.

---

## 03 - UX iteration (in progress) — rounds 1–3 of Taylor's feedback applied
**Date:** 2026-08-18
**Phase:** Session Mode — UI
**Summary:** Three feedback rounds landed in one pass. (1) Armed strip-down: after Record,
everything but the stop fades fast — header, title, toggle, ghost, help orb, the bar's side
items AND the bar's whole ground (surface/bump/fade now animate to transparent); settings
pills + the FPS pill are REMOVED (Taylor withdrew the FPS exception). (2) The session bars
are rebuilt on the tab bar's wave construction (`SessionNav`) with a bigger red record button
(74px vs the tab bar's 58) that is ALWAYS at exact screen centre (flex halves around a fixed
slot); the Record door is now a transparent modal — the surface slides up under a STATIONARY
AppHeader while the tab bar slides down in the same moment, and every exit reverses both; the
"New Session" green pill sits left of the name. (3) The post-swing dock trimmed to End
Session · Swing Log · Delete · Favorite around the centre record; the video-open controls
lift 104px above the bar (`controlsBottomInset`, additive prop on ReportVideoLayer); the
analyzing bar now FLOATS over the video above the bar (it was buried in the low-held sheet —
Taylor's "progress bar not showing" bug) and the swing-list sheet wears the Swing Log's
timeline language (connected rail + gradient dots + thumbnails + view/delete/star). End
session plays an arrival on the Swing Log: "Saving session…" beat → the card springs in →
the hero counts roll up (`sessionArrival.ts` consumed-once seam; step 05 stages it from the
real row).
**Notes:** `tsc` clean; 42 suites / 366 tests green after each round. Deleted: SettingsPills,
DockItem. From Home/Coach (light headers) the stationary-header illusion has a logo colour
flip at transition start — hero headers (log/progress) are seamless; flagged for Taylor's
next pass.

---

## 02 - Post-recording screen UI, stubbed
**Completed:** 2026-08-18 UTC
**Phase:** Session Mode — UI
**Summary:** The full session loop is walkable: stop → `PostSwingView` — the one-shape report
player in session chrome (the newest real swing stands in for playback until capture wiring).
Analyzing bar (spinner + 5 honest stages) tops the sheet while the stub runs (~12s), then the
"Analysis complete" flourish fires and the report sheet slides up via its own `presented`
entrance. Session dock: previous-swing · end session · swing-list sheet (view/delete/star,
"analyzing…" row) · big red Record New Swing · delete/favorite/cog. End session (and the
capture dock's Cancel once swings exist) lands on the Swing Log tab.
**Notes:** Built as an internal view of the `Record` route, not a new `SessionSwing` route —
one reducer owns both screens (note appended to the step file). Hardware back on post-swing
returns to capture (BackHandler), never out of the session. Post-swing renders under the
route's `FixedDarkTheme` — deliberate: session mode is a video surface. Previous-swing thumb
is a glyph until media wiring (step 06). `tsc` clean; 42 suites / 366 tests green. Stopping
before step 03 — Taylor's UX sign-off gate.

---

## 01 - Capture screen UI, stubbed
**Completed:** 2026-08-18 UTC
**Phase:** Session Mode — UI
**Summary:** The Record door now opens session mode: stub camera stage with the address-pose
alignment ghost (plain rotated Views — SVG stays confined to design/), top scrim with editable
session name / three-way type toggle + info sheet / settings pills + FPS pill, help orb, and
the dock (Cancel · delay popover Off/3/5/10 · big red Record-Swing that becomes Stop · AI
audio · cog). Countdown overlay (huge, abortable) → red recording treatment (breathing outline,
edge washes, REC chip) → stop mints a stub swing. `design/system/Sheet.tsx` created — DeckSheet
re-expressed on system tokens (the D61 Deck absorption start), no cast shadow, and added to the
SystemGallery. Old RecordScreen checklist lives on as the help sheet's content.
**Notes:** All state flows through `sessionReducer` (type locks at first swing; countdown abort
mints nothing) — pinned by `sessionState.test.ts`. Defaults persist via AsyncStorage
(`sessionDefaults.ts`, corrupt-storage-safe, tested). `tsc` clean; 42 suites / 363 tests green
(13 new). Delay-popover x-position is eyeballed — flagged for step 03 tuning.

---

## 2026-08-18 — Track created

Taylor specified session mode end to end (chat, 2026-08-18) and set the build order:
UI stubbed first (steps 01–02), UX iteration to his explicit sign-off (step 03 — a
Taylor-mandated gate), then wiring (steps 04–07). Product-level additions recorded as
PROJECT_MAIN §8.1 amendment, §8.6, §9.5 amendment (delay default 3 s), §9.6; rules in
`docs/decisions/mobile-client.md`; rationale in ARCHIVE D61. Auto-stop impact detection
iceboxed. Track added to ROADMAP.json with ownership splits noted on `in-app-capture` and
`practice-loop`.
