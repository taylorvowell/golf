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
