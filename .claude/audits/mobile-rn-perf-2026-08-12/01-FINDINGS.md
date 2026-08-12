# Mobile RN Performance & Architecture Review — Findings

**Date:** 2026-08-12 · **Scope:** all of `apps/mobile` (src, App.tsx, config, `modules/frame-clock` + `modules/high-speed-camera`, generated `android/`) · **Confidence: High**
**Method:** 6 parallel dimension reviews, every finding re-verified by an adversarial second agent that re-read the cited code (1 finding refuted, several adjusted), plus a completeness critic. ~1.47M review tokens, 434 file reads/greps.
**Totals: 0 Critical · 8 High · 20 Medium · 10 Low** (1 refuted, recorded at the bottom).

> **Moving-tree caveat.** The player is being actively refactored in a parallel session — `AnalysisPanel`, `ComparePanel`, `FilmstripScrubber`, `useReport`, `useSeekSurface` appeared *while this review ran*. Every cited line number was verified against the tree as reviewed, but an executor must re-locate each cite before editing. `pnpm --filter mobile typecheck` passed at review close.

**No Critical findings.** The codebase honors every root-`CLAUDE.md` contract rule that is statically testable: confidence gating with the analyzer's exact inclusive comparison, no CV math in the client, corrections merged at render time only, no literal keypoint indices anywhere, and the measured D40 seek-rule deviation is documented on both sides of the JS/native boundary. The High findings are structural waste and lifecycle gaps, not broken contracts.

---

## HIGH

