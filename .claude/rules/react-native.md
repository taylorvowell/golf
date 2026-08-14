---
paths:
  - "apps/mobile/**"
---

# React Native Rules (mobile client)

Standing rules for anyone — human or AI — writing mobile code. Born from the 2026-08-12
performance/architecture review (`.claude/audits/mobile-rn-perf-2026-08-12/`); binding until
edited. `docs/decisions/mobile-client.md` holds the *decisions* (what we chose); this file holds
the *mechanics* (how code must be written so those decisions keep holding). Where they overlap,
the register wins.

## Measure, don't argue

- **The FrameSyncPanel is the oracle for anything touching the player's hot path.** overlayDrift
  p50/p95/max, trace view count, Run-250-seeks — read them on the S25+ before and after. A perf
  claim without those numbers is an opinion. Measured device truth lives in
  `docs/CURRENT-STATE.md` §11b; update it when you take a new measurement.
- **Do not memoize, restructure state, or adopt a renderer on inference.** D23 rejected Skia *on a
  measurement* (99.2 % lock with plain Views); reversing it, or reaching for
  `useSyncExternalStore`/transform-based positioning, requires the drift numbers to say so first.
- **Capability is probed at runtime, never assumed.** The S25+ is a flagship; nothing measured on
  it transfers to mid-range silently. Never silently degrade a capture/playback rate.

## The 60 Hz hot path

The frame value updates up to 60×/s. Everything it touches is hot; everything else must not ride
along.

- **Per-frame-read state lives in refs, not state** (`boundsRef`/`playingRef` idiom in
  `useFramePlayer`). Any callback in `actions` that closes over per-frame state churns the whole
  object's identity at 60 Hz and defeats every memo downstream — read refs instead.
- **Mirror refs are written in effects, never in the render body.** The web twin documents why
  (`usePlayer.ts`); concurrent React can discard a render whose ref write already leaked to the
  native callback.
- **Memo boundaries take primitives, not objects.** A component that only needs `frame` takes
  `frame: number` — never the whole `state` object, whose identity changes every frame.
- **Split per-artifact from per-frame work.** Whole-clip passes (trace building, keypoint index,
  orientation tracks, club selection) are memoized on `[analysis]` and computed once; the
  per-frame path is cut + simplify of the moving piece only. Never recompute a fully-revealed
  trace piece per frame; never let a memo depend on `frame` when the branch doesn't read it.
- **Element identity is a tool.** Content rendered inside a per-frame-rendering parent (sheet
  contents, panels) is hoisted into a `useMemo`'d element or passed as `children` from a cold
  parent, so React bails on the subtree. The metrics sheet is the reference pattern.
- **Never re-register the native frame callback mid-playback.** `onFrameRendered`'s identity must
  survive window narrowing, play state, and looping changes — that is what the refs are for.
- **The overlay draws `target ?? presented`** and commits via `markOverlayCommitted` in a layout
  effect. On a seek there is *no* decoder lead — draw for the target you already know; never wait
  for the frame event while scrubbing.
- **The number of Views IS the cost of a frame.** RDP-simplify in stage pixels (endpoints exact),
  one View per dash, skip zero-alpha layers, and keep the measured view count surfaced in the
  sync panel — never assert it.

## The analysis.json contract, on a phone

- **Confidence is truncated, never rounded**, and every gate re-applies the analyzer's exact
  inclusive comparison (`conf >= MIN_CONF`). The two-bar system is deliberate: draw at
  `conf > 0`, measure at `MIN_CONF`; abstain rather than reuse a previous frame's value.
- **No literal keypoint index, ever.** Indices resolve by name from the artifact's own
  `keypoint_names`. No hand-written slice of the 49-entry layout.
- **Handedness never computed on the phone.** Angle geometry arrives pre-resolved (`lead_*`/
  `trail_*`) from the analyzer; the client draws what it is given.
- **Corrections merge by frame at render time and are never persisted into the artifact.**
- **The trace never interpolates across a gap** — a dashed chord is the honest output, and a
  sparse trace from an approved solve is correct, not a bug to prettify.
- **Frame math:** `frame = round(currentTime × fps)` everywhere; the Android seek target is
  `frame / fps` (D40 — media3 resolves forward; the web's `(frame+0.5)/fps` costs one frame on
  every seek here). The seek-target rule lives in exactly one place: the native module.
- **Shared constants get one home.** A value both clients and the analyzer must agree on
  (MIN_CONF, event order) belongs in `packages/schema/src/contract.ts`, not hand-copied. The
  four COPIED-VERBATIM overlay files are byte-locked by a tripwire test — edit both copies or
  un-duplicate, never one.

## Lifecycle

- **Every listener, timer, and subscription created in a hook is cleaned up in the same hook**,
  removing the exact reference it added. Every fetch is abortable (AbortController through the
  ApiClient) — a popped screen must not keep downloading or parsing.
- **Media respects the app lifecycle.** Nothing plays while the app is backgrounded; AppState is
  handled where the player state machine lives, so JS state stays truthful about the picture.
- **Network requests time out.** RN's OkHttp has no default timeouts — a hung socket must resolve
  to the typed 'unreachable' state, never an indefinite spinner.
- **Auth headers on long-lived surfaces (video, images) re-resolve on token refresh.** A captured
  token is stale by the first long session; the media route's 404-not-401 makes that failure
  read as missing data, which is why this is a rule and not a nicety.
- **Native modules release deterministically** on view destroy, drain their handlers, bound every
  accumulator, and guard cross-thread state with locks — the module's own
  `scheduleLock`/`pendingLock` pattern is the house style.

