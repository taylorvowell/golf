# Mobile RN Performance & Architecture Review — Fix Plan

**For:** an AI coder executing with no prior context. Read `01-FINDINGS.md` first — finding IDs (H1…L10) refer to it. Track progress in `_status.md`. One phase per session is the preferred cadence; each phase is independently executable and leaves the tree green.

**Global rules for every phase (non-negotiable):**
1. **The tree is being concurrently refactored** (player files are growing). Before editing any cited file, re-locate the cite against HEAD; if a finding's code has materially changed or moved, re-verify the finding still holds before fixing, and note what changed in `_status.md`.
2. Never hand-edit `apps/mobile/android/**` — it is CNG prebuild output. Every native-config change goes through `app.json` / config plugins, then `npx expo prebuild -p android --clean`.
3. Verification for every phase starts with: `pnpm --filter mobile typecheck && pnpm --filter mobile test`. Phases that touch overlay math also run `npx tsx scripts/checkoverlay.ts` (Gate 3 parity against the analyzer burn-in).
4. Any decision made while executing (a threshold, a pattern, a dependency, a deliberate deviation) is edited into `docs/decisions/mobile-client.md` **in the same session** — present tense, edit-in-place.
5. Do not "fix" anything in the findings doc's **What is already right** section, and never touch the refuted CAMERA permission.
6. On-device measurement uses the shipped instrument: FrameSyncPanel (dev build, RUNBOOK §11–12b) — overlayDrift p50/p95/max, trace view count, Run-250-seeks. Record numbers in `_status.md` before/after any hot-path phase.

---

## Phase 0 — Re-baseline against the moving tree
`Effort: Quick · no code changes`

**Goal:** pin what "before" is, so every later phase's claim of improvement is measured, not asserted.

1. `git log --oneline -5` + `git status` — record what the concurrent player refactor has landed since 2026-08-12.
2. `pnpm --filter mobile typecheck && pnpm --filter mobile test` — must be green before anything else; if red, stop and report (it is the concurrent refactor's to fix, not this plan's).
3. Bundle baseline: `cd apps/mobile && npx expo export --platform android` and record the output JS bundle size in `_status.md`.
4. Device baseline (requires the S25+, which also satisfies the **already-open HANDOFF row** "Read the overlay's frame-lock off the S25+"): with the dev build, open a swing → Sync panel → record overlayDrift p50/p95/max **with trace on and off**, trace view count, and playback fps. If the phone is not connected, record "device baseline pending" and continue — only Phase 7 hard-depends on it.

**Verification:** `_status.md` contains the four baseline numbers (or "pending" for device ones).

---

## Phase 1 — Hot-path render hygiene (the 60 Hz tree)
`Effort: Moderate · Findings: H1, H2, M4, M14, H3(part 1) · all JS, no rebuild`

Order within the phase matters — H1 first, it is load-bearing for H3's split:

