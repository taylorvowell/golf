# Mobile Client

Present tense, current state. Rationale lives in [ARCHIVE-numbered.md](ARCHIVE-numbered.md).
Measured device numbers are in [`../CURRENT-STATE.md`](../CURRENT-STATE.md) §11b.

## Framework and build

### React Native via Expo, with development builds and EAS for the cloud

**Decision:** React Native managed through **Expo** with config plugins and development builds.
**EAS Build** produces signed binaries for both platforms and **EAS Submit** handles store
delivery. OTA updates are for **JavaScript only** — never for native changes.
**Gotchas:** Expo Go cannot host native modules, so anything past the sign-in screen needs a
development build. Android builds locally with no Expo account; EAS is the **only** route to iOS
because there is no Mac. An EAS build is signed by an EAS-managed keystore with a different SHA-1
than the local one, so switching build routes means another OAuth client.
**See:** ARCHIVE D5, D12.

### The mobile app uses a plain `index.ts` → `App.tsx` entry, not Expo Router

**Decision:** Screens live in `apps/mobile/src/screens/`. `expo-router` is not installed.
**Gotchas:** Do **not** name a directory `src/app` — Expo's CLI reads it as an Expo Router root
and installing `expo-router` later would silently switch the entry point. Adopting Expo Router is
a decision to make deliberately, in `mobile-app-shell`.
**See:** ARCHIVE D44 addendum.

### `node-linker=hoisted` — pnpm's symlinked layout breaks the Android build

**Decision:** `.npmrc` sets `node-linker=hoisted`.
**Gotchas:** With the default symlinked layout, expo-modules-core's CMake resolves the same source
through both its symlinked and its real `.pnpm/…` path and dies on *"ninja: error: manifest
'build.ninja' still dirty after 100 tries"*. It is **not** a path-length problem. The trade is
that a hoisted tree is npm-shaped, so phantom dependencies stop being caught. Also: `pnpm install`
fails with `ERR_PNPM_ENOENT` while Metro or `pnpm dev` holds files — stop both, install, restart;
`pnpm install --force` repairs a half-written tree.
**See:** ARCHIVE D21.

## Native modules

### Two local Expo modules are load-bearing

**Decision:** `modules/frame-clock` and `modules/high-speed-camera` are permanent, not spike
leftovers. They were the step 02 spike's actual deliverable. `frame-clock` gained its consumer with
the player (below); `high-speed-camera` gained its consumers with the session record chain
(`CameraStage` preview, `useTakeRecorder`, `SwingReview` detection, save-path trim).

- **`frame-clock`** wraps Media3's `VideoFrameMetadataListener`. No Expo/RN video component
  surfaces a per-frame presented-frame callback, and the whole overlay depends on one.
- **`high-speed-camera`** wraps a Camera2 constrained-high-speed session.

**Gotchas:** In any local Expo module, **declare every property the `init` block uses above that
block.** Kotlin runs initializers in source order, so a field declared lower is null when `init`
reads it; Expo swallows the throw and substitutes an `ErrorGroupView`, and the only symptom is
`ErrorGroupView cannot be cast to <YourView>` raised by whichever view function JS calls next — a
message naming a healthy function, about a view that was never built. `frame-clock` pins media3 to
the version `expo-video` resolves — two media3 versions on the classpath fail at **runtime**, not
at build time. In `high-speed-camera`, the working call
is the **deprecated** `createConstrainedHighSpeedCaptureSession(surfaces, callback, handler)`
overload; the modern `SessionConfiguration(SESSION_HIGH_SPEED, …)` is silently swallowed on the
S25+ with no callback and no error. **Do not "fix" that deprecation** — it removes 240 fps.
**See:** ARCHIVE D21, D39, D44.

### Bluetooth shutter remotes drive recording via `modules/shutter-remote`