## Native config (CNG)

- **Never hand-edit `apps/mobile/android/` or `ios/`.** They are prebuild output. Config changes
  go in `app.json` (or a config plugin), then `npx expo prebuild -p android --clean` — and note
  that `expo run:android` does NOT regenerate an existing `android/`, so a native-config edit
  without `--clean` silently never lands on the device.
- **Release builds ship minified** (expo-build-properties: R8 + shrinkResources on), with
  `allowBackup` false and no debug-only permissions in the main manifest
  (`android.blockedPermissions` for anything a dev tool needs that release must not carry).
- **A dependency with a native module or config plugin is APK weight even with zero imports.**
  Nothing enters `package.json` without an import site or a register entry saying why it waits.
  The gesture-handler autolinking exclusion (D47) stands until a feature needs it.
- **Kotlin Expo-module gotcha:** every property an `init` block uses is declared above that
  block — Expo swallows the throw and the only symptom is a cast error naming a healthy function.

## UI, design system, accessibility

- **Function first, skin later — and never confuse that with putting everything on screen.**
  Visual polish is deferred (root `CLAUDE.md`); `mobile-app-shell` step 03 owns it. What is *not*
  deferred is restraint. Taylor's standing rule: *"a modern and sleak interface without clutter of
  information that is not important (such as timestamps, or framerates, or labels that don't
  matter) … not just dump every variable we have on the screen."*
  Before a field ships, three tests: **would a golfer act on it** (if not, it is diagnostics —
  `__DEV__` panel, not product), **does it repeat something already on screen**, and **is it here
  only because we have the value**. Frame rates, drift, seek counts and raw frame indices are
  instruments and live in the frame-sync panel alone. Stylize like the existing surfaces rather
  than inventing a look, so the later skinning pass has one system to change.

- Deck (`src/design/deck/`) is the player's control-surface system, layered on `theme.ts` tokens.
  **No hand-mixed rgba beside a token that nearly matches** — use the token or name a new one.
  Overlay data colours are web-parity constants and stay literal.
- **No borders, anywhere** (Taylor, 2026-08-14). Surfaces are flat: separation is fill and shadow,
  selection is background tint + text colour, a divider is spacing. `border*` styles are legal only
  when they *draw a shape* (View-drawn glyphs, overlay markers, gauge dots, the scrub thumb's ring).
  The edge tokens were deleted — do not reintroduce them. A control whose only visual was its
  border gets a fill, never the border back.
- **Every interactive control is accessible**: role, label, state; drag-only surfaces get
  `adjustable` + `accessibilityValue` + increment/decrement actions (scrub), or explicit
  screen-reader buttons (DeckSheet's pattern). 48 pt touch targets via hitSlop where the drawn
  control is smaller.
- **Edge-to-edge means every screen consumes insets** (`useSafeAreaInsets`); window metrics come
  from `useWindowDimensions()`, never a render-time `Dimensions.get`.
- **The ordinary player does not scroll; panels come up from the bottom** (`DeckSheet`,
  closed = unmounted). The after-swing browse layout is the one sanctioned scroll under the
  player: video flush at the top, summary in the flow below (see `mobile-client.md`).
- **Controls never hide.** No tap-to-hide, no auto-hide, no hover states — a phone has no hover,
  and a control that can vanish must be summoned. (Taylor, 2026-08-13.)
- **SVG lives in `design/gauges` and nowhere else.** `react-native-svg` is shipped for the score
  meters; the overlay stays on plain `View`s (D23 was a measurement) and glyphs stay drawn.
- **Nothing dev-only leaks into release**: `__DEV__`-gate instruments *and their layout
  accommodations* (padding reserved for the dev-client bubble counts).

## Data & state

- Server state is a **discriminated union** that separates signed-out / not-analysed /
  unreachable — "no swings yet" must never render over a network failure.
- **One module-level ApiClient**, token resolved per request via a function; media URLs are only
  ever produced together with their auth headers.
- List data already on the device is not re-paid for: **stale-while-revalidate from the last
  good response** — a screen must never serialize a refetch of data it can see from where the
  user just tapped.
- A fetch that fails must **degrade, not crash**: corrections fall back to the analyzer's answer;
  overlays fall back to plain video (error boundary); the app never hard-crashes on a malformed
  artifact.

## Testing & verification

- `pnpm --filter mobile typecheck && pnpm --filter mobile test` green before every commit;
  `scripts/checkoverlay.ts` whenever overlay math or its inputs change (Gate 3 — the mobile
  layers must land on the analyzer's burn-in for all ten fixtures).
- **Tests pin behaviour a golfer or the server would notice** (the auth header on the media
  source, the box that must not resize, seek coalescing) — not markup. Mock with phone-shaped
  insets so inset bugs fail in CI.
- **After a `fireEvent` that re-renders, query with `findBy*`, never `getBy*`.** This root flushes
  a press-driven state update on a microtask, so a synchronous query reads the **pre-press** tree
  and fails on a component that works — with a diff showing the old state, which reads like a
  broken handler. A press asserted only through a `jest.fn()` passes either way (no re-render is
  involved), so the two failure modes sit side by side and look unrelated. `render` is awaited
  here for the same reason.
- Comment convention: every non-obvious decision carries **the failure it prevents**, and every
  deliberate divergence from the web player is named at the divergence site.
- A change that alters a decision edits `docs/decisions/mobile-client.md` **in the same session**,
  in place. A new machine/device/vendor fact goes to `docs/ENVIRONMENT.md`. A new procedure goes
  to `docs/RUNBOOK.md`.