1. **H1:** In `useFramePlayer`, mirror `presented`/`target` into refs (the file's own `playingRef` idiom); `play()`/`step()` read the refs; dep arrays shrink accordingly.
2. **M14:** Move the render-phase mirror writes (`boundsRef`, `playingRef`, `loopingRef`) into effects exactly as web `usePlayer.ts:132–143` does; sweep `ScrubBar.tsx` and `useSeekSurface.ts` mirrors in the same pass.
3. **H3 part 1:** Split PlayerConsole's memo boundary — a frame-hot strip (playhead + badge + time row + ScrubBar host) taking `frame` as a primitive; the dock takes only primitives + the now-stable `actions`. Do not restructure state ownership yet (that is Phase 7, measurement-gated).
4. **M4:** Hoist the Overlays-sheet content into a `useMemo` keyed on `[analysis, toggles, onToggle, angles]`; `memo(OverlayControls)`.
5. **H2:** Split TraceLayer's memo: per-piece scaled+simplified+dashed output keyed on `[pieces, sx, sy, peak]`; per-frame recompute only the piece containing the playhead; `frame` out of the deps when `grow` is false. Preserve exact output — `checkoverlay.ts` is the oracle.

**Verification:** typecheck + tests + `checkoverlay.ts` (all ten fixtures must still land on the burn-in). Then on device: re-read overlayDrift with trace on; the number must be ≤ baseline. **Manual check:** scrub and play a swing on the S25+ — the trace must look identical, the console must feel unchanged.
**Decisions to log:** none expected (pure mechanics), unless TraceLayer's split changes any drawn output — then stop and re-read the finding, because it must not.

---

## Phase 2 — Lifecycle & network correctness (JS)
`Effort: Moderate · Findings: H4, H6, M12, M13, M3(JS side), L4, L5`

1. **H6:** AppState effect in `useFramePlayer` (or SwingPlayer): non-`active` → `pause()`; optionally resume-if-was-playing on `active`; cleanup the listener.
2. **M13:** ApiClient per-request timeout via AbortController (~12 s default, overridable per call), mapped to a typed `ApiClientError` code `'timeout'` classified as 'unreachable'.
3. **M12 + L4:** AbortController through `useAnalysis`, `useCorrections`, `useSwings` (this also supplies useSwings' missing unmount guard); abort in cleanup; swallow AbortError. Do **not** touch `useMediaSource` — it makes no network request.
4. **H4:** Module-level SWR cache in `useSwings`: store the last `ok` list response; `useSwing` seeds synchronously and revalidates in background. SwingDetailScreen then mounts the player on first render for any swing reached from the log.
5. **M3 (JS side):** One shared authed-media-source hook (video, SwingCard thumbnail, filmstrip) that re-resolves headers on `onAuthStateChange` TOKEN_REFRESHED. Ship it behind the existing prop surfaces; the native half lands in Phase 3 — until then a header change restarts playback, which is why the two phases are adjacent.
6. **L5:** `runSeekSweep` bails when `ref.current` is null or a cancelled ref is set on unmount.

**Verification:** typecheck + tests. **Manual check** on the S25+: (a) open a swing, press home mid-playback → return: playback paused, state truthful; (b) open a swing from the log — the video/analysis requests must start without the list round trip (watch Metro network log or the dev-client inspector); (c) airplane-mode a load → the spinner resolves to 'unreachable' within the timeout.
**Decisions to log:** the SWR cache pattern for server state (edit the register's data-fetch entry, or add one under Mobile Client) and the timeout default.

---

## Phase 3 — frame-clock native module correctness
`Effort: Moderate · Findings: M1, M11, L6, M3(native side) · Kotlin; requires dev-client rebuild + device`

1. **M1:** Synchronize FrameStats internally (same lock pattern as `scheduleLock`/`pendingLock`).
2. **M11:** `onScreenFrame()` re-inserts the original `(frame, displayAtNs)` pair instead of `(frame, now)`.
3. **L6:** `release()`: set `emitFrames = false`, then `main.removeCallbacksAndMessages(null)`, then `player?.release()`.
4. **M3 (native side):** header-only path in `applySource`: when `sourceUri` is unchanged and only `sourceHeaders` differ, call `httpFactory.setDefaultRequestProperties(sourceHeaders)` and return **without** `setMediaItem`/`prepare` — token rotation must never restart playback.
5. Mirror the same four changes into the iOS Swift twin **only where the same structure exists** (FrameClockView.swift is untestable here — no Mac; keep the diff minimal and note it in `_status.md` as unverified-on-iOS).

**Verification:** `pnpm --filter mobile android` builds and installs; on the S25+: play a swing (drift numbers sane vs baseline), run the 250-seek sweep to completion, and confirm stats read mid-playback never crashes (M1's race). **Manual check:** while the player is open, force a token refresh if practical (or simulate by toggling headers in dev) — playback must not restart.
**Decisions to log:** none; these are bug fixes inside an existing decision (D50's surface).

---

## Phase 4 — App shell, startup & native config (one prebuild covers all)
`Effort: Moderate–Large · Findings: H5, H7, M5(enable), M6, M7, M8, M9, M10, L1, L2, L8, L9`

JS half:
1. **H5:** VersionGate above the navigator: fire `api.clientConfig()` once on mount (parallel with session restore, non-blocking); `isUpgradeRequired` → `<UpgradeRequiredScreen/>`; also branch on `isUpgradeRequired` before the 401 check in `useSwings`.
2. **H7:** Root class ErrorBoundary wrapping NavigationContainer (fallback in `COLORS.bg`, retry) + a narrow boundary around `SwingOverlay` degrading to plain playback with an "overlays unavailable" notice.
3. **L1 + L8:** Remove `react-dom`, the `web` script, app.json's web block, and `test-renderer`; `pnpm i`; tests must stay green.

Config half (edit app.json only, then ONE `npx expo prebuild -p android --clean`):
4. **M6:** Remove `expo-video` from dependencies and plugins; update frame-clock's media3 pin comment to self-owned.
5. **M7 + L9:** Declare the splash properly (expo-splash-screen, `backgroundColor "#080a0d"`, icon) and set `android.adaptiveIcon.backgroundColor` to the brand ground; fix the stale MainActivity comment claim by regenerating; the dead `splashscreen_background` color + drawable pair disappears with the regen.
6. **M8:** `expo-build-properties` with `enableProguardInReleaseBuilds: true`, `enableShrinkResourcesInReleaseBuilds: true`.
7. **M9:** `"allowBackup": false` (first-class android field).
8. **L2:** `android.blockedPermissions: ["android.permission.SYSTEM_ALERT_WINDOW"]`.
9. **M10:** the `--clean` prebuild itself lands the `swingsage://` scheme; add the RUNBOOK line ("any app.json native-config change requires `prebuild --clean` before the next run").
10. **M5:** `"experiments": { "reactCompiler": true }` — an *experiment*: measured in Phase 7, reverted there if it regresses.

**Verification:** prebuild succeeds; `pnpm --filter mobile android` installs; regenerated manifest shows `allowBackup="false"`, no SYSTEM_ALERT_WINDOW, both schemes; a `debugOptimized` (or release) build completes with R8 on and **sign-in + swing playback work on the S25+** (keep-rule failures surface here — fix with targeted keep rules, never by turning R8 back off). `adb shell am start` the scheme to confirm the deep link opens the app.
**Manual check:** cold-start the app — the pre-RN frame must be `#080a0d`, no white flash; force a 426 by lowering the server floor locally (or stub) — the upgrade screen must render.
**Decisions to log:** expo-video removal (edit its register entry), R8-on-at-launch, allowBackup=false, splash ownership via app.json. **HANDOFF:** none new — but note the H8 rename (existing BLOCKED row) is cheapest before the OAuth/R8 state accretes further.

---

## Phase 5 — Contract & parity hardening
`Effort: Moderate · Findings: M15, M16, M17, L3 · touches packages/schema and apps/web`

1. **M15:** Export `MIN_CONF = 0.35` from `packages/schema/src/contract.ts` (comment: metrics.py:35 is the producing twin); import at mobile geometry.ts + ClubLayer.tsx (delete `WEAK_CONF`), web angleOverlay.ts + swingSync.ts + SwingStage.tsx:769. Optional: a schema test parsing metrics.py's value.
2. **M16:** Jest byte-equality tripwire over the four VERBATIM pairs (mobile header stripped); fix the dangling "D51" pointers to name `docs/decisions/mobile-client.md`'s entry; raise the third-consumer question in that entry.
3. **M17:** Extract web SwingStage's spans/re-cut/orientHold into `apps/web/src/lib` files matching mobile `model.ts` function-for-function; reconcile the three behavioural deltas deliberately (ordering clamp, `pts[i]` guard, partial-vs-full overrides — the last is partly type-driven) and record which side was right; add the new pairs to the tripwire.
4. **L3:** app.json `ios.infoPlist` usage strings deferred to the capture track **by decision**; decide `supportsTablet` now (recommend `false` unless iPad is in launch scope) and record it.

**Verification:** mobile typecheck+tests, `pnpm --filter web exec tsc --noEmit && pnpm --filter web lint`, `checkoverlay.ts`, and the new tripwire test red/green-tested by deliberately touching one copy (then reverting).
**Decisions to log:** MIN_CONF's single home; the M17 reconciliation outcomes; supportsTablet.

---

## Phase 6 — Polish & accessibility
`Effort: Quick–Moderate · Findings: M18, M19, M20, L7, L10`

1. **M18:** Scrub surfaces: `accessibilityRole="adjustable"`, `accessibilityValue {min,max,now}`, increment/decrement → `onSeek(frame±1)`; second surface `importantForAccessibility="no-hide-descendants"`.
2. **M19:** SwingLogScreen `paddingBottom: 32 + insets.bottom`.
3. **M20:** DeckSheet → `useWindowDimensions()`.
4. **L7:** glassCap → `DECK.glass.hairline` or a named `hairlineStrong`; notice colours derived from tokens.
5. **L10:** AccountBar `paddingRight: __DEV__ ? 56 : 0`.

**Verification:** typecheck + tests (the jest safe-area mock's phone-shaped insets make M19 assertable in CI). **Manual check:** TalkBack on the S25+ — focus the scrub bar, use volume-adjust gestures to step frames; 3-button nav mode — the Delete-account footer must clear the system bar.
**Decisions to log:** none.

---

## Phase 7 — Measurement-gated experiments (do NOT execute unconditionally)
`Effort: Large if triggered · Findings: H3(part 2), M2, M5(decision) · hard-requires the S25+`

Preconditions: Phases 1 and 4 landed; device baseline and post-Phase-1 numbers recorded.

1. Re-measure with the shipped instrument: overlayDrift p50/p95/max with trace on, at 1× and ¼×, on the longest fixture; playback fps; scrub feel. **This closes CURRENT-STATE §11b's open item** ("frame-lock with the trace on is unmeasured") — write the numbers into `docs/CURRENT-STATE.md` §11b and mark the HANDOFF row DONE if Taylor read them, or read them via adb yourself.
2. **React Compiler (M5) decision:** compare before/after enabling; keep or revert `experiments.reactCompiler`; record the decision with numbers.
3. **H3 part 2** (external store for `frame` + leaf subscriptions) **only if** p95 with trace+chrome misses the lock target after Phases 1+4.
4. **M2** (transforms over layout props) **only if** H3 part 2 still leaves a measurable gap — and only on the nodes that actually move per frame.
5. If all numbers hold: close this phase as **"measured — no further work needed"**, update §11b, and record in the register that the plain-View overlay remains the approved architecture at current view counts (re-affirming, not re-litigating, the D23 decision).

**Verification:** the numbers themselves, written down. A phase that ends "nothing needed, here is the proof" is a success, not a failure.
**Decisions to log:** every branch of this phase ends in a register edit.

---

## Sequencing summary

| Phase | Theme | Depends on | Device needed |
|---|---|---|---|
| 0 | Baseline | — | optional |
| 1 | Hot-path render hygiene | 0 | verify only |
| 2 | Lifecycle & network (JS) | 0 | verify only |
| 3 | frame-clock native fixes | 2 (M3 pairing) | **yes** (rebuild) |
| 4 | Shell, startup, native config | 0 | **yes** (rebuild) |
| 5 | Contract & parity | 0 | no |
| 6 | Polish & a11y | 0 | verify only |
| 7 | Measured experiments | 1 + 4 | **yes** |

Phases 1, 2, 5, 6 are pure JS and can interleave with the concurrent player refactor; 3 and 4 each cost one dev-client rebuild (batch them if convenient). 7 is decision-making, not backlog — it may legitimately close with zero code changes.

## Tech debt introduced by this plan

- The M3 shared media-source hook adds one abstraction (a source-with-refresh hook) where three ad-hoc fetches exist today — net simplification, but it must not grow beyond auth-header refresh.
- The M16/M17 tripwire tests institutionalize the duplication they guard until the third-consumer extraction happens; that is the documented decision's own trade, made visible rather than new.
- Phase 4's expo-build-properties plugin is one more config plugin to carry; it is the CNG-correct mechanism, not a shortcut.
- Otherwise the plan is removal, consolidation and bug-fixing — no new dependencies beyond expo-splash-screen/expo-build-properties (both first-party Expo).
