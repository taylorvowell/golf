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
**Named deviations from pixel-exactness** (each deliberate, none silent): display type is **Barlow
Semi Condensed** + **Inter** body, bundled via expo-font — Bahnschrift is Windows-licensed and
cannot ship; glass surfaces are near-opaque theme fills, not backdrop blur (`expo-blur` stays out
until a fill provably fails); conic-gradient score rings render as SVG arcs; and every
"Ideal Swing" string in the mockups renders as **SwingSage** — settled by the real logo Taylor
supplied (wordmark reads *Swingsage*; master lockup at
`apps/mobile/assets/brand/swingsage-logo.svg`: green→cyan gradient swooshes, a charcoal
`#282828` disc plate behind the white ball, charcoal wordmark). The mockup's placeholder
`.brandmark` square is replaced by the logo's ball-and-swoosh mark wherever a brand lock
appears. The mark's colours are literal on every surface — the disc plate is what keeps the
white ball readable on light — and only the wordmark takes a colour via `BrandLogo` (white on
dark, brand charcoal on light). Home's `ScreenHeader` carries the lockup in place of a title.
**Patterns the mockup lacks (composed in step 09, now precedent):** the settings-style list is
`design/system/ListRow.tsx` — `ListGroup` (a `.panel` surface, radius 11, shadowSm) of
`ListRow`s where selection is the `surfaceBlue` fill + cobalt title (§12: cobalt = selected,
never a border) and pressed is a `surface2` fill, plus `ListSectionLabel` (the `.panel-head`
label face standing alone); the light-ground tab header is `design/system/ScreenHeader.tsx` —
the hero screens' top-row idiom (brand eyebrow + display title, or the `BrandLogo` lockup on
Home) with the cobalt more-circle as the profile door on every tab.
**Consequences:** `lucide-react-native` (pure JS over the shipped `react-native-svg`) is the icon
source for system components, superseding drawn-View glyphs there; SVG's allowed scope widens to
`design/gauges` **and** `design/system`; `expo-linear-gradient` renders the hero/performance
gradients. Chrome (nav bars, player controls) may hide **only as a deterministic function of
scroll position** — the mockup's behaviour — never tap-to-hide and never on a timer; that amends
the earlier absolute no-hiding rule.
**The swing screen's shapes (design-system step 06):** opening a swing from the log (review) is
the **report sheet** on the `SheetOverBackdrop` scaffold and follows the **ambient theme**; the
after-swing (`afterSwing`) and checkpoint deep-link shapes keep the `SwingPlayer` surface,
pinned dark. The report's backdrop is the swing's still frame until the live player joins it as
the video layer (step 07). The report's dock ships Back / Delete / Favorite / Latest — "End
session" waits for practice-loop's session entity.
**Report stacking and doors:** the layer order is fixed at video < controls shell < sheet card —
the scaffold hosts `backdropOverlay` **inside** the scroll surface (counter-translated to stay
screen-fixed) so the card always paints over the chrome and the controls still take touches.
Every full-bleed page's way out is the **`FloatingBack` orb** pinned top-left over everything
(the report's sheet lost its in-card back — one back per region). The report sheet holds low
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
**Scope — what remains after the design-system track:** the report surfaces were absorbed by
`design/system` (steps 06–07), and step 09 deleted the glyphs nothing uses (`PersonGlyph`,
`HouseGlyph`, `RowsGlyph`). Deck still serves the `SwingPlayer` after-swing/checkpoint surface
(console, dock, sheets, remaining glyphs) and will be absorbed when **in-app-capture** rebuilds
the capture/after-swing screens — that absorption is named future work, not this track's. No NEW
surface may adopt Deck.
Built on RN 0.86's `boxShadow` (multi-shadow, `inset`) and `experimental_backgroundImage`
gradients; an earlier React Native would have needed nine-patch images for the same effect.

### Surfaces are flat — no borders, anywhere

**Decision (Taylor, 2026-08-14):** No visible borders in any mobile styling — no card outlines, no
chip edges, no hairline dividers, no accent rings around a selected control. Surfaces separate by
**fill and shadow only**: a card is a filled rounded rectangle on the background, a selected state
is a background tint plus text colour, a divider is spacing. The deck's edge tokens
(`glass.hairline`, `hairlineStrong`, `keyEdge`) and `COLORS.amberEdge` were deleted so a border
cannot quietly return through a token. The only `border*` styles that remain are ones that **draw a
shape** — the `View`-drawn glyphs, overlay keypoint rings, gauge dots, the scrub thumb's ring, and
the tab bar's record button's bg-coloured mask ring — none of which read as an outline.
**Gotchas:** A control whose only visual was its border needs a fill when the border goes
(StatusMessage's retry pill, the overlay angle chips, the frame-sync sweep button) — deleting the
border alone leaves an invisible control.

### Light is the default; dark is a choice; the video surfaces ignore both

**Decision (Taylor, 2026-08-14):** The app is themed, light-first. `src/theme/` is three layers:
`palette.ts` (raw ramps — Taylor's blue scale #F0F3FA→#395886 plus one brand green; the only file
where a hex may be born), `themes.ts` (semantic tokens — `bg`/`panel`/`well`/`text`/`muted`/`dim`/
`accent`/`onAccent`/`accentSoft`/`violet`/`amber`/`danger` — bound once for LIGHT and once for
DARK, the `Theme` type forcing every token to exist in both), and `ThemeProvider`/`useTheme`/
`themedStyles` (how components read them — `themedStyles` caches one built sheet per theme, so a
themed component keeps a static sheet's render cost). Themed code never imports the palette and
never hand-mixes an rgba beside a token.
**Resolution:** a persisted `system | light | dark` preference (Settings → Appearance, default
`system`), where `system` follows `useColorScheme()` and anything unknown resolves **light** —
dark renders only when chosen or when the phone itself is dark. `userInterfaceStyle` is
`automatic` in `app.json` (a native flag: builds made before it need a clean prebuild before
"match my phone" can see a light OS).
**The accent is one green with two exposures:** deep `#2A7F4F` on light surfaces (white text on
it), the original acid `#A3E635` on dark ones — same brand, contrast-matched to the ground.
**What stays dark in both themes:** the player, capture, and the after-swing surfaces (pinned via
`FixedDarkTheme`), plus anything drawn **over a photograph or video frame** (Home's hero and
swing slides, compare chips, thumbnail grounds) — footage is its own dark surface, and those
layers use the fixed `COLORS` palette and the accent's acid exposure deliberately.
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
picker sheet. Two skins carry it: the after-swing/checkpoint player's dock keeps the **segmented
slider** (the lit pill sliding between segments, play cap centred, **Metrics** and **Analysis**
to the right), and the Ideal Swing report's video-open player bar draws the same three rates as
the mockup's **pill group** (`.report-v2-speed`, slowest first) beside its aqua play cap and the
**Overlays**/**Compare** pills (`ReportPlayerBar`).
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

### Every swing is a card over a fixed video; a just-recorded one adds the session chrome

**Decision:** `SwingPlayer` takes `mode: "review" | "session"` (review is the default; the
`SwingDetail` route's `afterSwing?: boolean` param maps to session). The screen is a **fixed
video that never moves with the scorecard card riding over it** (`SummaryCover`): the card is
always on screen at one of two detents — up over the picture, or parked at a ~46pt bottom peek
with the whole video exposed — and is draggable from anywhere on itself or the glass. The card
is a full-screen `ScrollView` whose content is a transparent spacer plus the card, so the drag
IS a native scroll; release inside the travel zone snaps by drag direction (down parks, up
opens), and past the open detent the same gesture reads on through the card — one continuous
scroll, no inner scroll view. Open heights: session rides high, leaving about an inch of video
(the swing just happened; the card is the subject); review opens at **half the viewport** (an
old swing was opened to be looked at). Sliding the card down starts playback; pulling it up
interrupts nothing; a scorecard row slides it down *without* playing and lands paused on the
frame it names. The report is fetched from mount in both modes.
Because the cover's scroll surface takes every touch, **all tappable controls are layered above
it**: the chrome (back, title, opener toggle), the transport console — pinned above the card's
peek and rendered only while the card is down (its surface is covered when the card is up, like
the overlay/compare chips, which hide the same way) — and the session dock. The dock mirrors
the card: expanded while the card is up, folded to its tab while the video is the subject.
What separates the modes is the session chrome only: the dock (record / star / delete / play),
the stats/video opener preference (review always opens with the card; there is no preference to
consult), and the open height. Review therefore has **no delete affordance** — delete lives in
the session dock only. If review-mode swings later need their own card sections or actions,
that is a `mode` prop on `AfterSwingSummary` / a second footer in the dock's slot — a local
change, not a new screen. The capture flow will navigate here with `afterSwing: true`; until
then the swing log carries a quiet "Preview the after-swing screen" header row.
Which face a session screen opens with is the golfer's setting: the **opener toggle** (video ▸ /
stats ▥) top-right in the chrome, stats-first by default, device-persisted
(`useSummaryPreference`, the same account-sync seam as the star). Flipping to video-first while
the card is up slides it down immediately — the setting looks like what it does — and video-first
entry **plays without waiting for the analysis artifact**: only a parked start needs the window,
and holding the replay hostage to a megabytes fetch is the wrong trade (the loop clamps into the
window when it lands).
**Gotchas (each measured on the emulator):** a `ScrollView` with `pointerEvents="box-none"`
never starts a pan on Android, even from touches on its children — hence the layer-above-it
design rather than pass-through. A release with velocity must NOT snap at `onScrollEndDrag`
(the snap fights the native fling and the card rests mid-zone); the fling's own
`onMomentumScrollEnd` snaps instead, and a fling that clamps at an edge still reconciles the
detent bookkeeping. The initial placement re-runs on `onContentSizeChange` until the first
touch — a `scrollTo` issued before the scroll view has content clamps to zero and parks the
card closed on a screen that asked for it open. A JS `PanResponder` still cannot take a
vertical pull from a native `ScrollView` (the original measurement stands), and
`react-native-gesture-handler` stays excluded (D47) — the cover needs neither.
**Scope:** Delete confirms in the client (`Alert`, destructive, names what is lost) and the screen
above does the deleting and the leaving. The record cap says plainly that capture has not shipped
yet. The **star is device-local** (`useStarred`, one AsyncStorage key) — the contract has no
`starred` field yet, and that hook is the single seam to rewire when the additive field lands (D41).

### The summary wears the designed skin, and the meters are SVG

**Decision:** `AfterSwingSummary` is the mobile rendering of **`.claude/SAMPLE-afterswing.html`**
— the one screen with a finished visual design, followed closely on purpose: headline, the
violet→cyan arc gauge with the marker at the score, band chip, "last 5 swings" delta, tempo (in
the slot the mock's ArcShift™ held — tempo is real, ArcShift is not), coach takeaway, trend
polyline, two-tone finding boxes, and an indicator rail of score rings. Every number on it is a
measured field; a section with no data is not rendered. The meters are **`design/gauges`** —
`ArcGauge` and `RingGauge`, drawn with **`react-native-svg`** and animated (band draw-in, marker
sweep, count-up on one clock; ring fill by stroke-dashoffset).
**Gotchas:** `react-native-svg` is the app's first SVG runtime and `design/gauges` is **the one
place allowed to import it**. D23 stands untouched: the overlay stays on plain `View`s (that was
a measurement), and the transport glyphs stay drawn. The gauge animations are JS-driven
(`useNativeDriver: false` — SVG props are not native-animatable) and run once on cold surfaces,
never on the 60 Hz path. Sample geometry (viewBox 360×220, r 140, strokes 34/22) and gradient
stops are kept verbatim so the skinning pass has one source of truth.
**Scope:** Gauges are a design-system module because score meters outlive the player — session
summaries and goals want the same faces. The ring's `null` progress draws the track alone: the
abstaining shape, distinct from zero.

### The swing log is an accordion of sessions, and the row is number · time · score

**Decision:** The log groups swings into practice **sessions** (`sessionize`) rendered as
accordion cards (`SessionCard`), newest session expanded. The row leads with the swing's number
in the session, its time, and its score — the thumbnails are near-identical frames of the same
person on the same mat, so they carry no per-row information; one still on the session header
says where you were. The session's best score is acid in the header and on its row, so "which
one was the good one" is answered with the card open or closed.
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
drill as a chip, and one promise of a button: **"See it on your swing"**, which opens the player
on that exemplar swing **parked at the priority's checkpoint** (`SwingDetail`'s `checkpoint`
param → `SwingPlayer.initialCheckpoint`: skips the arrival slide-up, waits for the artifact,
seeks the P-code's frame via `checkpointTarget`, paused). The remaining recurring priorities are
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
one, else the address's initial). The avatar opens **Profile** (`slide_from_right`): identity,
Find a coach (→ Coach tab), Swing stats (→ Progress tab), Goals, Settings, Log out. Settings owns
the real preferences — the after-swing "lead with the scorecard" toggle (`useSummaryPreference`)
and **Delete account**, which moved off the log's footer to its planned home. Progress is the
long view (all-time best, typical tempo as a median over ≥3 swings, counts, session-average
trend); Coach and Goals are honest placeholders with real doors, not dead buttons. `AccountBar`
is deleted; sign-out lives in Profile.
**Gotchas:** Tab glyphs are drawn `View`s in `design/deck/Glyphs.tsx` — no icon font, no SVG
outside `design/gauges`. From a root-stack screen a tab is reached as
`navigate("Tabs", { screen })`; a bare `navigate("Progress")` searches upward and fails at
runtime while typechecking fine — the profile tests pin the nested form. The `Navigation` type
is a composite of both param lists for exactly this reason. The dev-client bubble owns the
top-right corner in development builds, so the avatar steps 56 px left under `__DEV__` only.

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
**Gotchas:** Hot-path changes are **measurement-gated**: the FrameSyncPanel's overlayDrift and
view-count numbers on the S25+ decide, not inference — the review's Phase 7 items
(`useSyncExternalStore` for the frame value, transform-based primitive positioning, React
Compiler adoption) are explicitly *experiments to measure*, not backlog. Re-litigating D23
(plain-View overlay) without fresh numbers is the named anti-pattern.
**See:** ARCHIVE D23, D36, D40.

### The picture's box is sized from the swing list, and never resizes

**Decision:** `SwingPlayer` takes an `aspectRatio` prop, resolved by the screen from
`SwingViewSummary`'s `width / height` — data the swing log already holds before the detail screen
mounts. The stage box is therefore correct on the first frame of layout. A placeholder holds that
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
