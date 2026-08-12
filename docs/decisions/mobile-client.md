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

### Two local Expo modules are load-bearing; `high-speed-camera` has no consumer in the tree

**Decision:** `modules/frame-clock` and `modules/high-speed-camera` are permanent, not spike
leftovers. They were the step 02 spike's actual deliverable. `frame-clock` gained its consumer with
the player (below); `high-speed-camera` still has none and **will read as dead code to any sweep.**
Do not delete it.

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

### The overlay stays in TypeScript

**Decision:** Do not draw the overlay natively. Plain rotated `View`s drawing 49 keypoints reach
99.2% frame-lock, and removing React state from the paint path scored no better (99.0%). Skia is
unnecessary. Rejected on cost, not on merit.
**See:** ARCHIVE D23, D36.

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

### The mobile overlay draws the transport's frame, not the presented frame

**Decision:** The overlay paints `target ?? presented` — the seek target while a seek is
outstanding, the presented frame otherwise — and calls `markOverlayCommitted(frame)` in a layout
effect immediately after.
**Gotchas:** The two paths were measured and they differ. During playback JS learns about a frame
~49 ms **before** it is displayed, so reacting to the frame event is comfortably in budget. On a
seek there is **no lead at all** — a seeked frame is displayed essentially on arrival — so an
overlay that waited for the event would always be a frame behind while scrubbing, which is the one
interaction where a golfer is studying a position.
**Scope:** `markOverlayCommitted` is what makes the sync panel's `Overlay drift` a native
measurement scored on the playback thread rather than a JS self-report.
**See:** ARCHIVE D36.

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

**Decision:** `traceSmoothing.ts`, `playbackWindow.ts` and `skeleton.ts` are **copied verbatim**
from `apps/web/src/lib/` into `apps/mobile/src/features/player/overlay/`, with their tests, and each
carries a banner saying so.
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

### Deck — the control-surface system, and why controls have depth

**Decision:** Player controls are built from **Deck** (`src/design/deck/`): a slab, and caps that sit
at one of three depths on it. One rule governs everything — **light comes from directly above** — so
a raised cap catches a highlight on its top rim and casts a shadow below itself, and a cap pushed in
inverts both. **Pause is the play cap latched down**, not a second icon.
**Gotchas:** §41's conditions are bright sunlight, one hand, a driving range, and flat design fails
all three at once: in glare a filled rectangle converges with its background and there is no shape
cue left. **Depth survives washout where colour does not**, and it gives state somewhere to live
that is not colour. `DeckButton` separates a *latched* state (`depressed`, the caller's) from a
*finger-down* state (its own) — conflating them would pop the pause cap back out the instant the
finger lifted, which is exactly when a golfer looks at it.
**Scope:** This is a control-surface system, **not the app's design system**. Type scale, spacing
rhythm, iconography and the §41 contrast bar are `mobile-app-shell` step 03, which absorbs this
folder rather than colliding with it — Deck layers on `theme.ts`'s tokens instead of restating them.
Built on RN 0.86's `boxShadow` (multi-shadow, `inset`) and `experimental_backgroundImage`
gradients; an earlier React Native would have needed nine-patch images for the same effect.

### The swing screen has no header, and its transport is pinned

**Decision:** `SwingDetail` sets `headerShown: false`. The picture is full width at the top of the
screen at the analysed frame's aspect ratio, with the back control and the swing's name laid over
it. The console is pinned to the bottom of the window while any part of the picture is on screen and
slides out of the way once it has been scrolled past. **Touching any control scrolls the picture
back to the top first.** Playback starts on load, looping, at 1×.
**Gotchas:** Park-then-play is **one effect, not three**. The artifact arrives after the video does
and narrows the transport to `playback_window`, so a play issued on `ready` alone is cut off a
moment later by the seek that follows it. The effect waits for `analysisState` to leave `loading`,
which also covers the swing that has no artifact — it settles on `not-analysed` and playback still
starts. The console **slides rather than unmounting**: unmounting would drop the speed and loop the
golfer had chosen.
**Scope:** Looping defaults ON because a swing is about a second and a half; a player that stops
dead at the finish makes a golfer press play for every look at the same two frames. Speeds are 1×,
½×, ¼×, ⅒× and are applied natively (`setPlaybackSpeed`) — a JS timer would drop frames and show a
quarter of the swing while calling it slow motion.