**Decision:** A Bluetooth camera shutter remote (Taylor owns one) starts and stops recording on
the session screen. These remotes pair as a one-key Bluetooth HID keyboard and send plain key
events (VOLUME_UP on virtually all of them; ENTER from some models' second button), so
`modules/shutter-remote` attaches an `OnUnhandledKeyEventListener` to the activity's decor view —
volume keys fall through the React view tree unhandled, and this listener runs **before** the
window's fallback volume handling, so the app both sees and consumes the press. The claim is
scoped: `useShutterRemote` holds it only while the session screen is mounted, so volume behaves
normally everywhere else. A press dispatches the reducer's `shutter-press` action, which resolves
by context — reviewing → next swing armed, idle → arm, countdown → cancel, recording → stop — so
the golfer never touches the phone between swings. Presses within `SHUTTER_DEBOUNCE_MS` (3s) of
the last stop are ignored: that is the double click on Stop, and it must not arm the next swing.
Cancelling a countdown carries no hold — pressing again immediately starts over. The phone's own
volume rocker is deliberately the same trigger (stock-camera convention, and it makes the path
testable without the remote: `adb -s <target> shell input keyevent 24`).
**Gotchas:** Android-only (`requireOptionalNativeModule` returns null elsewhere — callers no-op).
The listener API is API 28+. MainActivity is never patched — CNG stays intact. **iOS, when it
becomes buildable (blocked on D5/D12):** Apple exposes no volume-key event API; the established
technique these remotes rely on is observing `AVAudioSession.outputVolume` (KVO) and restoring
the level — the same JS seam (`shutter-press`) stands, only the native module needs a twin.

### Record start/stop sounds are the system camera's own, behind a Settings toggle

**Decision:** Recording start and stop play an audible cue — Android's `MediaActionSound`
`START_VIDEO_RECORDING` / `STOP_VIDEO_RECORDING`, exposed as `playRecordSound(start)` on the
`high-speed-camera` module. No bundled audio assets: golfers hear exactly what their stock
camera plays. The cue fires in `useRecordSounds` on entering/leaving the reducer's `recording`
mode — a cancelled countdown stays silent — and is gated by Settings → Recording → "Play record
and stop sound" (default on). Around it, two `ToneGenerator` tones at volume 40/100, quieter
than the record cue: a **press acknowledgment** (PROP_ACK) the instant an arming click lands,
and the countdown's **3-2-1 ticks** (PROP_BEEP) — the number shown at the moment of arming is
skipped because the acknowledgment already sounded for it. A cancelled countdown plays the
**stop-recording cue** — one sound means "not recording", however you got there. The ticks
alone have their own sub-toggle ("Countdown
beeps", default on) which is disabled unless the master sound toggle is on; the acknowledgment
and cancel tones ride the master toggle. That toggle is the first **app-level preference**:
`features/settings/appPrefs.ts`, AsyncStorage-backed with a module-level cache + subscribers so
Settings and the capture screen read the same value, device-local like the session defaults.
**Gotchas:** every native sound call is `?.`-guarded per METHOD — a fresh bundle on a
not-yet-reinstalled APK lacks the newer functions, and that mismatch once crashed the capture
screen ("undefined is not a function") the moment recording started. iOS twin, when buildable,
is `AudioServicesPlaySystemSound` (1117/1118 are the system's begin/end video record sounds).

### The overlay stays in TypeScript

**Decision:** Do not draw the overlay natively. Plain rotated `View`s drawing 49 keypoints reach
99.2% frame-lock, and removing React state from the paint path scored no better (99.0%). Skia is
unnecessary. Rejected on cost, not on merit.
**Gotchas:** That 99.2% was measured at roughly **77 views**. With the club-head trace on, the
overlay peaks at **461 views** (400 of them trace) at impact on `pro_3`, and **the frame lock at
that count has never been read off a device** — the measurement was declined, not taken. A
rejection-on-cost is only reversible by a measurement, so treat Skia as an **open** question, not a
closed one, and never re-describe the view count as a performance result. Settling it is one screen:
RUNBOOK §12b.
**See:** ARCHIVE D23, D36, D51.

## Playback and capture rules

### The video surface is `modules/frame-clock`; `expo-video` renders nothing

**Decision:** Swing playback goes through `FrameClockView`, which owns its own `ExoPlayer` and
`SurfaceView`. It is a **player, not an observer** — composing it with `expo-video` would put two
decoders on one clip, and `expo-video` exposes no presented-frame callback for anything to observe.
Its source carries `headers` from `api.mediaSource()`.
**Gotchas:** Without those headers `/video` is answered as the `DEV_USER_EMAIL` identity and returns
**404 rather than 401** — D48's trap, in native form. `expo-video` remains installed and unused; if
nothing claims it by the end of `mobile-player`, delete it (it is a config plugin, so that is a
native rebuild). `frame-clock` is spike-grade next to `expo-video` on buffering, error and lifecycle
handling — that gap closes as the track needs it.
**Scope:** Anything needing frame-exactness. A non-frame-exact preview clip may use `expo-video`.
**See:** ARCHIVE D50.

### Two swings are compared by POSITION, never by frame or by time

**Decision:** A synchronized comparison maps the leader's frame onto the follower's through the
**P-codes both artifacts carry** — piecewise-linear between shared positions. Address is address in
both, the top is the top in both, and differing lengths and frame rates fall out for free.
**Gotchas:** Frames don't transfer between clips, and scaling by duration is worse because it
cancels exactly the tempo difference being compared. The map **clamps** outside the detected swing
rather than extrapolating, and uses **only positions both artifacts detected** — fewer than two
shared means unalignable, which the UI must *state*, because a silently misaligned pair looks
exactly like a working one. Build the anchor table sorted by **P-code ordinal**: sorting by frame
makes the strictly-increasing check vacuous and lets a swing whose top was detected before its
address run the follower backwards.
**See:** ARCHIVE D52.

### Seek to `frame / fps` on Android — never the web player's `(frame + 0.5) / fps`

**Decision:** The seek target on Android is `frame / fps`.
**Gotchas:** HTML video seeks to the frame *containing* a time; media3 resolves **forward** to the
next boundary. The conventions are opposite, and porting the web rule costs exactly one frame on
every seek. Seeking is 100% frame-exact once the target is right, and seeking over HTTP adds
**zero** additional error.
**See:** ARCHIVE D40.

### High frame rate is real, and only a direct Camera2 high-speed session reaches it

**Decision:** Build the Camera2 constrained-high-speed path in `in-app-capture`. 1080p reaches
**231 fps** (240 requested) and **119 fps** (120 requested); 60 fps holds at 59.5–60.0.
**Gotchas:** `react-native-vision-camera` v5 accepts 120/240 and **silently delivers 60**. CameraX
1.5 refuses outright — it gates on `CamcorderProfile`, which this device leaves empty. Capability
must be probed at runtime and never assumed; the S25+ is a flagship and a mid-range Android may
differ. 231 vs 240 is 3.6% short and unexplained — check before relying on an exact rate.
**See:** ARCHIVE D37, D38, D39.

### Preview and recording share ONE camera device and one session

**Decision:** `HighSpeedCameraView` owns the camera. Idle is an ordinary repeating preview onto its
`TextureView`; a take reconfigures the same device as a `CameraConstrainedHighSpeedCaptureSession`
carrying **both** the preview surface and the recorder's, so the picture stays live at the capture
rate. `startRecording(maxFps, maxSeconds)` / `stopRecording()` are view methods (a ref), not module
functions — a module-level record would need a second `CameraDevice`, and two owners of one camera
is what made recording black the preview out.
**Recording is back-lens only.** High-speed configurations are a rear-sensor feature on essentially
every Android; the front lens publishes none, so it is a framing aid and `startRecording` refuses
there rather than dropping to 30fps unannounced.
**Rate first, resolution second.** The chooser takes the highest rate at or below the requested
ceiling, then the SMALLEST size still at or above 720 on the short side — because frames are what
the club detector is starved of, while everything above 720 is discarded by the analyzer's own
downscale (`video.py`) before a keypoint is computed.
**A preview in the take REQUIRES the FIXED fps range, and the range is chosen deliberately, never
by a sort.** `CameraConstrainedHighSpeedCaptureSession`'s contract: *"If both preview and recording
Surfaces are specified in the request, the target FPS range in the input request must be a fixed
frame rate FPS range, where the minimal FPS == maximum FPS."* The framework interleaves the batch
itself — preview at ~30 fps, encoder at the full rate. The S25+ publishes 1080p at **both**
`[30,240]` (batch 8) and `[240,240]` (batch 4), and both report `upper == 240`, so ordering
candidates by rate tie-breaks between the valid and the invalid combination arbitrarily — which is
how a variable range reached a preview-bearing session and hung the HAL for a day (2026-08-20).
Variable ranges are now never used at all: a rate floating between 30 and 240 writes timestamps
that disagree with `setCaptureRate`, and a file whose frame timing lies is worse than no file
(D37's amendment). **Capture is a LADDER, not a choice** — fixed 240 with preview, then 240
record-only, then 120 with preview, then 120 record-only; the first configuration the device
actually configures wins, a 4 s watchdog treats silence as a refusal, and the log names the rung
that ran. Reading a capability table does not predict what a HAL will run; asking it does.
**The preview is a `SurfaceView`, and the buffer size is fixed at open to the take's size.** A
TextureView's SurfaceTexture is drained by the app's GL thread; at high speed it cannot keep up, the
queue backs up, and this HAL leaks fences and triggers its own recovery — the app frozen
mid-countdown with the camera dead, then `waitUntilIdle … Error waiting to drain` on every retry
(2026-08-20). A SurfaceView's queue goes straight to SurfaceFlinger and drops what it cannot show,
which is what Samsung's slow-motion and CameraX's PERFORMANCE preview both rely on. Consequences
that are load-bearing: the centre-crop is done by laying the child out oversized and letting the
parent clip (no matrix on a SurfaceView); the recording size is chosen at camera-open so entering
the constrained session resizes nothing; every session and request targets the holder's ONE Surface
(a second wrapper over the same queue leaves un-signalled fences); the session swap does **not**
`close()` the old session (an explicit close forces a drain this device times out on — supersede it
instead); and the high-speed request carries the AE fps range and nothing else — no zoom key, which
`createHighSpeedRequestList` does not promise to accept and Samsung's own slow-mo does not offer.
Recording is **1080p**, the largest size at the chosen rate: the OEM's own slow-motion shape, and
off that path this HAL wedges rather than refusing. A watchdog settles a session that never
configures, so a stall is a readable failure and never a frozen screen.
**Gotchas:** The two-surface limit is the API's, and it is why nothing can sample frames for motion
detection during a high-speed take — impact detection is audio-only by construction, not by choice.
The hard cap is `MediaRecorder.setMaxDuration`, never a posted runnable: the recorder finalises the
file itself, so a cap reached while JS is busy still yields a playable MP4. It settles through
`onRecordingEnded`, because JS cannot poll for it and a screen still reading "Recording…" after the
file closed is the worst available failure. Both endings (tap, cap) route through one `settle`
function so they cannot diverge. A `MediaRecorder.stop()` that throws means the take was too short
to write a valid MP4 — reported, never left as a zero-byte file.
**Orientation is stamped into the container, and every remux carries it across.** The sensor is
mounted landscape and hands the encoder landscape frames however the phone is held, so a portrait
swing is portrait only because `MediaRecorder.setOrientationHint` says so — read from
`SENSOR_ORIENTATION` rather than written as 90, since it is a per-sensor fact. `SwingClip.trim`
re-declares it on its `MediaMuxer`: a remux starts from a blank header and inherits nothing, so
Save would otherwise put an upright take back on its side. Both halves are required and neither is
sufficient alone.
**Bitrate is `w × h × 30 × 0.15 × sqrt(fps/30)`,** replacing `w × h × fps × 0.25`. The old flat
per-frame allowance asks 124 Mbps at 1080p240 and roughly triples what the encoder needs: at high
rates adjacent frames are nearly identical, so bits-per-pixel should FALL as the rate rises. The
constants are provisional until a bitrate sweep is diffed with `scripts/compare_analysis.py`,
watching **club coverage**, which degrades long before pose does.

### Every video surface in the app is silent

**Decision:** audio exists in this product for ONE purpose — locating the strike — and `SwingClip`
does that by decoding the track directly, never by playing it. So every `FrameClock` player is
created with `volume = 0f` and the module exposes **no way to raise it**: `setMuted` was deleted
rather than defaulted, because a rule every call site has to remember is a rule the next surface
forgets. `expo-video`'s preview sets `muted` on its own player for the same reason. A clip that
speaks in a quiet room — or at 8× — is noise, never information (Taylor, 2026-08-22).

### Durations are FILE seconds, and a slow-motion clip's file seconds are not the world's

**Decision:** a phone slow-motion clip records `com.android.capture.fps=240` while its container
advances at 30, so its timeline runs **eight times slower than reality** and every duration derived
from it means an eighth of what it looks like. Measured on a real clip: the review window's ±2.5 s
was ±0.31 real seconds, which is why the backswing fell outside the saved clip. `describe()`
therefore reports `captureFps` beside the playback rate, `SwingClipRef` carries
`slowMoFactor = captureFps / fps`, and **every duration on the review screen is written in REAL
seconds and multiplied through it** — the trim window, the scrub axis's magnified bands, and the
preview's playback rate. Anything this app records reports no capture rate and the factor stays 1.

### A layout sizes video from a MEASURED ratio: width 100%, height derived, overflow cropped

**Decision:** width fills the container, height is computed from a ratio the player reported, and
the excess is cropped — never fitted (Taylor, 2026-08-22). The native surface is `MATCH_PARENT` and
has no opinion about aspect, so a box of the wrong shape does not letterbox, it **distorts**;
deriving height from width and a measured number makes squashing arithmetically impossible instead
of something to keep re-tuning. Cropping is **vertical**: the sides of a golf frame hold the club
and the ball, the top and bottom are sky and mat. The filmstrip follows the same rule from each
thumbnail's own reported pixel size, centred so half the overhang goes above and half below.

### The review screen keeps a frozen frame, a linear scrubber, and a corner preview

**Decision:** the big picture is the scrub read-out — parked on whatever frame the mark sits on —
the scrub track is linear in time, and the window Save would cut loops in a small preview in the
top-right corner. Reverted here on 2026-08-22 after trying the alternative.

**What was tried and dropped**, so it is not re-proposed as new: a warped scrub axis magnified
around the detected strike, a filmstrip sampled along that axis, a drag magnifier above the
scrubber, and a big picture that looped the window under a waiting glyph while a finger was down.
Every piece worked; together they changed the screen more than the problem warranted. The
capability that survives is `clipThumbnailsAt` in the native module — frames at explicit times
rather than evenly spaced — which is left in place because it is small, documented, and the only
awkward part of that experiment to rebuild.

**The corner preview taps to enlarge**, to about three quarters of the video area and back, with a
small radius on both states and a scale-down on press — pressed feedback on a picture cannot be a
fill (it would sit behind the video) and must not be opacity. It is sized against the STAGE, not
the window, because the stage clips its overflow and a panel measured against the screen loses its
bottom when enlarged; the enlarged shape comes from the video's own measured ratio, fitted to
whichever axis binds.
**It carries a cast shadow — a NAMED EXCEPTION to the no-shadows rule** (Taylor, 2026-08-22). The
register forbids drop shadows because elevation is the surface ramp, but this panel has no surface
under it: it floats over live footage whose colour changes shot to shot, so on a bright frame its
edge disappears entirely. That is the same argument that earned `CONTROL_EDGE` its exception for
controls over the camera picture. Soft and close (`PANEL_SHADOW`) — it separates the panel from the
swing rather than decorating it, and the exception does not generalise to surfaces that sit on a
theme colour.

**The shipped seeder is `hf`** (Taylor, 2026-08-22): it keys on the high-frequency click of a
strike rather than its loudness, which is what separates a golf shot from the other loud things at
a range. Chosen on judgement against real clips — there are still no labelled strike frames in this
project, so it is a preference and must never be written down as an accuracy figure. The storage
key carrying the golfer's own choice was bumped to `v2` with the change, because a stored value
outranks a default and every device that had opened the picker would otherwise keep seeding with
the old one.

### A player reports CODED dimensions, so every layout must apply the rotation itself

**Decision:** `ReadyEvent` carries `rotationDegrees` alongside `width`/`height`, and
`displayAspectRatio(event)` in `FrameClock.types.ts` is the ONE place the rule lives. A portrait
phone clip is stored 1920x1080 with 90° of rotation in the container; media3 draws it upright but
`format.width/height` still describe the stored frame, so a box sized from the raw pair squashes
every portrait video it draws — which is exactly what the review screen did until 2026-08-21.
**The native surface is `MATCH_PARENT` and has no opinion about aspect**, so a wrong ratio does not
letterbox, it distorts. A screen showing video therefore owes it a correctly-shaped box; the review
screen sizes the video to COVER its stage and lets the stage clip the overflow (Taylor: use the
whole screen rather than letterbox a swing into a tall black frame) — the same centre-crop trick
the camera preview uses, for the same reason.

### The scrub handle says when it is held

**Decision:** the mark handle takes an aqua fill and a small scale step while a finger is on it
(Taylor, 2026-08-21) — a fill and a size change, never a border or a shadow. On a drag-only control
with no pressed state, nothing otherwise distinguishes "I am moving this" from "I am touching the
screen near it". `onPanResponderTerminate` clears it as well as release: a gesture the system takes
away never sees a release, and a handle left glowing claims a finger that has gone.

### The review screen previews the clip Save would actually produce

**Decision:** a picture-in-picture in the review screen's bottom-right corner loops the exact
window Save would cut, at 1x, labelled "Swing preview". The handle answers *where did you hit it*;
this answers the question the golfer actually has — ***is the whole swing in there?*** — which a
scrubber position cannot show and which, until now, could only be checked by saving and looking.
Both the preview and Save read one `windowAround(mark)` helper, because a preview showing a
different window than the one saved would be worse than no preview.
**It follows the COMMITTED mark, never the live drag** — the finger lifting, a screen-reader step,
or detection answering. Re-cutting on every pan event would restart the loop sixty times a second
and show nothing but its first frame.
**The loop is a timer that re-arms, not a frame watcher.** media3 offers no loop-a-window
facility, and the alternative — `emitFrames` plus a JS callback testing every frame against the out
point — puts a 60 Hz callback on screen for a decoration; over five seconds a timer's drift is well
below what an eye can see on a re-cut loop. An interval is wrong here where a re-arming timeout is
right: an interval keeps firing while a seek is still resolving and walks the loop point forward.
**The preview runs on `expo-video`, NOT on `FrameClockView`, and that is the decision.**
`FrameClockView` exists for one thing — frame-exact overlay sync — and pays for it with a native
view whose methods dispatch by view tag. A second instance of it on this screen could not be driven
at all (`Unable to find … FrameClockView view with tag N`), and its SurfaceView also composited
*underneath* the first one, so the same feature failed twice for two unrelated reasons and both
presented identically as "the preview doesn't play". A preview needs none of what that module buys:
no frame index, no overlay, no drift measurement — a start, an end and a loop. `expo-video`'s
player is a JS-owned object, so there is no view to fail to resolve. **The generalisation worth
keeping: reach for `FrameClockView` only where frame-exactness is the product; anywhere else it is
a liability with a cost.**
**Exactly ONE seek per window, and `readyToPlay` is not "start over".** That status fires again
after every buffering stall, so seeking on each occurrence pinned the player forever: measured on
the emulator, `BUFFERING@101500 → PLAYING@101517 → BUFFERING@101500`, repeating — seventeen
milliseconds of playback, then yanked back to the window start, which on screen is a perfectly
correct frame that never advances. The owed seek is held in a ref, paid once, and every later
`readyToPlay` only resumes. **The generalisation, which this feature learned twice: a recovery
action wired to a RECURRING event is not recovery, it is a loop** — the same shape as the
before-the-window test that preceded it.
**Only the END of the window is tested.** An earlier loop also sent the player back when it read
as BEFORE the window — intended to recover a stale position, it instead re-seeked on every tick
while `currentTime` was still catching up to the seek that had just landed, so the preview sat
frozen on a perfectly correct first frame. A loop only needs to know where it ends. Playback starts
from a `statusChange` → `readyToPlay` listener, because `useVideoPlayer`'s setup callback runs
before the file is readable and a `play()` there has nothing to honour.
**`player.loop` is not used** — it replays the whole FILE, and the file is a minute of walking out
and walking back. The window is the point, so the loop is a `timeUpdate` listener at 0.1 s
comparing position against the committed window and sending the player back to its start. The same
test catches a position *before* the window, which is what a fresh source or a re-cut leaves.
**Named cost:** this is a second decoder on the same file while the main player holds the first.
The main one is parked on a frame rather than decoding, but on a 1080p240 clip two sessions are not
free — this is the surface the "two-decoder reading" HANDOFF row is about.
**Dependency:** `expo-video` (~57.0.2) enters the app here, with a config plugin, for this preview.

### The impact detector is switchable, and none of its methods has an accuracy number

**Decision:** `detectImpacts` takes a method — **`attack`** (rise vs. a running background, the
shipped default), **`peak`** (plain loudest window), **`hf`** (rise in a first-difference envelope,
keying on the broadband *click* rather than loudness), **`flux`** (positive energy change — onset
strength, which survives a background that is not quiet), **`sharp`** (HF attack weighted by level,
the two working ideas composed), **`crest`** (peak over RMS — impulsiveness measured without
loudness, the only scale-free test here), **`decay`** (fast rise AND fast fall, the only test that
looks forward, which is what separates a strike from anything that sustains) and **`ensemble`**
(each method normalised against its own best, votes pooled by proximity — agreement is evidence
where magnitude is not). Eight different physical discriminators, not eight tunings of one; all
three envelopes are built in a single decode, so switching costs nothing and the ensemble is one
decode rather than eight.
**Both ends of a clip are down-weighted** (`EDGE_SEC` = 5 s, ramping to a `EDGE_FLOOR` of 0.15 at
the very edge, and shrinking on a short clip). A golfer filming alone walks out and walks back, so
both ends carry footsteps and phone handling — the loud, sharp, non-golf material every method is
vulnerable to. A **prior, not a filter**: an edge strike still wins when nothing in the interior
comes close, because "highly unlikely" is the instruction and "impossible" is not. It is switchable
off, since a prior nobody can disable is a prior nobody can check. The no-candidate fallback moved
from 2.5 s to 6 s from the end for the same reason — the silent case must not land in the region
the loud case is told to distrust. Selected from the debug menu,
persisted, and the review screen names the active method on a dev clip — changing it re-seeds the
mark in place, so one clip yields four answers without a reload.

**No method here has a measured accuracy, and none may be given one.** There are no hand-labelled
strike frames in this project, so a preferred method is preferred because a person watched the seed
land on real clips — a judgement, and it must be written down as one. This is the exact shape of
the "event accuracy verified ±2 frames" claim that was later found 48 frames wrong; a switchable
detector makes that error easier to commit, not harder. The seed is also never a measurement in the
product sense: the analyzer locates the true Impact frame from the club-head low point, and it
overrides anything this picks or the golfer drags.

### Pre-recorded clips can stand in for a take, from a folder that needs no permission

**Decision:** `__DEV__` builds offer the clips in **`Android/media/<pkg>/dev-clips`** in the debug
menu; picking one dispatches `dev-take` and lands on the review screen exactly as a finished
recording would. That folder is the only one that is both writable with **no permission declared**
and still **visible to Explorer-over-USB and the phone's file manager** — Android 11's scoped-storage
lockdown covers `Android/data` and `Android/obb` and deliberately not `Android/media`. A public
folder (`Movies`, `DCIM`) would require `READ_MEDIA_VIDEO`, and a permission declared for a debug
convenience ships in the release manifest and onto the store's data-safety form. `Android/data/<pkg>/
files/dev-clips` is still scanned as a fallback — it was the first choice, and `getExternalMediaDirs`
is deprecated-but-functional, so a device answering null must still have somewhere to look; only the
primary folder is ever NAMED, because a drawer offering two paths gets files put in the wrong one.
Rate is derived as **frames ÷ duration**, not read from `CAPTURE_FRAMERATE`: a phone slow-motion file
is captured at 240 and plays at 30, and the frame clock needs the rate the container advances at.
**The drawer is triage, not a file list.** Each clip carries a thumbnail, its file name, a
persisted status (new / tried / saved — `devClipMarks`, keyed by NAME so a clip moved between the
two folders keeps its verdict) and an **angle tag** guessed from the file name and correctable by
tapping. The tag is the load-bearing control: `dev-take` stamps the swing with it, and a face-on
clip stamped `dtl` inverts every lead/trail metric downstream, where it presents as bad analysis
rather than bad metadata. This drawer is also the project's only source of face-on footage — every
fixture is down-the-line, so it is the first real film the view-gated and mirroring paths ever see.
**On a dev clip the bin is a Back arrow, and backing out reopens the library.** The file survives
whatever happens on the review screen, so a destructive framing would be a lie, and the two-tap
"try one, reject it, try the next" loop is the reason the drawer exists.
**A dev take is flagged, and nothing deletes a flagged file.** Save unlinks the source once the
trim succeeds and Delete unlinks it outright — both correct for a recording, both catastrophic for
a developer's clip library, so `PendingTake.dev` gates every unlink and `trim` writes to the cache
rather than beside its source. `dev-take` is also a separate action from `take-ready`, whose
`mode === "recording"` guard settles the tap-versus-cap race and must not be loosened to admit a
debug control.

### The record chain is take → review → trim, governed by the capture spec package

**Decision:** `.claude/golf_swing_capture_spec/` (00–12) is the governing contract for the capture
subsystem — capture, detection, review, trim, upload, backend. Where an older step file or comment
disagrees with it, the spec wins. The wired chain: Record drives the native session through
`useTakeRecorder` (requests the 240 ceiling; the device's configured rate is the truth); a
finalized take enters `pendingTake` and **review owns the surface** — a recording never becomes a
swing except through `save-take`, and nothing (arm, shutter remote, hardware back) can touch an
unreviewed take, because it is the only copy of that swing — hardware back is inert for the whole
of a countdown, a take and a review for exactly that reason. Save cuts a **5 s** clip around the
marked strike (remux, no re-encode) and mints the swing with its `clip`; Delete discards take and
file, and a take the flow can no longer reach is deleted rather than merely dropped.
The post-swing screen plays the trimmed clip until step 06 swaps in the analyzed swing.
**Constants live in `features/session/captureConstants.ts`** (spec §11.7): a **30 s** hard cap
with the last **5 s** counted down on screen (and the warning tone moved to where that countdown
begins), a **5 s** review window, `SAVE_PAD_S` = 100 ms of hidden slack added to each end of the
saved clip, and a 240 fps ceiling. The cap is generous on purpose: without live detection the app
cannot know a late shot still needs its follow-through, and a lost swing is the worst failure the
spec names.
**Source-deletion contract, local half:** the untrimmed source is deleted only after a successful
trim (locally, a successful trim is acceptance; the upload half arrives with step 06). A failed
trim saves the take **untrimmed** as the swing's clip — never lose the only copy.
**The review screen asks for ONE moment, not a range** (Taylor, 2026-08-21) — a deliberate
inversion of spec §01.5.6, which specifies a fixed six-second window the golfer slides. The golfer
marks where they hit the ball on a **filmstrip** scrubber; the clip is cut around that mark and its
edges are never shown, because "that is where I hit the ball" is a question a golfer can answer
between swings and "that is a good place for a clip to start" is not. The picture stays **paused**
(scrub moves the frame, no loop): a loop invites refereeing its edges — the judgement being taken
off them — and at 240 fps the bottom of a downswing is gone before a loop restarts.
**Other named deviations:** Delete asks for confirmation instead of the spec's delete-with-Undo
(§01.6.2) — the take is the only copy, never uploaded, with no undo behind it; an Undo is the
better end state and is step 07's. Candidate markers are NOT drawn on the track: a row of the
app's guesses asks the golfer to choose between them, which is harder than the question being
asked. Detection is post-hoc audio only (the spec's Tier C — the two-surface limit forbids live
sampling). Capture-attempt telemetry (predicted vs corrected mark, spec §03.20/§06.11) is not yet
captured and belongs with the step 06 create API — the one deviation with no upside, since the
comparison exists for free at the moment of Save.

### Session mode is the capture surface, built UI-first behind Taylor's sign-off gate

**Decision (Taylor, 2026-08-18):** The Record door opens **session mode** — the full recording
experience specced in `.claude/feature-tracks/session-mode/DESIGN-session-mode.md`: live
capture screen (app header + "New Session" pill, editable session name, three-way session
type, alignment ghost, countdown, red recording treatment — and while armed the chrome strips
to the stop button alone) and the post-recording screen (the one-shape report player in
session chrome with a floating staged analyzing bar and the session bar). Both session bars
are the tab bar's wave construction with a **bigger red record button always at the exact
screen centre**; no settings pills and **no FPS readout anywhere on the capture surface**
(Taylor: withdrawn at step 03, tried again 2026-08-20, removed for good 2026-08-21). The rate
is an instrument, and the instrument rule holds even for the one number this app is proudest
of. §2.3's never-degrade-silently promise is kept by the **failure path** instead: a camera
that cannot give the requested rate says so in a readable message, and the capture ladder logs
the configuration it actually ran. The native `onCaptureConfig` event stays — the probed
rate/size belong on the swing record as capture metadata (spec §06.8), which is data, not
chrome.
Build order is UI-stubbed-first; **wiring starts only after Taylor signs off the UX** — his
explicit gate, an exception to the no-approval-gates rule. A session row is minted **only when
the first swing is recorded**; sessions carry a name and a type (Swing Analysis / Practice
Drills / Video Only — drills quarantine like D56, video-only skips analysis and is the
entitlement floor). Recording delay defaults to **3 s** (off/3/5/10).
**Gotchas:** The capture preview must come from extending `modules/high-speed-camera` with a
preview surface on its Camera2 constrained session — adding `expo-camera` for preview would put
two stacks on one camera device, and vision-camera silently delivers 60 (D37–D39). The slide-up
panels are the sanctioned Deck absorption: a `design/system` sheet re-expresses `DeckSheet`; no
new Deck adoption. Auto-end-on-impact ships as a disabled "coming soon" toggle —
detection is iceboxed.
**See:** ARCHIVE D61; `PROJECT_MAIN.md` §8.1/§8.6/§9.5/§9.6.

### Measurement is by closed loop, never by self-report

**Decision:** Anything claiming frame-exactness is measured by decoding an artifact, not by asking
an API what it did.
**Gotchas:** This project has already shipped a probe that reported a false PASS, and a second
that reported a false FAIL because the instrument was subtracting the decoder's lead. Three
successive decision entries were needed to converge. Scrubbing remains **unmeasured** — a seeked
frame is displayed on arrival so there is no lead on that path, and the instrument that was to
measure it was deleted with the harness. It belongs to `mobile-player`.
**See:** ARCHIVE D34, D35, D36, D44.

## Skeleton rendering

### The mobile skeleton drops the knuckle line; hands are read as wrist angle only

**Decision:** Do not draw the pinky-knuckle → index-knuckle line on mobile. Read the hands as the
**wrist angle** — the joint between `elbow → wrist` and `wrist → grip_center` — which is what the
knuckle line was standing in for and what a coach actually reads.
**Gotchas:** Those two keypoints come from RTMW's hand block, the least reliable part of the pose
at golf-swing distance; a hand spans a few dozen pixels down-the-line, so the knuckles sit inside
each other's noise. **The web player still draws it** — that divergence is deliberate.
**See:** ARCHIVE D22.

### Orientation overlays are rigid rods with no length floor

**Decision:** Extend the shoulder and hip bars by a **multiple of the projected span with no
floor**, and cap each end.
**Gotchas:** Down-the-line — which is every fixture — both pairs turn side-on through impact and
their projected span collapses (hips span 9px against an 882px body at impact). A length floor
makes the bar read as a label pinned over the body rather than an object attached to it, and
abstaining makes it vanish at exactly the moment a coach is looking hardest.
**Scope:** Applies to both players.
**See:** ARCHIVE D20.

### Navigation is React Navigation 7 native-stack, not Expo Router

**Decision:** `@react-navigation/native` + `@react-navigation/native-stack`, with the route map
typed once in `src/navigation.ts` and `AuthGate` wrapping the navigator so a screen added later is
behind sign-in by where it is rather than by being remembered.
**Gotchas:** Expo Router was chosen first and reversed on evidence — it peers on
`react-native-gesture-handler`, whose C++ codegen paths exceed the 260-character limit **inside
the Android SDK's bundled `ninja`** (not a Windows limit; long paths are already enabled here).
That package arrives in `node_modules` anyway as a peer of `@expo/cli`, so it is excluded from
autolinking in `apps/mobile/react-native.config.js` and `package.json`'s `expo.autolinking`.
**Scope:** Expo Router is a file-based layer over this same navigator, so adopting it later moves
where routes are declared and changes no screen. Delete the exclusion the day the app needs a
drawer or a swipeable row.
**See:** ARCHIVE D47.

### Images that need the session use `expo-image`, never React Native's `Image`

**Decision:** Any image behind an authenticated route goes through `expo-image` with a source from
`api.mediaSource()`. React Native's own `Image` accepts `headers` on its source and **silently does
not send them on Android**.
**Gotchas:** The failure renders as a blank thumbnail with no error and no `onError`. Worse, the
unauthenticated request is *answered* as the `DEV_USER_EMAIL` identity, so the route returns **404
rather than 401** and nothing points at authentication. `SwingCard.test.tsx` asserts the source
carries its `Authorization` header for exactly this reason.
**Scope:** `cachePolicy: "disk"` is not decoration — the thumb route serves the analyzer's
full-resolution `contact.jpg` (1–2 MB), so a ten-swing log is ~13 MB uncached. A server-side
thumbnail size belongs with the media pipeline.
**See:** ARCHIVE D48.

### The mobile overlay is rotated `View`s, and every stroke is a segment

**Decision:** Draw the skeleton, club, trace, orientation rods and angle arcs as absolutely
positioned, rotated React Native `View`s — one per line segment, positioned by its **midpoint**
because RN rotates about a view's centre. An arc is a short chord polyline; a dash is one view per
dash, not one per sample crossed.
**Gotchas:** The number of segments IS the cost of a frame, so two render-time reductions carry the
trace: the already-smoothed curve is simplified with Ramer–Douglas–Peucker at **0.6 stage pixels**
(both endpoints preserved exactly — the head of the line has to land on the playhead), and dashing
is a *saving* rather than a surcharge. Measured over all ten fixtures at a 360pt stage: **59–61
views for the skeleton alone, peak 461 total at impact on `pro_3` (400 of them trace).** The
translucent wedge behind each angle arc is dropped — a wedge is not expressible as rectangles.
**Scope:** The silhouette, isolation scrim and butt line are **not** portable this way: the scrim
needs `Path2D` + even-odd fill to put its holes back, which is why the analyzer stores rings with
no outer/hole distinction. They stay web-only until something else draws them.
**See:** ARCHIVE D23, D36.

### The mobile trace draws in one style: bulge width, aquaDeep shades, silk joins

**Decision:** The club-head trace renders as a single-hue teal gradient (near-black teal at
address → bright aqua at the strike, `traceColorAt` in `traceStyles.ts`), with width following a
Gaussian bulge centred just past mid-downswing (slim at address, fattest where the club is
fastest, slim again by impact), the path resampled to uniform ~3px strokes with capsule-extended
round joins ("silk"). Chosen by Taylor from live comparison rounds on real swings (styles ×
exaggerations × palettes × join treatments, mixed on-device through the debug menu); the losing
options were deleted the same day — git history holds the comparison harness.
**Gotchas:** Bridges still draw as dashed chords and the capsule extension is skipped on each
piece's terminal ends — the honesty rules survive the styling. `TRACE_COLOR` in the byte-locked
`skeleton.ts` twins now holds this gradient's endpoints so the scrub's phase bands and the menu
tiles stay visibly the same system as the drawn line. Uniform resampling means the trace's view
count is bounded by path length ÷ 3px, not by sample density.
**Scope:** Mobile only. The WEB player still draws the legacy two-colour phase trace (dashed
backswing / solid downswing, now in the teal endpoints) from the same artifact — a named
divergence pending a canvas port of the gradient style.

### The mobile overlay draws the transport's frame — except mid-drag, when it draws the picture's

**Decision:** The overlay paints `target ?? presented` — the seek target while a seek is
outstanding, the presented frame otherwise — and calls `markOverlayCommitted(frame)` in a layout
effect immediately after. **While a finger is on a scrub surface (`state.scrubbing`) it paints
`presented` instead**: the skeleton and the picture chase the thumb as one coherent scene, at
whatever rate the seek pipeline can land frames. A skeleton pinned to the finger over a picture
that cannot keep up reads as the overlay tearing off the video — dogfooded 2026-08-12, and the
tear was the whole perceived failure.
**Gotchas:** The two non-drag paths were measured and they differ. During playback JS learns about
a frame ~49 ms **before** it is displayed, so reacting to the frame event is comfortably in
budget. On a single seek there is **no lead at all** — the landing is displayed on arrival — so
target-drawing is what keeps a step from being one frame behind. Mid-drag commits are excluded
from the drift instrument natively (the overlay would be scoring the instrument against its own
output).
**Scope:** `markOverlayCommitted` is what makes the sync panel's `Overlay drift` a native
measurement scored on the playback thread rather than a JS self-report.
**See:** ARCHIVE D36.

### Scrubbing streams preemptible seeks under media3's scrubbing mode; the release lands exact

**Decision:** While a finger is down the transport bypasses its one-in-flight seek coalescer and
fires `seekToFrame` at most every 33 ms, with `ExoPlayer.setScrubbingModeEnabled(true)` letting
media3 preempt superseded seeks and skip per-seek pipeline teardown. Seek parameters stay
**EXACT** throughout. On release the final finger frame is re-issued through the normal coalesced
path, so the landing is frame-exact and measured. Drag seeks are excluded from the exactness
instrument — they are deliberately preemptible.
**Gotchas:** Three designs lost to this one on the same evening, on feel: (1) `CLOSEST_SYNC`
keyframe seeks — granular, read as "not live" even at a 10-frame GOP; (2) a jog/shuttle chase
driving `setPlaybackSpeed` toward the finger — read worse than seeking; (3) predictive lead
(velocity × pipeline latency) — masked latency but not the overlay/picture tear, which the
presented-frame overlay rule above actually fixed. The coalescer CANNOT serve a drag: its landing
detection is "a new frame rendered", and a preempted or same-position seek renders nothing, which
stalls it into its 1.5 s lost-seek timeout.
**Scope:** The clips' GOP is short (a keyframe every 10 frames — measured with ffprobe, not
assumed), so per-seek decode was never the bottleneck; pipeline overhead was. If a future device
still cannot keep up, the next lever is a pre-decoded frame cache (editor-style scrub stills),
not a faster seek loop.

### The mobile transport is bounded by `playback_window`, not by the file

**Decision:** Once `analysis.json` loads, seeking, stepping, the scrub bar and playback all clamp to
the analyzer's `playback_window`; the playhead parks at its start; playback stops at its end and
`play` at the end restarts from the beginning of the window. A swing with no artifact keeps the
file bound.
**Gotchas:** The window rarely starts at zero — swing1's opens at frame 90 of 396 — so `frames.ts`
takes an `Extent` (a `{first, last}` span, or a bare frame count meaning the whole file) rather than
a frame count. Anything that must reach frames outside the window passes the file extent
explicitly.
**Scope:** The window is a property of the *swing*, not the viewer, which is why the client reads it
rather than deriving one.

### `analysis.json` is duplicated into the mobile tree, not shared

**Decision:** `traceSmoothing.ts`, `playbackWindow.ts`, `skeleton.ts`, `clubVariants.ts` and
`model.ts` are **copied verbatim** from `apps/web/src/lib/` into
`apps/mobile/src/features/player/overlay/`, with their tests, and each carries a banner saying so.
`verbatimCopies.test.ts` byte-compares every pair on each mobile test run — the divergence
trigger below is now mechanically watched, not comment-enforced. `model.ts` (spans, trace
re-cut, orientation hold, club-solution selection) was unified 2026-08-12 on the mobile port's
semantics — the phase-ordering clamps, the `pts[i]` guard and per-field phase overrides are
defensive supersets with identical output on every well-formed artifact, and
`scripts/checkoverlay.ts` proves the shared code against the Gate 1 burn-in on all ten fixtures.
The web stage's memos are now thin wrappers over it.
**Gotchas:** This is knowingly-carried debt, not an oversight. The only workspace package a phone
build already resolves is `@swingsage/schema`; adding a second means Metro resolution config and a
native rebuild to move pure array math, on a tree that already had to be hoisted (D21) to build for
Android at all. **The trigger to un-duplicate is the third consumer, or the first time the two
copies are found to have diverged.**
**Scope:** Only files with no imports beyond a type. Anything that touches a renderer was
re-expressed instead.

### The mobile player draws the SELECTED club solution, not `primary`

**Decision:** `selectedClub(analysis)` applies `defaultClubVar` — the same choice the web player
makes — and the shaft, the head ring, the trace and any club-anchored angle all read that one
result. On these fixtures it resolves to `model_traj_moving`.
**Gotchas:** The first pass of the mobile port drew `analysis.club` directly. Nothing failed, no
test caught it, and the only symptom was a differently-shaped line over the same swing —
`scripts/checkoverlay.ts` is what found it, on its first real run. Switching solutions is a RENDER
change only: metrics, face and event refinement all read the primary block regardless.
**Scope:** It also changes the trace's cost materially — `pro_3`'s impact frame went to 400 trace
views. And it exposed a bug in `defaultClubVar` itself; see the entry below, which is the reason
`swing1` is the one fixture where the selection is still `primary`.

### Hand corrections merge on the phone, by frame, at render time

**Decision:** `useCorrections(swingId, view)` fetches `/stages` and `/markers` alongside the
analysis. A pinned boundary re-cuts where the trace changes colour; a placed club head replaces the
analyzer's point on its own frame, is inserted where it had none, re-aims the shaft, and draws its
ring green rather than rose.
**Gotchas:** Corrections are **not in `analysis.json` and must never be** — the artifact is
rewritten wholesale by every re-analysis, so one stored there is destroyed by the next run. Both
routes already existed and are access-checked; no server change. Everything is optional in both
directions: an uncorrected swing and a failed fetch both draw the analyzer's own answer, and there
is no error state, because a correction that cannot be loaded must never stop a swing being watched.
**Scope:** Stage NAMES are validated against the five-mark list rather than mapped. The oldest rows
in this database predate that model and still say `address` / `top` / `toe_up`; the web player
ignores them by only asking for names it knows, and dropping them keeps the two clients agreeing
about which corrections are live. Today that leaves exactly one in effect — `pro_2`'s `impact` at
143 against the analyzer's 140.

### The approved club solution is ungated, and a sparse trace is the correct output

**Decision:** `defaultClubVar` returns `model_traj_moving` — **trajectory-gated head + moving-average
trace**, drawn with **Savitzky-Golay** render smoothing — with no coverage condition. Chosen
2026-08-08 from an evaluation of 31 candidates, and it is a solve that evaluation *created*: the
artifact previously carried gated-head-with-measured-trace and moving-average-over-ungated-head,
never the combination. Legacy trace with no experiment selected.
**Gotchas:** It looks wrong on `swing1`, which draws almost no downswing where `primary` draws a
full arc — and that appearance was acted on once, on 2026-08-12, by gating the pick on measured
coverage. **That was the wrong call and is reverted.** `swing1`'s 24 downswing frames contain
**zero real uninterpolated detections in either solve**: `primary` draws 24 trace points through
them anyway, `model_traj_moving` draws 1. The prettier line is 24 fabricated positions, and falling
back to it would make the player assert measurements the detector never made. On `pro_2`, where 11
of 16 downswing frames are real detections, the approved solve draws 12 and the question does not
arise.
**Scope:** An empty stretch of trace is a **detector** result to fix upstream — `swing1`'s detector
answered 244/396 frames against 90%+ on the other nine — never a reason to change the pick.
Provenance for the pick is `burnin.py`'s `TRACE_MODES` and `club.py`'s `smooth_trace`, whose
`measured()` gate is what makes a trace refuse to draw through undetected frames in the first place.

### The Ideal Swing design system is the app's one visual language

**Decision (Taylor, 2026-08-14):** The app's theme and every page match the reference mockups in
`.claude/ideal-swing-design-system.html` **exactly** — that file is law for tokens, geometry, type,
components, and the scroll behaviours (the sheet sliding over the layer beneath it, the report's
video-open state, the pill nav hiding at the top). The build lives in the `design-system` track;
the reusable component layer is `src/design/system/` over rewritten `src/theme/` tokens, so future
pages are assembled from existing pieces, never designed ad hoc. This supersedes mobile-app-shell
step 03 (the deferred styling pass).
**The token layers:** `palette.ts` holds the mockup's hex values verbatim (ramps + per-theme
surface sets — the only file where a hex is born; it also holds the video-surface extras:
`VIDEO_AMBER`, the deck's `DECK_SHADES` neutral faces, and the aqua 300/600 cap stops);
`themes.ts` is the semantic `IdealTokens` set including the hero gradient stops, glass, and
per-theme `shadowSm/Md/Lg/Cobalt/Aqua` spreadable RN shadow styles. The legacy alias layer was
deleted in step 09 — `Theme` **is** `IdealTokens`, every screen reads these names and only
these, and the fixed-dark `COLORS` (player/capture surfaces) now derives every value from
`palette.ts` (`aqua`/`onAqua`/`lavender` keys; the old acid green, violet and salmon are gone
app-wide). Type lives in `src/design/system/typography.ts` (`FONT_DISPLAY`/
`FONT_BODY` weight maps + the six-step `TYPE` scale, em-tracking converted to absolute px); the
wordmark constant in `src/design/system/brand.ts`. Fonts load in `App.tsx` before the first frame
(splash holds; a font error degrades to the system face rather than holding the splash).
**Named deviations from pixel-exactness** (each deliberate, none silent): display type is **Sora**
+ **Inter** body, bundled via expo-font — Bahnschrift is Windows-licensed and cannot ship, and the
condensed stand-in (Barlow Semi Condensed) read as bulky and hard to scan on device, so the display
face is deliberately non-condensed: each `FONT_DISPLAY` key maps one weight lighter than its name
and display tracking sits near -2% (typography.ts holds the mapping and the why); **the mockup's
CSS leading does not survive the port** — Sora's line box is 1.26× its font size, and Android sizes
a text layer to an explicit `lineHeight` rather than to the font's metrics, so the mockup's ~1.05×
leading cut the tails off `p`, `g`, `y` and `q` with no overflow to catch. Every `FONT_DISPLAY`
style that sets `lineHeight` takes it from `displayLine(size)` (`typography.ts`), never a
hand-picked number; numerals-only and uppercase styles keep their tight leading because neither
can render a descender; glass surfaces
are near-opaque theme fills, not backdrop blur (`expo-blur` stays out
until a fill provably fails); conic-gradient score rings render as SVG arcs; and every
"Ideal Swing" string in the mockups renders as **SwingSage** — settled by the real logo Taylor
supplied (wordmark reads *Swingsage*; master lockup at
`apps/mobile/assets/brand/swingsage-logo.svg`: the ball on two swing-path arcs — one `#3fb0f5`
accent, one brand-ink `#1c0032` — with the ball carrying a radial highlight gradient under a
white dimple field, and an ink wordmark). The mockup's placeholder `.brandmark` square is
replaced by the logo's ball-and-swoosh mark wherever a brand lock appears. The mark's colours
are literal on every surface with one exception: the **ink-coloured swing path follows the
wordmark colour** (white on dark), because painted `BRAND_INK` it disappears into a dark
surface. The accent arc is a brand colour and never changes. Home's `ScreenHeader` carries the
lockup in place of a title.
**Patterns the mockup lacks (composed in step 09, now precedent):** the settings-style list is
`design/system/ListRow.tsx` — `ListGroup` (a `.panel` surface, radius 11, shadowSm) of
`ListRow`s where selection is the `surfaceBlue` fill + cobalt title (§12: cobalt = selected,
never a border) and pressed is a `surface2` fill, plus `ListSectionLabel` (the `.panel-head`
label face standing alone); the tab header is `design/system/AppHeader.tsx` — one persistent
floating bar on every tab: the `BrandLogo` lockup left, the cobalt more-circle (the profile
door) right. Screens keep their own display titles in their content/hero; the header never
carries a title. It floats over the screen (each tab pads its scroll by `APP_HEADER_BAR` + the
top inset) and is **transparent at every scroll position** — no ground of its own, the
screen's surface always shows through it.
**Consequences:** `lucide-react-native` (pure JS over the shipped `react-native-svg`) is the icon
source for system components, superseding drawn-View glyphs there — except where Taylor
supplies the art: supplied single-colour icons live in the **brand icon registry**
(`design/system/brandIconPaths.ts`, art data verbatim, named for meaning — `tempo`, not
`metronome`) and render through `BrandIcon` (bare glyph, caller's colour as fill — the Coach
tab) or `BrandIconThumb` (the glyph on StickThumb's exact bed — Progress category tiles,
where an `icon` on a priority/trend entry supersedes its placeholder stick figure). Adding an
icon is one registry entry; no new components; SVG's allowed scope widens to
`design/gauges` **and** `design/system`; `expo-linear-gradient` renders the hero/performance
gradients. Chrome (nav bars, player controls) may hide **only as a deterministic function of
scroll position** — the mockup's behaviour — never tap-to-hide and never on a timer; that amends
the earlier absolute no-hiding rule. On the tab screens the function is **scroll direction**
(Taylor 2026-08-17): a downward run hides both the `AppHeader` and the wave tab bar, an upward
run brings them back, and the top of a screen always shows them. The flip distance is
**15% of the window height** (`CHROME_RUN_FRACTION`) in either direction — a drag that small
is not intent, so an incidental touch never moves the chrome.
`useChromeScroll` (in `navVisibility.ts`) is the one sanctioned driver; its pure step function
carries a reversal anchor so finger jitter never strobes the bars. The `hidden` flag is global
— a tab switch requires a visible bar, so the next screen inherits shown chrome by
construction. The swing screen's own chrome (its `SessionNav` bar, the report controls) keeps
its separate scroll rule and does not ride this flag.
**The swing screen's ONE shape (Taylor 2026-08-17 — the legacy `SwingPlayer` surface and its
`afterSwing`/`checkpoint` route params are DELETED; two player types was tech debt. Extended
2026-08-19 — the standalone swing screen and the session's post-recording screen are ONE
component):** every door — log row, Home's focus cards and you-vs-pro strip, Coach's scorecard
link, and the session's post-recording state — renders the shared **`SwingPage`**
(`features/report/SwingPage.tsx`): the swing looping under the transport (lighter glass —
rgba 0.38, the controls sit ON the footage), the sheet's TAB — drag handle plus the first
sliver of scorecard, 96px above the bar, with a tiny muted "SWING ANALYSIS" nameplate in its
top-right corner and NO swipe-up hint — peeking over the bar, the score circle as the door.
The tab is the sheet's **floor** — scrolled fully to the top the card never sinks below it.
The entrance differs by host: standalone the sheet is simply THERE at page load
(`staticSheet`); the after-swing keeps the slide-up, where the card arriving IS the analysis
finishing. The transport's bottom pad uses the same capped inset as the bars
(`navBarBottomInset`). **Chrome is the only per-host variance**, through
`SwingPage`'s `menu` / `topRight` / `extras` slots (the bar renders as a sibling over the layer,
never `stickyFooter`): in session the bar is `SessionSwingDock`; standalone the page dresses as
an INTERIOR page (Taylor 2026-08-19) — the app's MAIN menu (`WaveNav`, no tab active, Record as
its standing centre door) worn STATICALLY (no scroll-hide; the route crossfades rather than
pushes so the bar reads as one static bar between pages), the standard `AppHeader` (hero ink,
pinned, hamburger → Profile) over the picture, star/delete as `CornerOrb`s in the video's
top-right orb stack pushed below the header, and NO back orb — the menu and header are the
navigation. **The video never parallaxes** — the report layer passes `cap: 0`; the picture is
fixed to the top and the sheet does all the moving. Session-only chrome (analyzing bar,
completion moment, error/list sheets) arrives through `extras`. A change to how a swing plays
or reads is made once, in `SwingPage`.
**Report stacking and doors:** the layer order is fixed at video < controls shell < sheet card —
the scaffold hosts `backdropOverlay` **inside** the scroll surface (counter-translated to stay
screen-fixed) so the card always paints over the chrome and the controls still take touches.
Every full-bleed page's way out is the **`FloatingBack` orb** pinned top-left over everything
(the report's sheet lost its in-card back — one back per region). Its top-right mirror in
video-open is the **layers orb** (lucide `Layers2`, same glass) — the overlays sheet's one
opener; the transport bar carries no overlays pill (Taylor 2026-08-17). The report sheet holds low
with `Skeleton` placeholders until the report is real, then slides up as its entrance
(`presented`), and a tap on the covered video (`onBackdropTap`) scrolls the sheet open, which is
also what starts playback.

### Deck — the control-surface system, and why controls have depth

**Decision:** Player controls are built from **Deck** (`src/design/deck/`): caps that sit at one of
three depths, panels that come up from the bottom (`DeckSheet`), and glyphs drawn from `View`s. One
rule governs everything — **light comes from directly above** — so a raised cap catches a highlight
on its top rim and casts a shadow below itself, and a cap pushed in inverts both. **Pause is the
play cap latched down**, not a second icon. Since step 09 Deck is re-tokened onto the Ideal Swing
palette (one colour source): its ground is the dark theme's `COLORS.bg`, its accent and primary
cap run the aqua ramp (`AQUA` 300–600), the neutral cap faces live in `palette.ts` as
`DECK_SHADES`, and the glass tints are navy.
**Gotchas:** §41's conditions are bright sunlight, one hand, a driving range, and flat design fails
all three at once: in glare a filled rectangle converges with its background and there is no shape
cue left. **Depth survives washout where colour does not**, and it gives state somewhere to live
that is not colour. `DeckButton` separates a *latched* state (`depressed`, the caller's) from a
*finger-down* state (its own) — conflating them would pop the pause cap back out the instant the
finger lifted, which is exactly when a golfer looks at it.
**Scope — what remains:** the report surfaces were absorbed by `design/system` (steps 06–07),
step 09 deleted the glyphs nothing uses, and the legacy `SwingPlayer` deletion (2026-08-17)
took the console/dock/summary consumers with it — Deck now serves only `DeckSheet` (the
report's tool sheets), `DeckButton`, and the glyphs those still draw. Full absorption lands
with **in-app-capture**; no NEW surface may adopt Deck.
Built on RN 0.86's `boxShadow` (multi-shadow, `inset`) and `experimental_backgroundImage`
gradients; an earlier React Native would have needed nine-patch images for the same effect.

### Surfaces are flat — no borders and no drop shadows, anywhere

**Decision (Taylor, 2026-08-14, extended 2026-08-18):** No visible borders and **no drop shadows**
in any mobile styling — no card outlines, no chip edges, no hairline dividers, no accent rings
around a selected control, and nothing casting onto the surface beneath it. Surfaces separate by
**fill, radius and spacing only**: a card is a filled rounded rectangle on the background, a
selected state is a background tint plus text colour, a divider is spacing, and elevation is the
`bg` → `bgElevated` → `surface` → `surface2` → `surface3` ramp rather than a shadow.

Both rules are enforced by **deletion of the tokens**, so neither can quietly return: the edge
tokens (`glass.hairline`, `hairlineStrong`, `keyEdge`, `COLORS.amberEdge`) went in 2026-08-14, and
`shadowSm` / `shadowMd` / `shadowLg` / `shadowCobalt` / `shadowAqua` — with the `ShadowStyle` type
— went in 2026-08-18. The `Theme` type no longer carries a shadow of any kind, so a surface that
wants one does not compile.

Deck (`src/design/deck/`) keeps its `boxShadow` arrays but they are now **inset only**: a raised
cap reads by the lit top rim and dark underside *inside* it, never by a shadow thrown below.
`DeckButton.test.tsx` asserts every entry is `inset`, which is the tripwire for the surface that
used to carry the most cast shadows.

**The reference mockup carries the rule too.** `.claude/ideal-swing-design-system.html` has its
five `--shadow-*` variables pinned to `none` in both themes and every literal cast shadow removed,
with the reason in a comment at the top of the file — a spec that still teaches shadows is how one
comes back. What survives there is `inset` shading and zero-offset spread rings (`0 0 0 4px <c>`),
which draw a shape rather than cast: the score orbit's rings, the timeline dot's collar, the focus
ring. The mockup still draws 1px `--line` borders it inherited from before the borderless rule;
the code does not, and the code is right.

The only `border*` styles that remain are ones that **draw a shape** — the `View`-drawn glyphs,
overlay keypoint rings, gauge dots, the scrub thumb's ring, and the tab bar's record button's
bg-coloured mask ring — none of which read as an outline.
**Gotchas:** A control whose only visual was its border or its shadow needs a fill when that goes
(StatusMessage's retry pill, the overlay angle chips, the frame-sync sweep button) — deleting the
edge alone leaves an invisible control. `Panel`'s `elevated` prop went with the
shadows — it only ever chose between two of them, and it had no call sites.

### Every tappable surface shows a pressed state, and it is always a fill

**Decision (Taylor, 2026-08-19):** Tap feedback is mandatory on every interactive element, and it
is drawn as a **fill, never opacity** — dimming reads as "disabled" and washes content out over
imagery. The shapes, by control kind:

- **Cards and rows** step up the surface ramp while pressed (`surface2` → `surface3`, `surface` →
  `surface2`) — plus a slight compression (`scale 0.98`, `Button`'s translateY idiom) where the
  ramp step alone is too subtle to read.
- **Sticky-bar items** (tab bar, session bar, pill dock) show **no pressed state at all** — a
  round grey bed was tried and cut (Taylor, 2026-08-19); the navigation happening is the
  feedback. The header's menu glyph keeps its `pressBed` circle — a round translucent-grey bed,
  deliberately translucent so it reads on any ground in both themes without joining the opaque
  surface ramp.
- **Imagery** (video thumbs, the floating back orb's glass) takes a dark shade **over** the
  picture — a surface swap has nothing to show through a photograph.
- **Selection controls** (`Segmented`, toggles, tab switches) need no extra pressed state — the
  selection moving *is* the feedback.

**Pressables inside anything that scrolls set `unstable_pressDelay` to `SCROLL_PRESS_DELAY_MS`**
(`design/system/press.ts`, 90 ms): `pressIn` fires the instant a finger lands and only then does
the ScrollView claim the gesture, so without the delay every scroll that starts on a card flashes
that card's pressed state. Fixed chrome keeps instant feedback — nothing competes for its gesture.

### The app is pinned light; the video surfaces are pinned dark

**Decision (Taylor, 2026-08-14):** The app is themed, light-first. `src/theme/` is three layers:
`palette.ts` (raw ramps — Taylor's blue scale #F0F3FA→#395886 plus one brand green; the only file
where a hex may be born), `themes.ts` (semantic tokens — `bg`/`panel`/`well`/`text`/`muted`/`dim`/
`accent`/`onAccent`/`accentSoft`/`violet`/`amber`/`danger` — bound once for LIGHT and once for
DARK, the `Theme` type forcing every token to exist in both), and `ThemeProvider`/`useTheme`/
`themedStyles` (how components read them — `themedStyles` caches one built sheet per theme, so a
themed component keeps a static sheet's render cost). Themed code never imports the palette and
never hand-mixes an rgba beside a token.
**Resolution (Taylor, 2026-08-18): there is none — the app is LIGHT, always.** `ThemeProvider`
consults neither `useColorScheme()` nor the stored preference, the Settings → Appearance control
is unmounted (`ThemeToggle` kept whole for re-mounting), and `userInterfaceStyle` is `light` in
`app.json` so the native side agrees (a native flag: it needs a clean prebuild to land on an
existing build). **The DARK theme and every dark token stay** — un-pinning is the `resolved` line
in `ThemeProvider` plus re-mounting the control, so nothing about dark may be deleted or allowed
to rot. `FixedDarkTheme` is unaffected: the video surfaces are dark because of what they are, not
because of a theme choice.
**The accent is one green with two exposures:** deep `#2A7F4F` on light surfaces (white text on
it), the original acid `#A3E635` on dark ones — same brand, contrast-matched to the ground.
**What stays dark in both themes:** capture (pinned via `FixedDarkTheme`) and the report's
video-open chrome, plus anything drawn **over a photograph or video frame** (Home's hero and
swing slides, compare chips, thumbnail grounds) — footage is its own dark surface, and those
layers use the fixed `COLORS` palette and the accent's acid exposure deliberately. **The Pro
card** (`features/billing/ProCard.tsx`) joins them: it is the product's single upgrade sell, and
a card that flips to white on the light theme stops being an accent and becomes another row. It
reads `palette` directly — the `INK` ramp, named there rather than hand-mixed — and gets its
depth from an ink gradient plus two off-canvas radial washes, never a border or a cast shadow.
**The sticky navigation bars are the ONE exception, and they escape the pin on purpose** (Taylor,
2026-08-18): every bar in the app is the same bar, so session mode's `SessionNav` wears the home
tab bar's light fill over footage rather than being a second, darker nav. `useAppTheme()` is the
only sanctioned escape hatch — it returns the app's surface ignoring any `FixedDarkTheme` above,
and `SessionNav` and `SessionRecordButton` are its only callers. The light fill is **pure
`#FFFFFF`, not the old near-opaque 0.98** — at 0.98 the footage and the page underneath ghosted
through, so the two bars read as slightly different whites over different grounds. Nothing else escapes the pin;
content over footage still uses the fixed palette, which is what the pin is for. The fade ABOVE
each bar was already the same dark ramp in both themes, so only the bar itself changed.
**Gotchas:** shared themed components rendered inside the player (the trend line) get their dark
tokens from the pin, not from luck — an unpinned video surface would paint light panels over the
picture the moment the app went light.

### The picture is the page; everything else floats over it or comes up from the bottom

**Decision:** `SwingDetail` sets `headerShown: false` and the ordinary swing screen does not
scroll. The picture sits at the analysed frame's aspect with its **top edge flush with the top of
the screen** — never centred with a bar of ground above it — with the back control and the swing's
name laid over the top (no score chip: the score lives in the summary and the scorecard) and the
timeline and dock over the bottom. The swing's numbers, the overlay switches and the development
instrument live in **panels that come up from the bottom edge** (`DeckSheet`), never below the
picture. **The chrome never hides** — no tap-to-hide, no auto-hide, no hover states: this is a
phone, and a control that can vanish is a control a golfer has to know how to summon. Playback
starts on load, looping, at 1×.
**Gotchas:** Park-then-play is **one effect, not three**. The artifact arrives after the video does
and narrows the transport to `playback_window`, so a play issued on `ready` alone is cut off a
moment later by the seek that follows it. The effect waits for `analysisState` to leave `loading`,
which also covers the swing that has no artifact — it settles on `not-analysed` and playback still
starts. The stage's box is fitted **in JS, not by Yoga's `aspectRatio`**: Yoga honours the aspect
only while one axis is free, and a clip taller than the screen pins both — silently producing a box
that is not the artifact's shape, which is the one thing the normalized overlay cannot survive.
The stage placeholder is the swing's own `/thumb` (disk-cached by the log's cards, so usually
up in the first layout pass) with a quiet spinner at the top — the video replaces its own poster
in place, and nobody watches a black box.
**Scope:** Looping defaults ON because a swing is about a second and a half; a player that stops
dead at the finish makes a golfer press play for every look at the same two frames. Speeds are 1×,
½×, ¼×, ⅒× and are applied natively (`setPlaybackSpeed`) — a JS timer would drop frames and show a
quarter of the swing while calling it slow motion.

### `DeckSheet` — one panel primitive, built on `Modal`

**Decision:** Secondary content on a screen whose primary content fills the viewport lives in a
`DeckSheet`: a panel that slides up from the bottom edge over everything else. It is a React Native
`Modal` (`transparent`, `statusBarTranslucent`, `animationType="none"`), animating itself, with
drag on `PanResponder`. It has **two detents**: it opens half-height, drags up to full, drags back
down to half, and drags down again to close. **Closed means unmounted** — the caller passes plain
boolean state and the sheet outlives `visible` only long enough to slide away.
**Slide-ins are app surfaces, and they open FULLY** (Taylor, 2026-08-18). Every `Sheet` — including
one opened from the pinned-dark capture screen — paints the app theme and reads like the swing
log's sheet, never the dark glass of a control over footage. The primitive enforces it: its own
chrome is built from `useAppTheme()` (which ignores any pin above it) and its children are wrapped
in `AppTheme`, so a sheet author cannot get it wrong by forgetting. Sheet CONTENT therefore uses
**`appStyles`/`useAppTheme`, NOT `themedStyles`/`useTheme`** — the provider is not enough on its
own, because a sheet component calls its style hook in *its own body*, which runs where the sheet
is **used** (inside the pinned-dark capture screen), not where its children are **rendered**
(inside the provider). Context flows down the tree and a parent is not below its own child. The
symptom reads as something else entirely: the panel paints white correctly while its text stays
dark-theme white, so the content looks blank rather than mis-themed. `appStyles` resolves the app
surface directly and cannot be defeated by where it is called. The fixed `COLORS` palette is never
right in a sheet; the only exceptions are colours that
are **functional rather than a surface** — `COLORS.onAqua` for text on an aqua fill, and the QR
card's white, which is white in both themes because a QR does not scan on anything else.
**`restHeightFraction` is now opt-in, and that is what fixed "there is no padding at the bottom".**
A second detent parks the panel translated DOWN by `height - rest`, which puts its bottom padding
— and its last control — below the screen edge. Adding padding therefore appeared to do nothing
three times running: the padding existed, off screen. The panel is already capped at
`maxHeightFraction` and scrolls inside, so opening at its natural height is the honest default and
a low rest detent is something a genuinely long list asks for by name.

**A Modal opens its own window, and that window is not edge-to-edge unless you say so.** The sheet
sets **both** `statusBarTranslucent` and `navigationBarTranslucent` — `navigationBarTranslucent`
is ignored unless the status-bar one is also set. Without them Android lays the sheet's window out
*inside* the system bars, with two visible symptoms that look unrelated: the navigation-bar strip
under the panel paints the platform default (white) instead of the sheet, so the app appears to
stop short of the bottom of the screen; and `useSafeAreaInsets()` inside the sheet reports
`bottom: 0`, so the panel's `16 + insets.bottom` pad collapses and the last control sits on the
gesture bar. Found 2026-08-18 by Taylor, once as "why is the bottom white" and once as "it
interferes with the phone's native interface" — the same missing prop both times.
**Gotchas:** `Modal` rather than an absolutely-positioned view for three things that are each
annoying by hand: the Android **hardware back button** (`onRequestClose` is the only supported
hook), escaping the player's stack of absolutely-positioned chrome layers, and covering the status
bar so a tall sheet is a page rather than a panel with video peeking over it. `animationType="slide"`
is not used because it cannot be interrupted and gives no way to couple the backdrop — here the
backdrop's opacity is **derived from the panel's position**, so half a drag is half a backdrop.
A sheet that stayed mounted while hidden would keep its controls in the accessibility tree. The
detents are computed from the content: a short panel has one height and simply closes on a downward
drag, because offering an expand that reveals nothing is a gesture that appears broken. A release
snaps to whichever detent the throw was *aimed* at — the position is projected forward by the fling
velocity first — or a fast flick that has travelled 20pt springs back and the sheet feels stuck.
**Scope:** Gesture handling is `PanResponder` from React Native itself —
`react-native-gesture-handler` is excluded from autolinking (D47) and this is one axis with one
decision at the end of it. Glass is translucent fills, **not `expo-blur`**: real backdrop blur is a
native module, and every design change would then cost a fresh dev-client install on the device.

**The header's scroll offset is PER SCREEN; the tab bar's flag is global.** Every screen keeps its own scroll position, so a shared offset holds whatever screen moved last — returning to a screen left scrolled drew its header over its own content, and arriving at one resting at the top could leave the header hidden (Taylor, 2026-08-18). `useChromeScroll` therefore returns `{ onScroll, chromePx }` and each screen hands its own `chromePx` to its own `AppHeader`. Resetting scroll position on navigation would have hidden the same bug at the cost of losing the golfer's place, so it was not done. The tab bar's `hidden` stays global: it is one bar for the whole shell.

**The two bars move on different models** (Taylor, 2026-08-18). The TAB BAR latches: its `hidden` flag flips once a run of 15% of the window height reads as intent, then it animates — it is a tap target, and one that flickers under the thumb is worse than one that lags. The TOP BAR takes **two inputs and obeys whichever hides it more**. A latch is the driver: once the screen is `SLIDE_AFTER_BAR_HEIGHTS` (1.2x the bar's own height) past the top, the bar animates fully out, so it is only ever all the way in or all the way out, never parked half on screen. Under that buffer it has not committed — the bar is still there, merely pushed by the content — so a short drag that settles again costs nothing. `chromePx` (the raw scroll offset, at a slight 1.15x parallax) is a floor under that slide: if the content gets ahead of the animation — a fling the JS scroll callback cannot keep up with, or just the first frames of the slide — the push has already carried the bar clear, so it cannot be drawn over. The floor alone would leave the bar partly visible, which is why it is a floor and not the driver. **The latch's two thresholds differ on purpose:** it engages once the screen is past that buffer, but releases only while returning UP and already within one bar-height of the top — so the bar stays gone however you drag mid-page, and the last stretch of the return is the content carrying it back down rather than a second animation. It lives in `AppHeader` rather than the provider because both thresholds are the bar's own height. `Animated` has no `max`, so the two inputs are summed and clamped to that height: a clamped sum is never less than either, and overshoot is off screen and free. Being locked to the content is also why the bar needs no ground of its own. The buffer is measured in bar-heights rather than as a fraction of the window because it is about this bar — "let the content push it most of the way off before committing" is a fixed relationship to the bar's height, and a window fraction gave phones with different status-bar insets different behaviour for no reason.

**A hero's sheet edge is derived from its content, not tuned.** `backdropHeight` was a hand-picked constant per screen (330 on the log, 424 on Progress) with no relationship to what the hero actually held, so the gap between the hero's content and the sheet's top edge was whatever fell out of two independently chosen numbers — and it fell out different (Taylor, 2026-08-18). Hero screens now measure their hero with `onLayout` and set `backdropHeight = heroHeight + overlap + HERO_SHEET_GAP`, so the sheet lands the same distance below the content on every hero screen and keeps doing so when the content changes. The old constant stays as the pre-measurement fallback so the first frame does not jump.

**A parallaxed backdrop overscans upward** (Taylor, 2026-08-18). Sinking is exactly what uncovers a backdrop's own top edge: at full parallax the old `absoluteFill` layer had translated `cap` px down and the screen's ground showed as a bar across the top. `SheetOverBackdrop`'s layer now extends `parallax.cap` above the screen and paints an `overscan` colour there, and `HeroBackdrop` takes an `overscan` of its own — negative margin plus equal padding, so the painted ground grows upward while its children stay put, and the corner glow has somewhere to bleed instead of being cropped flat by `overflow: hidden`. The two numbers must agree, so the hero preset lives once as `HERO_PARALLAX` rather than being copied into both screens. A backdrop that is not a `HeroBackdrop` (the report's video) names its own overscan colour instead.

### Where you are is a NAME and a hairline bar, not a strip of thumbnails

**Decision:** The transport's readout says `Downswing · 184` — the phase the playhead is in, and
the frame — with the elapsed and total time opposite it. Under that sits a **6pt** phase bar, the
five phases drawn at their true durations and tappable to seek, then the scrub track. The playhead
is a plain line with no frame badge.
**Gotchas:** This replaced a real filmstrip. The analyzer grew a `filmstrip.jpg` artifact, a route
served it and the scrubber drew twelve clean frames — and the whole chain was reverted, because a
strip of thumbnails costs an artifact, a request, a decode and forty points of a golfer's screen to
answer a question one line of text answers *better*. What the bar keeps is the part a name cannot
give you: proportion. Nothing in the group is padded, gapped or inset — gaps are taken out of a row
before flex divides what is left, so four 4pt gaps would push every phase boundary up to 16pt away
from the frame it marks, and the playhead would cross a boundary at a visibly different moment from
the picture. `useSeekSurface` is the single copy of the x↔frame arithmetic the bar and the scrub
track both read.
**Scope:** WITHIN the swing the bar stays drawn to scale — backswing against downswing **is
tempo**, which is the whole reason the bar earns any height. The analyzer's padding is not swing:
setup and run-out are **compressed to `PADDING_SCRUB_WEIGHT` (0.3) of their true width** so the
swing owns most of the bar's travel, which also lowers frames-per-pixel through the part a golfer
actually studies. `scrubMap` (phaseBands.ts) is the ONE weighted x↔frame mapping — the strip's
flex widths, the fill, the playhead and `useSeekSurface`'s touch arithmetic all read it; a second
copy of that mapping is how a tap and a drawn boundary stop agreeing. `git show f05eaee` has the
filmstrip if it is ever wanted back — the artifact, the route and `refilmstrip.py` all went with
it rather than being left as surface with no consumer.

### Compare puts timing and scores side by side, never geometry

**Decision:** The compare panel picks a reference swing — split into *reference swings* (those
carrying `referenceLabel`) and *my swings* — and then shows the two against each other on score,
tempo and **phase durations in seconds**.
**Gotchas:** Two swings filmed on two days from two distances have normalized coordinates that mean
different things, so drawing one golfer's trace over another's would be a picture the pipeline
cannot justify — this project's rule against fabricating a measurement, applied to a comparison.
Durations are in **seconds, not frames**: the clips need not share a frame rate, and "24 frames vs
31" is meaningless across 60fps and 120fps. There is no seeded catalogue of pros, so the reference
tab is honest about being whatever reference swings actually exist rather than showing an empty tab
that looks broken.
**Scope:** The chosen reference shows as a chip on the picture, not only inside the panel — a
comparison you have forgotten you set quietly changes what the numbers underneath mean. Side-by-side
*playback* is dual-view's, and is not what this is.

### The overlay switches are tiles that draw what they turn on

**Decision:** Each overlay is a square tile carrying a **miniature of its actual mark** —
`OverlayPreview` draws a stick figure, two orientation rods, a shaft and head, a dashed-then-solid
trace — in the overlay's own colours, straight from `TRACE_COLOR` and `ANGLE_COLORS`.
**Gotchas:** A preview painted in its own palette would be a picture of a different feature. Angles
stay a chip row rather than becoming tiles: there are dozens of fields and every one draws the same
*kind* of mark, so forty previews of an arc would be forty identical pictures — the row gets one
tile to say what an angle looks like, and the chips choose which.
**Scope:** A group the artifact cannot support is still hidden, never disabled.

### Three speeds, no loop button, no frame stepper

**Decision:** The speed control is three rates — `1x` · `0.5x` · `0.1x` — and nothing else.
Looping is permanently on and has no control. There is no frame-stepper overlay and no speed
picker sheet. One skin carries it (the legacy dock died with `SwingPlayer`, 2026-08-17): the
report's video-open player bar draws the three rates as the mockup's **pill group**
(`.report-v2-speed`, slowest first) beside its aqua play cap and the **Compare** pill
(`ReportPlayerBar`; the overlays opener is the top layers orb).
**Gotchas:** Three speeds, not four — a quarter sat between two rates that already do their jobs
(half is "the whole shape, slower", a tenth is for the transition, which is over in about four
frames) and made each segment narrow enough to mis-tap. Labels are plain decimals: a `¼` glyph is a
font risk on Android for no gain. The pill's position is `index × SEGMENT` with a fixed segment
width, so there is no layout pass and no first-render frame with the pill in the wrong place, and it
animates on `translateX` under the native driver so it never touches the JS thread the overlay draws
on. Removing the loop button removed the only place its behaviour was observable, so
`useFramePlayer.test.ts` now carries it — default on, restart-at-window-start without pausing,
stop-at-end when off.
**Scope:** Speed is still applied natively (`setPlaybackSpeed`) — a JS timer would drop frames and
show a tenth of the swing while calling it slow motion.

### One player: the legacy SwingPlayer surface is deleted

**Decision (Taylor 2026-08-17):** The app has **one player** — the report
(`ReportVideoLayer` + `ReportSheet` on the `SheetOverBackdrop` scaffold). The legacy
`SwingPlayer` surface (the card-over-fixed-video screen with `SummaryCover`,
`AfterSwingSummary`, `AfterSwingDock`, `PlayerConsole`, `AnalysisPanel`, `PhaseStrip`,
`ScrubBar`, `FrameSyncPanel`, `checkpointFrames`, `useSummaryPreference`) is **deleted**, with
its tests, its `afterSwing`/`checkpoint` route params, the log's dev preview door, and the
Settings "lead with the scorecard" toggle. Two player types was tech debt; every door opens
the report. `fitBox` (stage sizing) moved to `player/frames.ts`; the overlay engine, frame
clock, `ComparePanel`, `ReferencePane` and `OverlayControls` were always shared and stay.
**Named deferrals, not descopes:** (1) **checkpoint parking** — Home's "see it on your swing"
opened the old player parked at the priority's P-code; the report player does not park yet, so
the door opens the report plainly until it learns a `checkpoint` param. (2) The **after-swing
session chrome** (record-another dock, score history strip) returns as part of
**in-app-capture**, built on the report player. (3) The **frame-sync oracle** (`FrameSyncPanel`)
died with the surface and must be rebuilt inside the report player's `__DEV__` chrome before
the next hot-path perf claim — until then there is no drift measurement on the phone.
The cover-scroll gotchas the old screen measured (box-none ScrollViews never pan on Android;
snap on `onMomentumScrollEnd`, not `onScrollEndDrag`) remain true and archived in git history.
**Scope:** Delete still confirms in the client (`Alert`, destructive) on the report's dock; the
**star stays device-local** (`useStarred`) until the contract's additive field lands (D41).

### The meters are SVG, and gauges outlive any one screen

**Decision:** `design/gauges` (`ArcGauge`, `RingGauge`, `TrendLine`) is the SVG meter module —
drawn with `react-native-svg`, animated JS-side (`useNativeDriver: false` — SVG props are not
native-animatable), once on cold surfaces, never on the 60 Hz path. Its first consumer
(`AfterSwingSummary`, the SAMPLE-afterswing rendering) was deleted with the legacy player
(2026-08-17); the module stays because score meters outlive any player — the report, session
summaries and goals want the same faces. The ring's `null` progress draws the track alone: the
abstaining shape, distinct from zero.
**Gotchas:** D23 stands untouched: the overlay stays on plain `View`s (that was a measurement).

### The swing log is a sheet of sessions, and the row is "Swing N" · date · score

**Decision:** The log groups swings into practice **sessions** (`sessionize`): the newest as the
featured card (`LatestSessionCard`), the rest as flat rows below. The hero carries the WHOLE
log's overview (Taylor 2026-08-17): session + swing counts and the all-swings average in the
`ScoreRing` — never the latest session's own numbers, which live in the card right below
(`logStats` in `sessions.ts`). **Averages are circles, swings are muted:** every session
average renders in the circle face (`ScoreOrb` size 56 with the `Avg` caption — the rect
avg-boxes are gone), and the per-swing scores in the timeline render `ScoreOrb muted` (muted
ring, soft number) so the session's average stays the prominent number. A session's title IS
its date
— "Sunday, Aug 9th" (`DateTitle`, the ordinal suffix small and raised; Taylor 2026-08-17, which
retired the derived "Morning/Afternoon/Evening Practice" names) with the start time alone
beneath (the weekday moved into the title) — never a swing count (the timeline below the latest
card *is* the count) and never a golfer-typed title (`swing.label` is machine-minted; nobody
names swings). A swing row is **"Swing N"** (numbered in
hit order), its date · time, and its score orb — the thumbnails are near-identical frames of the
same person on the same mat, so they carry no per-row information; one still on the session
header says where you were. The latest card carries no LATEST pill and no tinted wrap — its
position at the top already says it (Taylor 2026-08-17, declutter pass). The sheet rests at the
backdrop's edge on first paint (`initialOffset` 0) so the hero is fully visible on load.
**Gotchas:** A session is **inferred from time** — swings ≤ 2 h apart — because the contract
carries no session id yet and no capture flow mints session rows. When it does, the contract
grows `sessionId` (additive, D41) and `sessions.ts` switches to it; the screens never see the
difference. `createdAt` is normalized (seconds vs ms differ silently by 50 years) in one place.
An unscored swing reads "not scored" and is absent from `best`, never a zero.

### Home leads with the next session's focus, and the focus is aggregated, not copied

**Decision:** The home tab is built for "what should I do next time out?", written over the
golfer's own footage rather than laid out as a dashboard (Taylor, 2026-08-13: "it's too
boring"). The **hero** is a full-bleed photo of the newest swing whose report ranked the focus
priority (its thumbnail under layered scrims — no gradient dependency), with a by-name greeting
("Hey Taylor — next time out"), the recurring priority, its newest cue, the provenance line, the
drill as a chip, and one promise of a button: **"See it on your swing"**, which opens the
exemplar swing's report (one player, 2026-08-17; parking at the priority's checkpoint is the
named deferral in the one-player entry). The remaining recurring priorities are
a horizontal **rail** of cards with the same door each. Between hero and rail sits the
**you-vs-pro strip**: the exemplar swing and the newest bundled reference swing frozen side by
side at the tip's checkpoint (both stills from `/frame?checkpoint=`, resolved through each
artifact's own checkpoint table — compare by position, never by frame or time), with the cue
overlaid; it renders only when a ready reference swing exists and the tip carries a checkpoint,
and removes itself if either still fails — half a comparison is not a comparison. The **last
session** is a header (date,
counts, best/avg, delta chip vs the previous session's average) over a horizontal **slider of
swing cards** — thumbnail, number, score, band; the best carries the acid edge; each opens its
swing. The aggregation (`homeModel.aggregateFocus`) ranks by **recurrence first, mean leverage
second** — a fault flagged on four of six swings outranks a one-off with a bigger leverage
number — and tracks the exemplar swing + checkpoint per priority. Reports are fetched by
`useSessionReports` (newest ≤ 8 scored swings, `{swingId, report}` pairs) into a module cache
keyed by swing id, cleared on sign-out like the list cache. When the newest session is still
inside the session gap, the same layout reads as *today* ("focus right now"). The cross-session
trend lives on Progress, not Home.
**Gotchas:** Every section abstains rather than fakes: no scored reports → no focus card, no
scores → no numbers (never a zero), an unreachable report is excluded from the aggregation and
left uncached so a later mount retries — while a list-level network failure still renders as
"cannot reach", never as an empty home. "Based on goals" waits for the personalization system
(roadmap D54); until goals exist the recommendation is measured recurrence only. When focus
goals ship (§16.3, D55, track `goal-progression`), active goal cards replace this card as the
primary home surface and recurrence stays as the no-goals fallback.

### The shell is a tab bar with Record raised in the middle; the profile slides in from the avatar

**Decision:** The app's persistent navigation is a bottom tab bar (`@react-navigation/bottom-tabs`
with the custom `design/TabBar`): Home and the swing log left, Progress and Coach right, and
**Record** as a raised acid circle in the centre. Record is a **door, not a tab** — it opens the
capture surface (`RecordScreen`, a full-screen modal that holds the filming checklist until the
capture release fills it in) without changing which tab is current. Everything that must own the
whole screen — the player, capture, the profile pages — lives on the root stack ABOVE the tab
navigator and covers the bar by construction; the swing screen keeps its own navigation because
of where it sits, never because a flag hid a bar. Every tab draws the shared `design/TopBar`
(screen name left, the golfer's avatar right — Google photo when the session metadata carries
one, else the address's initial). The header's profile control opens **Profile**, which is a
**drawer sliding in from the right over the tab that opened it** (Taylor's design, 2026-08-18),
not a pushed page: a route with `presentation: "transparentModal"` and `animation: "none"`, so
the screen underneath stays visible behind a dimmed scrim while `design/system/SideDrawer` runs
the slide itself. The panel takes 86 % of the width, floats clear of the safe area top and
bottom, and rounds only its left corners because it stays flush to the right edge. It closes
three ways — the X, a tap on the dimmed strip, or a drag to the right — and a row **closes
before it navigates**, so coming back from Settings lands on the tab rather than on a drawer
left hanging open. Contents, in Taylor's order: identity, the coach block (the connected coach
card over the local-directory card, whose CTA is the Coach tab), then the menu — My profile,
Lesson history, Notifications, Settings, Privacy, Help — then Appearance and Sign out. **Settings
and Notifications have screens behind them** (Notifications opens the §29 inbox drawer, not a
preferences screen — preferences do not exist yet); the other four are drawn as designed and
inert until their screens exist, which `ProfileScreen.test.tsx` pins so that wiring one is a
deliberate edit. The
connected-coach state reads `useConnectedCoach`, which is sample data under `__DEV__` and null
in release until the coach platform lands. The design's navy/white button pair maps to
`cobalt`/`surface`, because a navy fill on the dark theme's navy card is an invisible button.
Settings owns
the real preferences — Appearance and **Delete account**, which moved off the log's footer to
its planned home (the after-swing "lead with the scorecard" toggle died with the legacy
player). Progress is the
long view (all-time best, typical tempo as a median over ≥3 swings, counts, session-average
trend); Coach and Goals are honest placeholders with real doors, not dead buttons. `AccountBar`
is deleted; sign-out lives in Profile.
The wave bar **floats over the content rather than taking layout space**, with a gradient fade above it, so content dissolves behind it instead of stopping at a hard edge (Taylor, 2026-08-18). The fade is **the same dark ramp in both themes** (`#0B1528`, 0 -> full), not a theme-following one: a white fade over the light theme's near-white `bg` is invisible, and only the transparent end is ever on screen anyway — the solid end sits behind the bar. That is not decoration: `BottomTabView` lays its tabBar out as the last flex child of a column, so a bar that hides by translating away leaves its reserved height behind as a blank strip. `TabBar` hosts it in a zero-height view, `WaveNav`'s root is absolutely positioned, and the fade rides inside the animated group so it leaves with the bar. The root box is sized to include the fade rather than letting it overflow upward — Android does not honour `overflow: visible` reliably, and a gradient drawn past the container's edge simply did not render — which also makes the root `pointerEvents="box-none"`, or the transparent band would eat every touch in it. Tab screens clear `WAVE_NAV_CLEARANCE` at the bottom of their own scroll, because nothing reserves it for them any more.
Each tab is a **21px glyph in a 24px box over a drawn 7/900 label** (Taylor, 2026-08-18 — the labels used to exist only on `accessibilityLabel`), the centre slot is 86px wide, and the raised section under Record is 126x96 with a 158x26 blend back into the bar. The active colour is cobalt on light and **aqua on dark**, which is the one place the nav's active voice is not the app's primary.
**The bottom inset under a sticky bar is CAPPED at 10px** (`navBarBottomInset` in `WaveNav`, Taylor 2026-08-19): padding the full system inset under the item row made the bar an enormous blank band on phones with on-screen nav buttons. The row sits at most 10px + `ROW_PAD` above the screen's edge and the fill still runs to the bottom behind the system bar. `WaveNav`, `SessionNav`, and everything that clears them (the swing page's tip lift, the analyzing pill) all go through the one function.
**Session mode's bar is the same bar, down to the geometry** (Taylor, 2026-08-18). `SessionNav`
had a deliberately larger bump and record control — "the one control that must dominate the
screen" — and it read as a different navigation system. Its `RISE`, `BLEND`, `RECORD_SLOT` and
record lift are now `WaveNav`'s numbers verbatim, and `SessionRecordButton` is `RecordButton`'s
compact 58px geometry in red with a label. Changing one bar's constants without the other is what
makes them stop matching, so they are written to be compared side by side.
**Gotchas:** Tab glyphs are drawn `View`s in `design/deck/Glyphs.tsx` — no icon font, no SVG
outside `design/gauges`. From a root-stack screen a tab is reached as
`navigate("Tabs", { screen })`; a bare `navigate("Progress")` searches upward and fails at
runtime while typechecking fine — the profile tests pin the nested form. The `Navigation` type
is a composite of both param lists for exactly this reason. The dev-client bubble owns the
top-right corner in development builds, so the avatar steps 56 px left under `__DEV__` only.

### One app-wide toaster behind one queue — celebrations and alerts are its clients

**Decision:** Transient top-of-screen moments all flow through the generic toast system
(`apps/mobile/src/features/toast/`): `ToastProvider` + `useToast()` own the queue
(one at a time, extras wait, duplicate ids dropped), `ToastCard` is the surface — slides down
under the top inset, full width inside the app's 16pt content gutters, themed on the elevated
surface (light by default), opaque, slide-only (no fade), tap runs the toast's optional
`onPress` deep link then dismisses. A toast may carry an eyebrow, a detail line, a right-side
chip, and `confetti: true` for the one-shot burst. **Systems speak through adapters that own
their voice:** the achievements layer's `useCelebrate()`
(`features/achievements/CelebrationProvider.tsx`) maps a `Celebration` to a toast — kind-fixed
eyebrow, XP chip, confetti always on — and the notifications track's alerts point here too
rather than growing a second toaster. Never the bottom sheet system. Animation is core
`Animated` on the native driver — reanimated is not a dependency and a toast does not justify
the APK weight.
**Gotchas:** `ToastProvider` mounts in `App.tsx` above the navigator (a toast lands on
whatever screen is up); `CelebrationProvider` sits inside it and below `DebugProvider` (it
contributes the debug sheet's "Celebrations" group). In `ToastCard`, the host must NOT set
`alignItems` (the animated wrapper shrink-wraps and the card's stretch has nothing to fill)
and the card must use `alignSelf: "stretch"`, never `width: "100%"` (Yoga resolves percentages
against the parent's full width, padding included — the full-bleed bug). The focus-goal
celebration (§16.3.5) is a bigger, separate moment owned by `goal-progression` — it outranks
toasts. Award logic and persistence are server-side; nothing on the phone decides that
something was earned.
**See:** ARCHIVE D62; `.claude/feature-tracks/achievements/DESIGN.md`.

### Onboarding is a saved-per-tap question sequence, and state decides when it opens

**Decision:** Onboarding (`features/onboarding/`) is §4.4 + §5.4 as one full-screen question at
a time — role → handedness → style → handicap. Handedness is the only unskippable step;
every other question has Skip in the corner. **Every answer PATCHes the profile the moment it
is tapped** — the profile row is the draft, so backing out loses nothing and "resumable" needs
no extra state. Every step advances itself on the tap (no Continue under a tapped card).
Finishing stamps `completeOnboarding`.
`OnboardingLauncher` auto-opens the flow **once per app launch** while
`onboardingCompletedAt` is null — the check is "is onboarding complete", never "did signup
just happen", so a killed app resumes into it — and contributes the debug menu's
"Run onboarding" action, which reopens the same flow prefilled at any time. Role taps claim
via `POST /api/v1/roles` (idempotent, fire-and-forget).

### The profile is six answers — one page, one registry, no goals

**Decision:** The product asks a golfer exactly SIX things (Taylor, 2026-08-20, after three
iterations): **handedness, swing style, handicap, age, driver speed, 7-iron carry**. My profile
is one page — an identity card (tap to edit name + region) over a two-column grid of six value
tiles; `features/profile/profileFields.ts` is the asking surface and the screen renders
whatever it says. **Goals are not profile data** — they belong to the guidance features
(focus/goal system), and the profile's goal machinery (`GoalPicker`, the Goals screen, the
`golfer_goals` table, the D54 cap trigger, the wire fields) was removed outright. Everything
else ever considered (§5.5's misses, shot shape, grip/fitting/launch-monitor, climate/altitude,
height/wingspan/wrist-to-floor, mobility screen, skill level, average score, practice life,
coach status, coaching style, feedback depth) was removed from product, API, shared contract
AND database together (migrations 0014/0015) — what the product stops asking it stops storing.
`profileFields.test.ts` pins the six; `profileRls.test.ts` pins the table's exact columns.
Re-adding a field is an additive migration plus one registry entry. `FieldEditorSheet` is the
one editor (choice rows / hold-to-repeat number stepper). Choices save-and-close on the tap; a
second tap on the current value clears it ("actually, don't score me on that" stays
expressible). Writes go through `saveProfile` — optimistic against the module cache, reconciled
from the server's response, reverted with one toast on failure. Onboarding asks role →
handedness → style → handicap (handedness the only unskippable step); the other two profile
answers live on the profile screen, not in signup's way.

### Capture mirrors for a left-handed golfer — the art and the rails both

**Decision:** Profile handedness (default right until loaded) drives every capture surface
that shows the golfer themself, via `useHandedness()`. `PoseOutline` takes `mirrored` and
`posePlacement` reflects its composition about the artboard centre, so the alignment ghost,
the view-switcher icons, the dual-sync pip and the analysis-error "aim for this" reference all
show a lefty their own setup in the mirrored spot. The session screen's rails swap sides with
it: zoom + camera flip + the view switcher move to the RIGHT edge for a lefty, and the Dual
View column takes the left. This is the UI half of the handedness rule — analysis geometry
still arrives pre-resolved from the analyzer and is never computed on the phone.

## Data and networking

### Server state draws stale-while-revalidate; every request times out; media auth re-resolves

**Decision:** The swing list keeps a module-level cache of the last server-confirmed response:
a mount seeds from it synchronously and revalidates in the background, which is what lets the
detail screen open a swing without a serial list refetch ahead of the video/analysis requests.
The cache never decides truth — a 401 clears it, sign-out clears it (auth boundary), and a failed
revalidate keeps drawing the confirmed list rather than a network-error screen about data the
device has. Every `ApiClient.request` carries a default **12 s AbortController timeout** (RN's
OkHttp ships none) mapped to a typed `timeout` error that renders as `unreachable`; fetch hooks
pass abort signals so a popped screen stops downloading and parsing. One override: the
`analysis.json` fetch (`useAnalysis`) runs at **30 s** — the artifact is the largest payload the
app moves and the 12 s default was measured losing to it on the LAN dev server, which made the
overlay "sometimes" work per screen. Captured media credentials
(`useAuthenticatedImage`, the player's video source) re-resolve on `TOKEN_REFRESHED`/`SIGNED_IN`,
because a `{uri, headers}` pair is a captured token and the media route answers a dead one 404,
not 401 (D48). Playback pauses on AppState leaving `active` and resumes on return if it was
playing.
**Gotchas:** `clearSwingsCache()` is the auth-boundary/test seam — never a per-screen
convenience. The native header-only re-apply in `frame-clock` is what keeps a token rotation
from restarting playback; without it the refreshed headers prop re-prepares the source.

## Standards

### `.claude/rules/react-native.md` is the mobile client's binding rulebook

**Decision:** Mechanical standards for all mobile code — hot-path render discipline, the
`analysis.json` contract on the phone, lifecycle/cleanup, CNG-only native config, accessibility,
testing — live in `.claude/rules/react-native.md`, path-scoped to `apps/mobile/**` like the
project's other rules files. Produced by the 2026-08-12 performance review
(`.claude/audits/mobile-rn-perf-2026-08-12/` — findings and the phased fix plan). This register
holds decisions; the rules file holds mechanics; where they overlap, the register wins.
**Gotchas:** Hot-path changes are **measurement-gated**: the frame-sync oracle's overlayDrift
and view-count numbers on the S25+ decide, not inference (`FrameSyncPanel` died with the legacy
player, 2026-08-17 — the oracle must be rebuilt in the report player's `__DEV__` chrome before
the next hot-path claim) — the review's Phase 7 items
(`useSyncExternalStore` for the frame value, transform-based primitive positioning, React
Compiler adoption) are explicitly *experiments to measure*, not backlog. Re-litigating D23
(plain-View overlay) without fresh numbers is the named anti-pattern.
**See:** ARCHIVE D23, D36, D40.

### The picture's box is sized from the swing list, and never resizes

**Decision:** the player layer (`ReportVideoLayer`) takes an `aspectRatio` prop, resolved by
the screen from `SwingViewSummary`'s `width / height` — data the swing log already holds before
the detail screen mounts. The stage box is therefore correct on the first frame of layout. A placeholder holds that
box, with a loader, until a frame has actually reached the glass, then fades out over it.
**Gotchas:** The stage used to default to **16:9**, so a portrait clip loaded squat and jumped to
full height the moment the artifact landed — shoving the analysis below it down the screen while it
was being read. A portrait default would not have fixed it either: the ten fixtures are 1080x1722
through 1080x2146, so eight of them would still shift. The placeholder is keyed on a new
`painted` flag rather than on `presented`, because **0 is a real frame** — the one every clip starts
on — and a placeholder keyed on the frame number leaves before there is anything to see.
**Scope:** The artifact still wins once loaded, because the overlay's coordinates are normalized
against it and a stage at any other aspect would letterbox the picture and put the skeleton beside
the golfer. The two agree because both are written from the same probe: the prop is not a guess the
artifact later corrects, it is the artifact's own number, sooner. A view analysed before those
columns existed carries nulls and falls through to portrait.

### A lesson replays by re-driving the player, never by playing a screen recording

**Decision:** A coach video lesson is captured as a `lesson.json` event log (transport
ops, strokes normalized 0–1 to the video rect, highlight/clear/overlay events — all
timestamped) plus one AAC audio track, and replayed by re-driving the player: the audio
clock is the master, transport events use each platform's own seek rule (the D40
arithmetic), strokes reveal progressively, and video re-syncs to the audio clock at every
transport boundary so drift cannot accumulate. Replay state at any t is a pure function of
events ≤ t — which is what makes the lesson itself scrubbable. Lesson strokes are
timeline-anchored and ephemeral; §26.2 static annotations are frame-anchored and
persistent — the two share the `packages/annotations` drawing toolset and nothing else.
**Gotchas:** Replay fidelity is the product risk: the pure `state_at(t)` oracle is
unit-tested, and the server-side burn-in render (sharing-and-export) doubles as the
combined reference gate. Freeform stroke rendering is a second consumer for the open D51
Skia question — take that reading before the track starts. Audio-session config (record
mic while playing video) is known platform work, flagged for the track's first step.
**See:** ARCHIVE D60; `PROJECT_MAIN.md` §26.4;
`.claude/architecture/coach-video-lessons-2026-08-18.md`.

### "Coach" means the AI; the human professional is an "Instructor"

**Decision:** In all user-facing copy, product-wide, **Coach** refers exclusively to the AI
coach — the Coach tab, coach notes, coach priorities are all the AI persona. The human
professional is an **Instructor**: "find a local instructor", "your instructor", instructor
chat. The Coach tab is strictly the AI coach while the instructor system is designed.
**Scope:** user-facing strings only — mobile today, web when its golfer/instructor surfaces
are built. Internal identifiers do not rename: `coach_links`, the `coach` role, `coach_report`,
`/api/v1/coach/*`, and the coach-platform track/phase names all keep their spelling; renaming a
live RLS-bearing schema for vocabulary is churn without user value. PROJECT_MAIN still says
"coach" for the human role in its §23–§29 sections — read those as "instructor".

### Instructor presence is one flag driving three surfaces

**Decision:** whether the golfer has a connected instructor is a single store
(`features/instructor/useInstructor.ts`), and it drives all instructor presence: the
instructor bubble (a face disc floating bottom-right above the wave nav on the Coach tab,
with a notification dot when there is something new), the profile drawer's instructor block
(connected card vs "find a local instructor" directory card), and the placeholder
Instructor/InstructorChat stack routes. Until the instructor platform lands the flag is a
`__DEV__` debug toggle (DebugOverlay group "Instructor"), persisted across reloads; release
resolves to no instructor.
**See:** `.claude/feature-tracks/coach-surface/DESIGN-coach-surface.md` §2.

### The guided stance analysis is the first AI coaching act

**Decision:** the first AI-coach interaction after a golfer's first recorded swing is the
guided stance analysis: a standardized draw→hold→clear beat sequence over two still frames
(DTL, then face-on when supplied) with a voice track — shaft-line-to-belt-buckle first, then
spine/knee angles, arm drape, a free observation, then the face-on beats. It is highlighted
on home until dismissed. The UI ships first as a scripted stub (narration text, pose art
stand-ins); the analysis itself stays deterministic-CV-first when wired — the AI narrates
what the geometry found, never invents the geometry.
**See:** `.claude/feature-tracks/coach-surface/DESIGN-coach-surface.md` §3.

### Progress renders the pinned sample, placeholder numbers flagged at the seam

**Decision:** the Progress page follows `.claude/SAMPLE-progress-page.html` exactly,
including the Before/Now focus bars, per-category deltas, hero description and confidence
chip. During the UI-stub phase those coaching numbers are canned values living only in the
flagged placeholder block of `features/progress/viewModel.ts` — the single swap point
`priority-engine`/`goal-progression` replace. Real aggregates (session counts, best, net
gain) stay real and absent-when-unmeasured.
**Scope:** amends the earlier no-canned-numbers rendering on this screen — Taylor chose the
pixel-exact sample for the stub phase (2026-08-19); honesty returns with the engines.

### The bell is header chrome; the inbox is a drawer that acks what it showed

**Decision:** §29's read surface is a badged bell in `AppHeader`, left of the profile door on
every tab, opening `NotificationsScreen` — a right-side `SideDrawer`, the same surface class as
Profile because both are reached from the persistent header. `AppHeader` takes the bell as a
`bell?: ReactNode` **slot**, not a callback: the count comes from a feature store and the design
system stays a leaf that owns placement, never knowledge. One module-scope store
(`useNotifications.ts`) with a single in-flight GET backs both surfaces, so four mounted bells
cannot hold four different counts. Opening the drawer acks the unread rows it showed in ONE
batch — never per row-tap — and takes the server's returned `unreadCount` as truth rather than
decrementing locally; rows keep their unread dots for that viewing by rendering against
"what was unread at open". Freshness is mount + app-foreground + open, with **no poller** —
push (step 05) is the answer to "tell me immediately". A failed ack is silent; a failed list
degrades to the last confirmed inbox, and `unreachable`/`signed-out`/empty are three distinct
screens because "nothing arrived" is a claim about the golfer's coach.
**Gotchas:** the taxonomy→glyph map is `Record<Notification["kind"], …>` on purpose — a kind
added to the contract enum must be a compile error, not a row that renders blank. Nothing emits
into the table yet, so every state is reachable only through the `__DEV__` "Notifications" debug
group.
**See:** `.claude/feature-tracks/notifications/02 - The Bell and the Inbox.md`;
`docs/decisions/platform-data.md` (the backbone).