### H1 — `actions` identity churns at 60 Hz, defeating PhaseRibbon's memo and re-running the autostart effect every frame
`H · Quick · certain` — [useFramePlayer.ts:237](apps/mobile/src/features/player/useFramePlayer.ts#L237)
**Evidence:** `play` has deps `[presented, target]` (:222–237) and `step` includes `presented` (:211–220); `presented` changes on every native frame event, so the `actions` useMemo (:379–382) is a new object every frame. `PlayerConsole`'s `onSeek = useCallback([actions])` therefore churns per frame and defeats `PhaseRibbon`'s `memo` (PhaseRibbon.tsx:50) — its other props are stable. SwingPlayer's autostart effect lists `play`/`seekTo` as deps (SwingPlayer.tsx:185–191) and re-runs per frame (cheap early return, but real).
**Why:** Five gradient-faced Pressables reconcile at 60 Hz for no visual change. The hook already mirrors `playing`/`looping`/`bounds` into refs (:164–175) for exactly this reason — the fix is the file's own established idiom, applied inconsistently.
**Fix:** Mirror `presented` and `target` into refs (`presentedRef`, `targetRef`) the same way `playingRef` is done; have `play()`/`step()` read the refs. Their dep arrays drop to stable values and the 60 Hz churn dies. (Verifier note: `seekTo` still closes over `playing`/`bounds`, so `actions` still changes on play/pause and analysis-load — that coarse churn is harmless.)
**Source:** Callstack RN guide (re-render discipline); CLAUDE.md 60 fps requirement.

### H2 — TraceLayer rescales, re-simplifies and re-dashes every trace piece on every frame, including completed pieces and when `grow` is off
`H · Moderate · certain` — [TraceLayer.tsx:116](apps/mobile/src/features/player/overlay/TraceLayer.tsx#L116)
**Evidence:** The `runs` useMemo deps are `[pieces, frame, grow, sx, sy, peak]`, so it recomputes at 60 Hz. For *every* piece it allocates a full stage-space copy (`cut.map(([x,y]) => [x*sx, y*sy])`, :99), runs RDP simplify over the whole prefix (:100), then dash/polyline segmentation (:107–110). `cutAt` returns the untouched array once a piece is fully revealed (traceSmoothing.ts:452) — completed pieces produce byte-identical output every frame. With `grow=false`, `frame` is never read but still invalidates the memo. A smoothed trace "can run to a few thousand points" (paths.ts:52); 240 fps capture is a stated goal and quadruples that.
**Why:** O(whole path) work + thousands of tuple allocations per frame on the JS thread, where O(growing tip) suffices — Hermes GC churn competing directly with the 16.6 ms budget of the product's #1 feature. Live by default: trace and grow default on (overlays.ts:29–35).
**Fix:** Split the memo: (a) per-piece scaled+simplified+dashed segments keyed on `[pieces, sx, sy, peak]` only — serves `grow=false` and every fully-revealed piece; (b) per frame, recompute only the single piece containing the playhead. Drop `frame` from deps entirely when `grow` is false.
**Source:** Callstack RN guide (JS-thread frame budget / allocation churn).

### H3 — The 60 Hz frame value lives at the SwingPlayer root, so every presented frame and every scrub touch-sample re-renders the entire screen tree
`H · Moderate · memo-boundary part certain, restructure needs-profiling` — [SwingPlayer.tsx:125](apps/mobile/src/features/player/SwingPlayer.tsx#L125), [PlayerConsole.tsx:74](apps/mobile/src/features/player/PlayerConsole.tsx#L74)
**Evidence:** `presented`/`target` are useState in `useFramePlayer`, called at the SwingPlayer root; `setPresented` fires per native frame event, `setTarget` per drag sample. Each update re-renders the whole body — top chrome (:310–395), notice, dock, all inline style arrays and Pressable style functions. `PlayerConsole` is `memo`'d but receives the per-frame-rebuilt `state` object (useFramePlayer.ts:360–377), so the speed well, play cap, FrameStepper and DockActions reconcile at 60 Hz for a playhead/time readout that is the dock's only 60 Hz consumer.
**Why:** The overlay genuinely needs the frame; the back button, title, score chip and speed keys do not. D23/D36's 99.2 % frame-lock was measured at ~77 views *without today's chrome* — this reconciliation burns headroom on the core surface and is the first thing that folds on a mid-range device. **The frame-lock number with today's full chrome + trace is an open measurement** (CURRENT-STATE §11b; an open HANDOFF row asks for exactly these two numbers).
**Fix (two stages):** (1) *Certain, do now:* split the memo boundary — extract the frame-dependent strip (playhead + badge + time row + ScrubBar host) into its own component taking `frame` as a primitive; give the dock a memo boundary receiving only primitives (`playing`, `looping`, `speed`, `disabled`) plus the H1-stabilized `actions`. Without H1 first, this does nothing. (2) *Profiling-gated:* if overlayDrift p95 with trace+chrome still misses, move `frame` into a tiny external store (`useSyncExternalStore`) and subscribe only the 60 Hz consumers. Gate on the FrameSyncPanel numbers per the project's own measurement discipline.
**Source:** Callstack RN guide (subscribe at the leaf); D23/D36; CURRENT-STATE §11b open item.

### H4 — Opening a swing serializes a full swing-list refetch ahead of the video, analysis, and corrections requests
`H · Moderate · certain` — [useSwings.ts:72](apps/mobile/src/features/swings/useSwings.ts#L72)
**Evidence:** `useSwing(id)` calls `useSwings()`, which fires a fresh `GET /api/v1/swings` on every mount (:52–54). `SwingDetailScreen` returns a spinner until that lands (:29–35), so `SwingPlayer` — and with it the media-source, analysis and corrections fetches — cannot start until the list round trip completes. The data being waited on (label, fps, frameCount, aspect) is already in memory in SwingLogScreen's own `useSwings` instance, mounted directly below in the native stack.
**Why:** Every swing open pays one extra sequential round trip (payload grows with the log) before the video URL is even requested — a fixed tax on time-to-first-frame of the centrepiece screen, felt on cellular where LAN testing hides it. The documented "no per-swing endpoint" decision (useSwings.ts:63–71) covers the endpoint, not this client-only serialization.
**Fix:** Module-level in-memory cache of the last `ok` list response; `useSwing` seeds synchronously from it and revalidates in the background (stale-while-revalidate). Player mounts on first render; media/analysis/corrections start immediately in parallel. No server change; keeps the documented decision intact.
**Source:** Callstack RN guide (TTI / request waterfalls).

### H5 — The version gate never runs: `clientConfig()` has no caller and a 426 renders as "unreachable"
`H · Moderate · certain` — [api.ts:153](apps/mobile/src/platform/api.ts#L153)
**Evidence:** `clientConfig()` is documented as "the launch call" but its only caller is its own test. `App.tsx` never calls it and `UpgradeRequiredScreen` is imported only by its own test. Worse, `useSwings.ts:45–46` maps every non-401 `ApiClientError` — including a real 426 — to `{ kind: "unreachable" }`.
**Why:** The entire 426 machinery built in platform-foundation is dead code end-to-end; a build below the server's version floor shows "unreachable" forever instead of the mandated upgrade screen. `docs/decisions/platform-data.md` records the 426 path as "rendered as a terminal screen on mobile" — a documented decision the shipped code does not satisfy.
**Fix:** Fire `api.clientConfig()` once at startup (it is unauthenticated — runs in parallel with `getSession()`, zero serial latency; don't block first paint); on `err.isUpgradeRequired` render `<UpgradeRequiredScreen detail={err.upgradeRequired}/>` above the navigator. Also branch on `isUpgradeRequired` before the 401 check in `useSwings`.
**Source:** api.ts:19–25's own documented design; docs/decisions/platform-data.md.

### H6 — Nothing pauses ExoPlayer when the app backgrounds — playback runs headless and JS state desyncs
`H · Quick · certain` — [SwingPlayer.tsx:185](apps/mobile/src/features/player/SwingPlayer.tsx#L185)
**Evidence:** The player autoplays looping on load. The only AppState listener in the app is supabase.ts:55 (token refresh). The Kotlin view has only `OnViewDestroys` — no background hook — and Media3 leaves lifecycle to the app: `playWhenReady` stays true on activity stop. Looping is enforced *from JS via frame events* (useFramePlayer.ts:268–278): when the surface dies those events stop, so the loop logic stops firing while the native clock runs on, and `playing` stays true against a player that ran to end-of-file.
**Why:** Home button or screen lock leaves the decoder running for nothing (battery/CPU), and on return the transport lies about its own state.
**Fix:** One ~10-line effect: `AppState.addEventListener('change', …)` → on non-`active` call the existing stable `pause()`; optionally remember was-playing and resume on `active`. Clean up the listener.
**Source:** Callstack RN guide (stop work when backgrounded); Media3 lifecycle docs.

### H7 — No error boundary anywhere — a render throw is a hard crash to the launcher
`H · Moderate · certain` — [App.tsx:39](apps/mobile/App.tsx#L39)
**Evidence:** Zero matches for ErrorBoundary/componentDidCatch/getDerivedStateFromError in `apps/mobile`. `SwingOverlay` mounts with no boundary between artifact-driven geometry math and the root.
**Why:** Any render throw — most plausibly an unexpected `analysis.json` shape reaching overlay code — unmounts the whole tree; in release Hermes that is an app crash with no recovery. The project's own rule: quality gates degrade, they don't crash. The client currently has no degrade path at all.
**Fix:** A class-based root ErrorBoundary (fallback screen in `COLORS.bg`, retry) wrapping the NavigationContainer, plus a narrow boundary around `SwingOverlay` so a malformed artifact degrades to plain video with an "overlays unavailable" notice instead of killing the player.
**Source:** root CLAUDE.md "Quality gates degrade, they don't crash".

### H8 — Store identity is still the spike's: `com.swingsage.spike` everywhere
`H · Moderate · certain` — [app.json:11](apps/mobile/app.json#L11), android/app/build.gradle:90–92
**Evidence:** `applicationId`/`namespace`/`bundleIdentifier`/`package` all read `com.swingsage.spike`.
**Why:** applicationId becomes permanent on first Play publish; the Android OAuth client is matched by package + SHA-1 (google.ts:17–23), so every month this survives makes the rename more expensive — exactly the "permanently more expensive after the first store release" class the constraints call out.
**Status:** Already a **BLOCKED HANDOFF row** ("Rename the Android package com.swingsage.spike → com.swingsage.app") — not re-asked here. Recorded because the fix plan must sequence around it (rename before R8/store work if possible) and because gradle `namespace` and the OAuth re-registration are part of the same move.

---

## MEDIUM

### M1 — FrameStats sample lists are mutated from two threads and read from a third with no synchronization
`M · Quick · certain` — [FrameClockView.kt:186](apps/mobile/modules/frame-clock/android/src/main/java/expo/modules/frameclock/FrameClockView.kt#L186), FrameStats.kt:17–19
**Evidence:** `overlayDrift.add()` runs on the ExoPlayer playback thread (metadata listener) AND from `markOverlayCommitted` (an AsyncFunction on the module's background dispatcher); `leadTimeMs.add` on main. FrameStats is a bare ArrayList; `percentile()` iterates via `sorted()` mid-add. `scheduled`/`pendingCommits` are correctly locked; the stats objects are not. `markOverlayCommitted` fires in production (SwingOverlay's layout effect is not dev-gated), so the two-writer race is live in release: potential AIOOBE = native crash mid-playback, 60 rolls/second.
**Fix:** Synchronize FrameStats internally (same pattern as the module's own `scheduleLock`/`pendingLock`). Lock cost at ≤60/s is irrelevant.

### M2 — Overlay primitives move via layout props (left/top/width/height) instead of transforms
`M · Moderate · needs-profiling` — [Primitives.tsx:39](apps/mobile/src/features/player/overlay/Primitives.tsx#L39)
**Evidence (verifier-corrected):** Line/Dot/Ring position via absolute left/top/width/height. The genuinely dirtied per-frame Yoga set is the *moving* nodes only (~28 bones + ~30 joints + club/orient/angle + the trace tip) — completed trace segments have byte-identical values and equal Yoga styles don't dirty layout; their cost is ShadowNode clone/prop parsing (H2's territory), roughly half the naive count.
**Why:** Layout-vs-transform is the classic lever, but this architecture measured 99.2 % lock (D23/D36). It is the *second* lever if a longer or 240 fps clip drops frames.
**Fix:** Profiling-gated: express position (and length where endcaps tolerate `scaleX`) as transforms on the primitives that move every frame. Measure overlayDrift p95 before/after on the S25+; if the number doesn't move, this lever is not where the budget goes. Do not do this speculatively.

### M3 — Media auth headers are captured once per mount — token expiry turns a long session into silent 404s (video, thumbnails, filmstrip)
`M · Moderate · certain` — [SwingPlayer.tsx:539](apps/mobile/src/features/player/SwingPlayer.tsx#L539), api.ts:139–144, FrameClockView.kt:292–311
**Evidence:** `useMediaSource` resolves `api.mediaSource()` once per `[swingId, view]`; `api.mediaSource` captures the token at call time — unlike `request()`, which resolves it per request *precisely because* "a token captured when the client was constructed is stale" (api.ts:52–60). Auto-refresh stops while backgrounded (supabase.ts:55–58), making expiry-during-background the realistic path. Natively, every seek creates a data source reading the factory's stored headers, and `applySource` treats changed headers as a new source and **re-prepares, restarting playback** — so the naive JS fix alone regresses. Same class applies to `SwingCard.useAuthenticatedImage` and `FilmstripScrubber.useFilmstrip` (critic).
**Why:** A golfer returning after token rotation gets "this swing would not play" (or a 404-blank thumbnail) about a swing that exists — the exact intermittent class D48/D50 warn about.
**Fix:** Subscribe media-source hooks to `onAuthStateChange` (TOKEN_REFRESHED) and re-resolve headers. Natively, split header updates from source updates in `applySource`: when only headers changed, call `httpFactory.setDefaultRequestProperties(...)` without `setMediaItem`/`prepare` so rotation never restarts playback. One shared source-hook covers video, thumbnails and filmstrip.

### M4 — An open Overlays sheet re-renders OverlayControls at frame rate while video plays behind it
`M · Quick · certain` — [SwingPlayer.tsx:421](apps/mobile/src/features/player/SwingPlayer.tsx#L421)
**Evidence:** Playback continues behind the sheet by design; every presented frame re-renders SwingPlayer, recreating the `<OverlayControls …/>` element inline. OverlayControls (unmemoized) re-runs `availableGroups`/`drawableAngles` and rebuilds every chip closure per frame; DeckSheet's Modal/ScrollView scaffolding reconciles too. Contrast: the metrics sheet's `children` element identity is owned by SwingDetailScreen, so React bails on it — the correct pattern is already in the file.
**Fix:** Hoist the sheet content into a `useMemo` keyed on `[analysis, toggles, onToggle, angles]` (all frame-invariant), and/or `memo(OverlayControls)`.

### M5 — React Compiler is available in the SDK 57 tree but not enabled
`M · Quick-to-enable, measured decision · needs-profiling` — [app.json:2](apps/mobile/app.json#L2)
**Evidence:** No `experiments` key; `@expo/cli` gates on `exp.experiments?.reactCompiler` (default false); `babel-plugin-react-compiler` already resolves from the tree — one config line, no new dependency.
**What it can and cannot do (verifier-corrected):** it eliminates the element-recreation class (M4) and lets frame-invariant subtrees bail out of the 60 Hz render, but it **cannot** stabilize `actions` or anything genuinely per-frame — H1's ref fix and H3's boundary split are still required.
**Fix:** Enable `"experiments": { "reactCompiler": true }`, rebuild, verify on the S25+ (profiler + FrameSyncPanel; re-test DeckSheet's exit animation — it knowingly bends an exhaustive-deps rule). Adopt or revert on the numbers, and record the decision.

### M6 — expo-video ships its native module and config plugin with zero JS import sites
`M · Quick · certain` — [package.json:18](apps/mobile/package.json#L18), app.json:31
**Evidence:** Zero import/require sites (every grep hit is a comment). frame-clock declares its own media3 1.9.0 explicitly, so removal is build-safe. The decisions register itself says: "if nothing claims it by the end of mobile-player, delete it."
**Fix:** Remove from dependencies and plugins (native rebuild); update frame-clock's pin comment to state the media3 pin is now self-owned. If it is being retained deliberately for a future surface, record that in `docs/decisions/` instead.

### M7 — Splash chain is vestigial: stale expo-splash-screen comment, first-frame window background is not the app's colour
`M · Quick · certain` — android/app/src/main/…/MainActivity.kt:18, res/values/styles.xml
**Evidence:** `setTheme(R.style.AppTheme)` commented "required for expo-splash-screen" — which is not installed. AppTheme sets no `android:windowBackground`; nothing forces night mode and `expo-system-ui` is installed but never imported, so on a light-mode device the pre-RN window is near-white behind a `#080a0d` app. `colors.xml`'s `splashscreen_background` (#FFFFFF) is referenced only by a dead drawable (deleting one without the other breaks resource linking — verifier); `assets/splash-icon.png` is referenced by nothing; app.json declares no splash, so **`prebuild --clean` would silently lose the hand-rolled splash**.
**Fix:** Declare the splash in app.json (install expo-splash-screen with `backgroundColor "#080a0d"` + image) so CNG reproduces it — or at minimum set `windowBackground`/`windowSplashScreenBackground` to `#080a0d` via config plugin, fix the comment, and delete the dead color+drawable pair together.

### M8 — Release builds ship un-minified: R8 and resource shrinking off, no expo-build-properties plugin exists to turn them on
`M · Moderate · certain` — [app.json:29](apps/mobile/app.json#L29)
**Evidence:** build.gradle gates minify/shrink on properties that appear nowhere in gradle.properties; app.json has no expo-build-properties, so CNG can never enable them; EAS production profile → AAB, un-minified.
**Why:** Larger AAB, slower cold start, and retrofitting R8 late surfaces every keep-rule failure at once. "Infrastructure decisions target production scale."
**Fix:** Add expo-build-properties with `enableProguardInReleaseBuilds: true, enableShrinkResourcesInReleaseBuilds: true`, `prebuild --clean`, build release (or `debugOptimized`), verify sign-in + player on device once.

### M9 — `allowBackup=true` backs up the Supabase session in AsyncStorage to Google cloud backups
`M · Quick · certain` — android/app/src/main/AndroidManifest.xml:15
**Evidence:** Session persists via AsyncStorage in app-private storage, which Auto Backup includes by default.
**Why:** Tokens restored onto other devices outlive sign-out — a latent auth hole for a product with a coach/golfer data-access boundary.
**Fix (verifier-simplified):** `"allowBackup": false` is a **first-class app.json android field** — no plugin needed. Set it, `prebuild --clean`, confirm the regenerated manifest.

### M10 — Generated `android/` has drifted from app.json: the `swingsage://` scheme is not in the installed manifest
`M · Quick · certain` — android/app/src/main/AndroidManifest.xml:25–30
**Evidence:** app.json declares `"scheme": "swingsage"`; the manifest carries only `exp+swingsage`. `android/` is gitignored CNG output, but `expo run:android` does not regenerate an existing dir — **app.json native-config edits silently never land**. (Critic: `NavigationContainer` also has no `linking` config, so fixing the manifest alone still leaves the scheme doing nothing.)
**Fix:** `npx expo prebuild -p android --clean` + reinstall; add a RUNBOOK line: any app.json change touching native config requires `prebuild --clean` before the next run. Add the `linking` config when the first real deep link ships.

### M11 — `onScreenFrame()` rewrites a frame's display timestamp to the poll time, flattering the overlay-drift late tail
`M · Quick · certain` — [FrameClockView.kt:131](apps/mobile/modules/frame-clock/android/src/main/java/expo/modules/frameclock/FrameClockView.kt#L131)
**Evidence:** The drain re-inserts `current to now` (poll time), and `markOverlayCommitted` later scores `lateNs` against that rewritten timestamp; `stats()` calls `onScreenFrame()` and the sync panel polls stats every 250 ms *during the sessions being measured*. The file itself documents two prior measurement biases — this is a third of the same family, biased toward flattering the instrument that gates the #1 feature.
**Fix:** Re-insert the original pair (one-line semantic change), then re-run the drift probe to see whether the recorded p95 was flattered.

### M12 — No request cancellation anywhere — a popped screen's analysis.json still downloads and JSON-parses to completion
`M · Moderate · certain` — [api.ts:102](apps/mobile/src/platform/api.ts#L102)
**Evidence:** Zero AbortController hits in src. The `live`-flag pattern only suppresses setState; the body keeps streaming and `res.json()` parses the full multi-MB artifact after the screen is gone — exactly while the pop transition runs. (Verifier: `useMediaSource` makes **no** network request — do not touch it.)
**Fix:** AbortController in the three fetching hooks (useAnalysis, useCorrections, useSwings) through `request()`'s existing RequestInit; abort in cleanup; swallow AbortError.

### M13 — ApiClient has no request timeout — a hung socket strands every hook in 'loading' forever
`M · Quick · certain` — [api.ts:103](apps/mobile/src/platform/api.ts#L103)
**Evidence:** RN 0.86's OkHttp client sets connect/read/write timeouts to **0** (verified in RN source), so a half-open socket hangs fetch indefinitely; the carefully built 'unreachable' states are reached only on rejection — the golfer sees an indefinite spinner.
**Fix:** Per-request AbortController timeout (~10–15 s default, overridable), mapped to a typed `ApiClientError` (code 'timeout') that classifies as 'unreachable'. Leave retry to the hooks' existing reload affordances.

### M14 — Mirror refs are written during render — the exact pattern the web twin documents as forbidden
`M · Quick · certain` — [useFramePlayer.ts:171](apps/mobile/src/features/player/useFramePlayer.ts#L171), ScrubBar.tsx:51–60, useSeekSurface.ts:44–53
**Evidence:** `boundsRef.current = …` etc. execute in the render body; the web twin syncs the same mirrors in effects with the comment "mutating a ref mid-render is the one thing React asks you not to do with it" (usePlayer.ts:132–143). The native 60 Hz callback reads `boundsRef` for the loop/wrap decision — under concurrent rendering a discarded render can leak a window that never committed. (No StrictMode/transitions today, so the path is narrow — hence M, latent.)
**Fix:** Move the mirror assignments into effects, exactly as the web player does; sweep ScrubBar and useSeekSurface in the same pass.

### M15 — `MIN_CONF = 0.35` hand-copied in six TS sites instead of exported from @swingsage/schema
`M · Quick · certain` — [geometry.ts:25](apps/mobile/src/features/player/overlay/geometry.ts#L25)
**Evidence:** mobile geometry.ts:25; ClubLayer.tsx:38 re-declares it as `WEAK_CONF` in the same folder; web angleOverlay.ts:18, swingSync.ts:51, **plus a sixth bare literal the finder missed: web SwingStage.tsx:769** (verifier). Producer: metrics.py:35. `contract.ts` exists precisely for rules JSON Schema cannot express (EVENT_ORDER lives there).
**Fix:** Export `MIN_CONF` from `packages/schema/src/contract.ts` (comment naming metrics.py as the producing twin); import at all six sites, delete `WEAK_CONF`. Optionally a schema test asserting it matches metrics.py.

### M16 — The four 'COPIED VERBATIM' twins have no automated drift tripwire, and their headers cite a decision number that does not exist
`M · Quick · certain` — [traceSmoothing.ts:2](apps/mobile/src/features/player/overlay/traceSmoothing.ts#L2)
**Evidence:** All four pairs currently byte-match (headers stripped; independently re-diffed) but nothing — no test, no CI step — would report the divergence that is the documented un-duplication trigger. The headers say "see D51"; **no D51 exists** — the decision lives unnumbered in mobile-client.md. `scripts/checkoverlay.ts` already imports the mobile copies, arguably the "third consumer" that triggers extraction.
**Fix:** Jest byte-equality test over the four pairs (mobile header stripped), failure message "edit both copies or un-duplicate"; fix the dangling D51 pointers; raise in the register whether checkoverlay.ts is the third consumer.

### M17 — model.ts's twins live inline in web SwingStage.tsx — same math, different shapes, impossible to diff
`M · Moderate · certain` — [model.ts:62](apps/mobile/src/features/player/overlay/model.ts#L62), web SwingStage.tsx:330–479
**Evidence:** Mobile extracted `traceSpans`/re-cut/`orientationHold` as functions; web keeps identical logic inline. Three behavioural deltas already exist: mobile clamps phase ordering (model.ts:71–73), guards `pts[i]` (:149–151), and handles per-field phase overrides where web is all-or-nothing (partly type-driven — verifier). This is the highest-value math in the player and the one duplicated block with no mechanical drift detection possible even in principle; checkoverlay.ts only renders the mobile pipeline.
**Fix:** Extract web's bodies into `apps/web/src/lib` files matching mobile function-for-function; add them to the verbatim tripwire (or treat as the third-consumer moment and move to a shared package). Reconcile the three deltas deliberately and document which side was right.

### M18 — Both scrub surfaces are invisible to TalkBack — no accessible way to move through frames
`M · Quick · certain` — [ScrubBar.tsx:46](apps/mobile/src/features/player/ScrubBar.tsx#L46), FilmstripScrubber.tsx:71–77
**Evidence:** Plain Views with spread panHandlers — no role, value, or actions. The codebase already knows the rule: DeckSheet adds screen-reader buttons because "dragging is not available to a screen reader" (DeckSheet.tsx:292). A TalkBack user can play/pause but cannot scrub or step — the core interaction of the #1 feature.
**Fix:** `accessibilityRole="adjustable"` + `accessibilityValue={{min,max,now}}` + increment/decrement actions calling `onSeek(frame±1)`; mark the second surface `importantForAccessibility="no-hide-descendants"` against double-announcement.

### M19 — SwingLogScreen ignores the bottom inset under edge-to-edge
`M · Quick · certain` — [SwingLogScreen.tsx:123](apps/mobile/src/screens/SwingLogScreen.tsx#L123)
**Evidence:** edge-to-edge is on with a transparent nav bar; the list hardcodes `paddingBottom: 32` and imports nothing from safe-area-context. On 3-button nav (~48 dp) the Delete-account footer — the app's only irreversible action — overlaps the system bar. The player and sheet handle insets correctly; this screen is the outlier. (Static verification only; a device screenshot would make it conclusive.)
**Fix:** `paddingBottom: 32 + insets.bottom` via `useSafeAreaInsets()` in `contentContainerStyle`.

### M20 — DeckSheet sizes its detents from non-reactive `Dimensions.get('window')`
`M · Quick · certain` — [DeckSheet.tsx:116](apps/mobile/src/design/deck/DeckSheet.tsx#L116)
**Evidence:** Read during render; detents, entrance settle, maxHeight and backdrop interpolation all derive from it; nothing re-renders on window resize. Portrait lock hides it today, but Android 16 ignores orientation locks on ≥600 dp screens, and fold/split-screen resizes without a re-render — a sheet can open half off-screen.
**Fix:** `useWindowDimensions()` — one line; downstream already recomputes via useMemo.

---

## LOW

### L1 — `react-dom` is a dependency of a native-only app whose web target cannot start
`L · Quick` — package.json:20. No imports anywhere; react-native-web not installed, so the `web` script and app.json web block are vestigial. Remove all three; jest doesn't need it (verified).

### L2 — SYSTEM_ALERT_WINDOW sits in the main (release) manifest
`L · Quick` — AndroidManifest.xml:5. The debug source set declares it separately for the dev-menu overlay. Fix via the built-in `android.blockedPermissions` app.json field (emits `tools:node="remove"`), then verify the merged release manifest AND that the debug overlay still works.

### L3 — iOS config surface is bare: no usage-description strings, `supportsTablet: true` undecided
`L · Quick` — app.json:9–12. First `prebuild -p ios` materializes exactly this; iOS kills the process at the first camera call without `NSCameraUsageDescription`, and supportsTablet commits the launch to iPad review assets. Add `ios.infoPlist` strings in the same commit that adds the camera dependency; make supportsTablet an explicit decision (default false unless iPad is in launch scope).

### L4 — `useSwings.load` has no unmount guard — the one fetch hook without the live-flag the others all carry
`L · Quick` — useSwings.ts:38–54. Dead setState + retained closure per detail visit; also the inconsistency a future contributor copies. Same `live` flag (or the M12 AbortController) as its siblings.

### L5 — `runSeekSweep` survives unmount — up to ~6 minutes of 1.5 s timeout churn against a null ref
`L · Quick · dev-only` — useFramePlayer.ts:321–348. A 250-seek sweep abandoned by back-press chains ~375 s of timers retaining the player closure graph — noise in exactly the profiling sessions the instrument exists for. Bail when `ref.current` is null / a cancelled ref.

### L6 — `FrameClockView.release()` does not drain pending main-thread posts
`L · Quick` — FrameClockView.kt:443–446. Queued per-frame lambdas execute after release against the destroyed view (currently benign — Expo drops events for dead views). `main.removeCallbacksAndMessages(null)` first, and set `emitFrames = false` during teardown.

### L7 — Player chrome hardcodes near-token glass values beside the DECK tokens they almost equal
`L · Quick` — SwingPlayer.tsx:613 (`rgba(255,255,255,0.15)` vs `DECK.glass.hairline` 0.10 two rules apart), notice scrim/amber at :654–656. Point at the token, or name the stronger edge (`hairlineStrong`); derive the notice border from `COLORS.amber`. Overlay data colours are deliberate web-parity constants — excluded.

### L8 — Phantom devDependency `test-renderer` — an unrelated npm package with zero import sites
`L · Quick` — package.json:33. Almost certainly a mis-typed `react-test-renderer` install; pure supply-chain surface. Remove, `pnpm i`, confirm tests pass.

### L9 — Adaptive icon background is the Expo template's light blue on a dark-brand app
`L · Quick` — app.json:16 (`#E6F4FE` vs ground `#080a0d`). Launchers expose it in icon masks and launch animations. Set alongside the M7 splash fix.

### L10 — AccountBar reserves 56 pt for the dev-client bubble in release builds
`L · Quick` — AccountBar.tsx:64–65. The padding's own comment says it exists for the dev-client bubble, which is development-only. `paddingRight: __DEV__ ? 56 : 0`.

---

## Refuted (recorded so it is not re-found)

- **"CAMERA permission is declared but nothing uses a camera" — REFUTED.** `modules/high-speed-camera` is a committed, autolinked local module whose `openCamera` call requires it (Camera2HighSpeed.kt:179); the finder grepped only `src/` and `package.json`. Removing the permission would break the capture spike and the upcoming capture track. **Keep the permission.**

## Scope-adjacent observations (not findings; carried for the record)

1. **Concurrent refactor:** the player grew `AnalysisPanel`/`ComparePanel`/`FilmstripScrubber`/`useReport`/`useSeekSurface` while this review ran; it transiently failed typecheck mid-refactor and passes at review close. Executors must re-verify cites against HEAD.
2. **`useSeekSurface.ts:44–53`** repeats the M14 render-phase ref writes — sweep it in the same fix.
3. **No `linking` config** on NavigationContainer despite the declared scheme — folded into M10.
4. **Portrait lock** (app.json + manifest) is presumably deliberate (all fixtures are portrait) but no decisions entry records it; a landscape-filmed clip renders small with no rotate affordance. Log the decision when convenient.
5. **`expo-constants`** is a direct dependency with zero import sites — possibly an Expo peer expectation; verify before removing (not filed).
6. **jest `transformIgnorePatterns`** has an over-broad leading `.*` in the lookahead — no observed harm.
7. **Root `CLAUDE.md`'s frame-sync section states the `(frame+0.5)/fps` seek rule unconditionally** while D40 (measured: 0 % vs 100 % exact) mandates `frame / fps` on Android — the doc needed a platform qualifier. **Fixed in this session.**

## What is already right (do not "fix" these)

The full positives list lives in the review digest; the load-bearing ones, each verified with citations:

- **Seek coalescing** (one in flight, newest queued, lost-seek timeout) is exactly right, and the seek-target rule lives in exactly one place (native), with the D40 deviation measured and documented on both sides.
- **The overlay-drift instrument is a genuine closed loop** timed natively at both ends, with its two prior biases documented in place; per-frame event emission is off by default; every native accumulator is bounded; ExoPlayer is released deterministically on view destroy; headers are batched via `OnViewDidUpdateProps` to kill a prop-ordering race.
- **Per-artifact vs per-frame compute split** in SwingOverlay (whole-clip passes memoized on `[analysis]`), RDP simplification in stage pixels with endpoints preserved, one View per dash, zero-alpha layers skipped, view count measured and surfaced rather than asserted.
- **Contract fidelity:** no literal keypoint indices anywhere (names resolved from the artifact's own `keypoint_names`); MIN_CONF re-applied with the analyzer's exact inclusive comparison; corrections merged by frame at render time and never persisted; `trace_enabled` respected; bridges never curved; the fabricated-fallback club solve refused with the argument inline.
- **AuthProvider** value memoized; provider re-renders cannot cascade into the navigator (children element identity); Supabase client configured per canonical RN pattern with the two-refresh-loops race documented; one ApiClient with per-request token resolution.
- **jest-expo mocks use phone-shaped insets** so inset-ignoring layouts fail in CI; tests pin behaviour a golfer or the server would notice, not markup; `checkoverlay.ts` imports the real shipped modules and already caught a live divergence once.
- **DeckButton/DeckSheet accessibility** (role, state, 48 pt targets, screen-reader escape hatches, hardware back via Modal) — the a11y gap is specifically the scrub surfaces (M18), not the design system.
