# Mobile RN Performance & Architecture Review — Plan

**Date:** 2026-08-12
**Target:** `apps/mobile` — the entire React Native app (~75 source files + the Android native project + the `modules/frame-clock` local Expo module)
**Deliverables:** this plan → `01-FINDINGS.md` → `02-FIX-PLAN.md` (AI-executable, ordered) → `03-AI-CODER-RULES.md` (standing rules)
**Method:** multi-agent static review (6 dimensions in parallel), every finding adversarially verified by a second agent with file:line evidence, then a completeness critic sweeps for missed areas. Runtime profiling on the S25+ is *planned as fix-plan Phase 0*, not performed here — the phone is not connected (env probe), and the RN guideline is measure→optimize, so the fix plan starts with the measurements.

## Ground truth (what the app actually is)

- Expo SDK 57 / React Native 0.86.2 / React 19.2.3, New Architecture **on**, Hermes **on**, edge-to-edge **on**, dev-client build. Android native project committed (`com.swingsage.spike`); **no `ios/` directory exists** (no iPhone in the loop) — iOS review is config-level only (`app.json`).
- Navigation: `@react-navigation/native-stack` v7 (native screens). `react-native-gesture-handler` deliberately unlinked (`react-native.config.js` — ninja path-length limit).
- No `react-native-svg`, no Skia, no Reanimated in `package.json` — whatever the overlay draws with, it isn't a vector library. That makes the player's render path the single most important thing to inspect.
- Media: `expo-video`, `expo-image`. Auth: Supabase JS + AsyncStorage + `react-native-url-polyfill`, native Google Sign-In.
- Custom local native module `modules/frame-clock` (Android) — presumably the per-frame clock for overlay sync; its threading/marshalling model is a first-class review target.
- Biggest files: `SwingPlayer.tsx` (667), `useFramePlayer.ts` (390), `PlayerConsole.tsx` (376), `DeckSheet.tsx` (319), `FrameSyncPanel.tsx` (302).
- No `metro.config.js` in `apps/mobile` (pnpm monorepo — SDK 57 auto-configures workspaces; verify that's sufficient).
- Project constraints that bind this review (root `CLAUDE.md`): frame sync is the #1 perceived-quality feature; confidence is truncated, never rounded; handedness threads through angle math; clients only render (no CV in the client); ≥60 fps is a product constraint.

## Review dimensions & specific items to test

### A. Player render path (FPS-critical — the product)
- Does per-frame playback state flow through React (`setState` per frame at 60 Hz) or stay outside the render cycle? Where does `useFramePlayer` put the current frame?
- What primitive do the overlay layers (`SkeletonLayer`, `ClubLayer`, `TraceLayer`, `AngleLayer`, `OrientLayer`) draw with, and what is the per-frame reconciliation cost (view count per frame, style-object churn, layout thrash)?
- `modules/frame-clock`: Choreographer-driven? Does it emit an event across the JS boundary per frame; is that new-arch (JSI/TurboModule) or legacy event emitter; does it batch or flood?
- Frame math parity with the web player contract: `frame = round(currentTime * fps)`, seek to `(frame + 0.5) / fps`, CFR-60 assumption (`frames.ts`, `playbackWindow.ts`).
- Scrub path: does dragging `ScrubBar` re-render the whole player tree? Is seek throttled/coalesced?
- `PhaseRibbon`, `PlayerConsole`, `FrameSyncPanel`: do they subscribe to per-frame state they don't need at 60 Hz?

### B. Re-renders & state architecture (app-wide)
- Context value identity (`AuthProvider` and any others) — new object per render?
- Unmemoized callbacks/objects/styles passed into memoized children; `React.memo` usage where children are frame-hot.
- Lists: `SwingLogScreen` — FlatList vs ScrollView-map; item memoization, `keyExtractor`, image sizing in `SwingCard`.
- `DeckSheet`/`DeckButton` (the design system): animation driver (Animated with `useNativeDriver`? setState-driven?), modal/sheet mount cost.
- React 19 note: no compiler configured — is manual memoization present where it matters, absent where it doesn't?

### C. Bundle size, startup & TTI
- Barrel imports (`design/deck/index.ts`, `features/auth/index.ts`) and cross-feature import hygiene; anything importing all of a library for one symbol.
- Module top-level work at startup: Supabase client construction, AsyncStorage reads, `.env` parsing — what runs before first paint, in what order.
- `react-native-url-polyfill` — still needed on Hermes in RN 0.86? (Check, don't assume.)
- Dependency weight: anything in `dependencies` that ships but isn't imported; `expo-dev-client` correctly dev-only?
- Metro: monorepo resolution, inline requires, tree-shaking posture on SDK 57.
- Version-aware checks only: do **not** flag the RN ≤0.78 Hermes-mmap/bundle-compression item (0.86 defaults are correct); `expo.useLegacyPackaging=false` already confirmed.

### D. Android native config (+ iOS config surface)
- `android/app/build.gradle`: R8/`enableProguardInReleaseBuilds`, `shrinkResources`, ABI splits vs AAB, `reactNativeArchitectures` (x86 in release?), signing config sanity.
- Manifest: permissions beyond CAMERA, `allowBackup`, cleartext traffic, activity `launchMode`/`windowSoftInputMode`.
- 16 KB page alignment (Play requirement) for `frame-clock` and other native libs.
- Committed build artifacts: `modules/frame-clock/android/.gradle/` and `build/` appear present on disk — are they gitignored?
- `app.json` iOS block: `com.swingsage.spike` bundle id (known BLOCKED rename), tablet support, missing iOS perf/privacy config that will bite when `ios/` is first generated.

### E. Memory & lifecycle
- Every `useEffect` with a subscription/listener/timer: cleanup present? (Supabase `onAuthStateChange`, frame-clock subscriptions, navigation listeners, `expo-video` player release, AppState.)
- Stale-closure risk only where a concrete read path exists (skill guardrail: no speculative stale-closure findings).
- Fetch-after-unmount / setState-after-unmount in `useAnalysis`, `useSwings`, `useCorrections`, `platform/api.ts`.

### F. Architecture, conventions & contract fidelity
- Feature-folder structure, navigation typing, one-way deps (`design/` ← `features/` ← `screens/`), test placement and quality.
- `analysis.json` contract on mobile: confidence **truncated not rounded** at every gate the client re-applies; handedness (`lead_*`/`trail_*`) never derived from camera side; 49-keypoint order assumptions; corrections merged at render time, never persisted into the artifact.
- Parity drift vs the desktop player (`apps/web`) where both implement the same math — duplicated logic that can diverge.
- TS strictness escapes (`any`, `as` casts around API/artifact reads), error handling at API boundaries.

## Verification oracles available to the fix plan

- `pnpm --filter mobile typecheck` · `pnpm --filter mobile test` (jest-expo; currently the only automated oracles).
- Bundle: `npx expo export --platform android` + source-map-explorer (exact commands in the fix plan).
- Runtime: React DevTools profiler via Metro `j` on the S25+ dev build; frame-lock numbers off the on-device FrameSyncPanel (an open HANDOFF row already asks Taylor for two of these numbers).
- Release APK size: `cd android && ./gradlew :app:assembleRelease` once R8 config is in place.

## Out of scope

- The desktop web player (`apps/web`) except as the parity reference.
- The analyzer. Capture (not built yet). iOS beyond `app.json` (no `ios/` exists).
- Any code edits — this review only writes documents.

## Severity & effort scale (used in all downstream docs)

C/H/M/L per the audit skill's rubric (C = breaks a root-`CLAUDE.md` rule or will visibly break 60 fps playback; H = violates an ACTIVE decision / structural perf defect; M = suboptimal placement or missed leverage; L = polish). Effort: Quick (<30 min) / Moderate (half-day) / Large (multi-day). Every finding carries `confidence: certain | needs-profiling` — the fix plan schedules profiling before acting on the latter.
