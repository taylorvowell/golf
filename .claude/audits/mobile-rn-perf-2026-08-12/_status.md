# Status — mobile-rn-perf-2026-08-12

**Audit status:** findings + plan written; execution not started.
**Docs:** `00-REVIEW-PLAN.md` (method) · `01-FINDINGS.md` (38 findings: 0C/8H/20M/10L) · `02-FIX-PLAN.md` (8 phases) · standing rules at `.claude/rules/react-native.md`.

| Phase | Title | Status | Started | Completed | Notes |
|---|---|---|---|---|---|
| 0 | Re-baseline against the moving tree | complete | 2026-08-12 | 2026-08-12 | typecheck+239 tests green; bundle 2.7 MB; device numbers pending (phone offline) |
| 1 | Hot-path render hygiene | complete | 2026-08-12 | 2026-08-12 | all five fixes landed; checkoverlay counts identical on all 10 fixtures (461/400 at pro_3 impact) |
| 2 | Lifecycle & network (JS) | complete | 2026-08-12 | 2026-08-12 | +1 test (SWR keeps-list invariant); AsyncStorage jest mock added; decision logged in mobile-client.md |
| 3 | frame-clock native fixes | complete | 2026-08-12 | 2026-08-12 | compileDebugKotlin green; iOS twin patched unverified (no Mac); device drift re-run pending |
| 4 | Shell, startup & native config | complete | 2026-08-12 | 2026-08-12 | prebuild --clean landed everything; R8 release APK builds (77MB universal); device runtime verify pending |
| 5 | Contract & parity | complete | 2026-08-12 | 2026-08-12 | MIN_CONF single home; 5-pair tripwire (red/green-verified); model.ts unified web+mobile on mobile semantics; checkoverlay all 10 |
| 6 | Polish & a11y | complete | 2026-08-12 | 2026-08-12 | M18/M20 found already-fixed by the concurrent rebuild — verified, no change |
| 7 | Measured experiments | pending-device | 2026-08-12 | | ALL static work done; blocked solely on the S25+ (see checklist below) |

## Baselines (Phase 0 fills these)

- JS bundle size (expo export, android): **2.7 MB** Hermes bytecode (index-*.hbc, 2026-08-12, pre-fix tree)
- overlayDrift p50/p95/max, trace ON: _pending_ (open HANDOFF row covers this)
- overlayDrift p50/p95/max, trace OFF: _pending_
- Trace view count on worst fixture: measured historically at 461 (pro_3 impact) — re-read live
- Playback fps / stutters: 59.9 fps, 0 stutters (2026-08-12, pre-plan)

## Phase 7 device checklist (runs the moment the S25+ connects — Claude's to execute)

1. `cd apps/mobile && npx expo run:android` — rebuild+install the dev client (native changed in
   Phases 3–4; a JS reload is not enough). `local.properties` is already written; if gradle is
   invoked bare, `unset ANDROID_SDK_ROOT` first (ENVIRONMENT.md fault).
2. Open a swing → Metrics panel → **Overlay drift** with trace ON and OFF; run **Run 250 seeks**
   to completion. Compare against: 99.2% lock @ ~77 views (D36), seeks 100% exact (D40).
   Numbers go into `docs/CURRENT-STATE.md` §11b (closes its open item) and mark the HANDOFF row.
3. Behaviour spot-checks: home-mid-playback → return (paused, truthful, resumes); airplane-mode
   a load (resolves 'unreachable' ≤12s); deep link `adb shell am start -a android.intent.action.VIEW -d "swingsage://test"`;
   cold start (no white flash); TalkBack on the scrub bar (volume-adjust steps frames);
   3-button nav (Delete-account footer clear); release/debugOptimized build: sign-in + playback
   under R8; DeckSheet exit animation under the React Compiler.
4. Decisions to record from the numbers: keep/revert `experiments.reactCompiler`; whether H3
   part 2 (external frame store) and M2 (transform positioning) are needed at all — if drift
   holds, close both as "measured — not needed" and re-affirm D23 in the register.

## Phase 7 partial results (2026-08-12 evening device session, cut short by user)

- New dev client (all 8 commits) **installed and ran on the S25+**: played 7wood-1 with skeleton/
  trace/orient overlays, new transport, panels — the rebuilt player works end-to-end on device.
- **Native seeks: 2/2 · 100.0% exact · p95 0 · max 0. Container fps 60.00 vs 60 declared.**
- **M13 timeout verified live**: with the API unreachable the log resolved to "Cannot reach
  SwingSage" + Try again inside the timeout, instead of an indefinite spinner.
- Overlay drift: the only reading (47.1% locked · p95 143) was **polluted** — taken across
  sheet-opens, app-switches to a remote-desktop app, and stats accumulated since launch; treat as
  NOT a measurement. The clean-run protocol (reset → 12s untouched playback → read, trace on/off)
  was interrupted before completion and remains open, as do the 250-seek re-run and the React
  Compiler keep/revert decision.
- Root cause of "swings won't load": **ProtonVPN's firewall blocks phone→PC LAN** (see
  ENVIRONMENT.md). Workaround (adb reverse + localhost env) applied for the session and reverted.

## Event log

- 2026-08-12 — Review executed (13-agent workflow: 6 finders, 6 adversarial verifiers, 1 critic; 1 finding refuted). Docs written. CLAUDE.md seek-rule platform qualifier fixed in the review session itself (scope-adjacent observation #7).
- 2026-08-12 — Note for executors: the player was concurrently refactored during the review (AnalysisPanel/ComparePanel/useReport/useSeekSurface are new); re-verify every cite against HEAD before editing.
- 2026-08-12 (post-review) — Known renames from the concurrent refactor, confirmed on disk: `PhaseRibbon.tsx` → `PhaseStrip.tsx` (H1's memo-defeat chain re-lands there), `FilmstripScrubber.tsx` **deleted** (M18's second scrub surface is gone — only ScrubBar/useSeekSurface remain in scope; M3's filmstrip header capture is moot). Typecheck green at this note. The decisions register was rewritten by that refactor and the Standards entry was re-added.
