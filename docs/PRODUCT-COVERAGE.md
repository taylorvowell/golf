# Product Coverage — north star vs. what exists

Every section of [`.claude/ai-instructions/PROJECT_MAIN.md`](../.claude/ai-instructions/PROJECT_MAIN.md)
scored against the system described in [`CURRENT-STATE.md`](CURRENT-STATE.md), on **2026-08-08**.

This exists so the roadmap is built on what is genuinely missing rather than on an assumption.
It is a status map, not a plan — sequencing lives in `.claude/ROADMAP.json`.

**Every section from §2 to §41 now has exactly one owning track.** §1 is the aspirational
product-goal statement and correctly has none; §42–45 are guidance to the roadmap rather than
requirements. That mapping is verifiable — each track's `specRefs` names the sections it owns.

**Amended 2026-08-13 (D54):** the north star grew a personalization layer — §5.3 rewritten
(curated goals), §5.4 (onboarding personalization), §5.5 (advanced profile), §8.1–8.3 (session
focus and the practice loop), §9.5 (countdown + rapid re-record), §15.4 (swing styles and
style-aware scoring). New owning tracks: `swing-style-engine` and `practice-loop`. Rows below;
all ⬜.

**Legend** — ✅ built · 🟡 partial (something real exists but not what the target describes) ·
⬜ not started

---

## Headline

The product target is a **production mobile application**. What exists is a **desktop web
proof of concept of the analysis engine**.

Roughly **one section in six** has anything behind it, and almost all of that is concentrated
in one place: swing analysis, overlays, the player and scoring — sections 13–16 — which are the
hardest part of the product to get right and are substantially real. Everything that turns that
engine into an application a golfer can use on a phone (capture, upload, accounts, history,
coaching, billing, hosting) is unbuilt.

| Band | Sections | State |
|---|---|---|
| Analysis engine | 13, 14, 15, 32 | ✅ mostly real, desktop-only |
| Swing/session data model | 6, 7, 8, 21, 36 | 🟡 schema fragments, no product behavior |
| Capture & ingest | 9, 10, 11, 12 | ⬜ nothing |
| Identity & platform | 3, 4, 5, 29, 34, 37, 38, 39 | ⬜ nothing (one seeded admin user) |
| Coaching intelligence | 16, 17, 18 | 🟡 deterministic priority only; no AI, no drills |
| Comparison & reference | 19, 20 | 🟡 real compare UI, hardcoded 2-swing "pro library" |
| Coach platform | 23, 24, 25, 26, 27, 28 | ⬜ nothing |
| Commerce & admin | 30, 31, 35 | ⬜ nothing |

---

## Section by section

### 1–2. Product goal and core principles

| § | Requirement | State | Notes |
|---|---|---|---|
| 2.1 | Mobile-first (iPhone + Android) | ⬜ | The only client is a desktop-oriented Next.js web app. No mobile framework chosen. |
| 2.2 | Performance over code-sharing purity | ⬜ | No decision made; nothing shared to compromise yet. |
| 2.3 | ≥60 FPS capture, capability detection, no silent degradation | 🟡 | The *pipeline* assumes and normalizes to CFR 60 and refuses to fake frames; there is no capture path at all, so nothing detects or reports device capability. |
| 2.4 | Explainable analysis (what, why, how important, what first) | ✅ | Scorecard + per-check measured value, target band, band label, weakest-check priority, and a `fix` line. Missing only the drill and the over-time context. |
| 2.5 | Improvement over time as a core outcome | ⬜ | Every question in this section ("am I getting better?") needs history the app does not compute. |

### 3–5. Roles, auth, profiles

| § | Requirement | State | Notes |
|---|---|---|---|
| 3 | Golfer / Coach / both / admin roles | ⬜ | No role concept anywhere. |
| 4.1 | Passwordless auth on Supabase | ⬜ | No auth provider. One seeded "admin" row. |
| 4.2 | Same account on multiple phones | ⬜ | Prerequisite for §12. |
| 4.3 | Account lifecycle incl. deletion | ⬜ | |
| 4.4 | Role onboarding | ⬜ | |
| 5 | Shared + golfer profile, goals | ⬜ | Handedness exists **per swing**, not on a profile; height is not captured at all despite being named as a pose sanity-scale input. |
| 5.3 | Curated goal set (8 options, cap 2–3, each re-weighting named checks) | ⬜ | Owned by `platform-foundation` (schema) / `priority-engine` (re-weighting). |
| 5.4 | Onboarding personalization: handedness, swing style, goals, skill | ⬜ | UI is `mobile-app-shell` step 02; the style self-report seeds §15.4 classification as a prior. |
| 5.5 | Tiered advanced profile (typical miss, speed/carry, fitting, grip size, limitations, launch-monitor access, coaching-style preference) | ⬜ | Profile-managed, never onboarding. Equipment specs link to §6, not duplicated. |

> The schema does carry a real `user_id` FK on every user-scoped table from its first
> migration, so auth is a data change rather than a schema rewrite. That is the one piece of
> groundwork already in place.

### 6–8. Equipment, swing record, sessions

| § | Requirement | State | Notes |
|---|---|---|---|
| 6 | Club inventory, ball info, equipment linked to swings | 🟡 | `swings.club` is a single free string and `--club-type driver\|irons` feeds club-aware scoring bands. No inventory, no shaft/loft/lie, no ball. |
| 7.1 | A swing may hold DTL, face-on, or both | 🟡 | A swing is **one video**. Dual-view is not representable — this is a schema change, not a UI change. |
| 7.2 | Swing fields (notes, session, launch data, coach comments, analysis version) | 🟡 | Analysis, scores, findings, overlays, processing status and version exist. Notes, session, launch data and coach comments do not. |
| 7.3 | Naming/organization: favorite, tags, coach-reviewed status | ⬜ | The list sorts by score/date only. |
| 8 | Practice sessions | 🟡 | A `sessions` table exists with date/location/notes. Nothing writes it and no UI reads it. |
| 8.1–8.3 | Session focus + the practice loop (start-a-session, focus card, in-session emphasis, session summary) | ⬜ | Owned by `practice-loop`. No focus concept exists anywhere; sessions today are an empty table. |
| 8.4–8.5 | Focus training sessions (train-this-focus arc, practice quarantine, prove-it closer, focus pill/exit) + spoken feedback (pre-generated voice bank, device-TTS fallback) | ⬜ | Added 2026-08-14 (D56, D57). Nothing exists. Owning track: `practice-loop`; design in `goal-progression/DESIGN-focus-mode.md`. |

### 9–12. Capture

| § | Requirement | State |
|---|---|---|
| 9 | In-app recording, golf-shaped flow, review/retake | ⬜ |
| 9.3 | Hands-free (delay, auto-detect, remote trigger) | ⬜ |
| 9.4 | Long recordings (walk in, place ball, practice swings) | ⬜ |
| 9.5 | Countdown delay (0/5/10/15 s) + rapid re-record loop with quick feedback | ⬜ |
| 10 | Upload existing video, single and dual angle | ⬜ |
| 10.3 | Video validation with corrective guidance | 🟡 | The pipeline fails loudly on catastrophically low pose confidence and degrades gracefully on low club coverage, but there is no pre-analysis validation and no user-facing guidance. |
| 11 | Automatic swing detection inside a longer recording | 🟡 **deferred (D2)** | Event detection finds the 8 events **within a clip already known to contain one swing**. It does not segment a swing out of a long recording, does not reject non-swing motion, and cannot offer a choice between multiple swings. A materially different problem, accepted as future state — capture ships a manual trim/select fallback instead. |
| 12 | Multi-phone synchronized recording (the stated differentiator) | ⬜ | Nothing: no pairing, no coordinated start, no association, no sync playback, no partial-capture recovery. |

### 13–15. Player, overlays, analysis — **the built part**

| § | Requirement | State | Notes |
|---|---|---|---|
| 13 | Play/pause/scrub/slow/frame-step/jump to positions/full-screen | ✅ | Frame-accurate, with the exactness argued for and enforced (CFR-60 + half-frame seeks + `requestVideoFrameCallback`). |
| 13 | Switching between views, synchronized two-view playback | ⬜ | Only one view per swing exists to switch between. |
| 13 | Comparison mode | ✅ | Side-by-side pane, synced on the pinned 1 s lead-in/run-out. |
| 14 | Club-head tracing, stick figure, silhouette | 🟡 | **On the web player, ✅** — plus isolation rings, address butt line, and click-to-draw angles, with nine live trace-smoothing methods. **On mobile, the silhouette, the isolation scrim, the butt line and fit-to-golfer crop are ABSENT** and have no owning step: the scrim needs `Path2D` + even-odd fill to put its holes back, which plain `View`s cannot express. Skeleton, club, trace, orientation rods and angle arcs are drawn. Since the primary product is the phone, this row is not green until they have a home. |
| 14.1 | Correct frame, stays aligned, works during scrub | ✅ | Three independent verification gates exist for exactly this. |
| 14.1 | Respect subscription entitlements | ⬜ | No entitlement system. |
| 14.2 | Future overlays (swing plane, head/hip/shoulder movement, club path, hand path) | 🟡 | The angle catalogue and `geom` make most of these additive rather than new architecture. Not drawn today. |
| 15.1 | Overall score, category scores, findings, priority, next focus | ✅ | Real, from `coach_report.json`. |
| 15.1 | Relevant drills, historical context | ⬜ | No drill library, no history. |
| 15.2 | Internal scoring criteria, evolvable without changing the Swing record | ✅ | Versioned `scoring_config/*.json`, `scoring_model_version` on every report, Stage 8 a pure function re-runnable over old artifacts. |
| 15.3 | Confidence, uncertainty, "cannot be evaluated from this angle" | ✅ | Confidence on every keypoint/detection; `deferred` checks abstain rather than guess; view-gated checks skip; face angle refuses to fabricate degrees. This is the project's strongest existing discipline. |
| 15.4 | Swing-style classification (STY-01…04) and style-gated scoring ([REL]/[TGT]/[SWP]/[U]) | ⬜ | Owned by `swing-style-engine`. Nothing classifies styles; `scoring_config` has no style tags; classification Step 1 needs face-on markers no fixture provides yet. |

### 16–18. Coaching intelligence

| § | Requirement | State | Notes |
|---|---|---|---|
| 16.1 | Priority informed by severity, confidence, dependencies, order of operations, goals, recurrence | 🟡 | Priority today is "weakest checks, weighted". There is no dependency model, no order-of-operations ("fix setup before P6"), no goal input, no cross-swing recurrence. |
| 16.2 | Focus limits | ✅ | The narrative already emits a small fixed number of priorities. |
| 16.3 | Focus goals and progression — assigned (AI/coach/self), bound to measured checks, max 3, windowed-evidence progress on after-swing + home, celebrated once, maintained after | ⬜ | Added 2026-08-13 (D55). Brand-new system; nothing exists. Owning track: `goal-progression`. |
| 16.3.7 | The Focus page — browsable area catalog (area = goal template viewed through measured performance), per-area averages + windowed trend arrows, area detail with focus-scoped pro comparison, train-this-focus entry | ⬜ | Added 2026-08-14 (D56). Nothing exists. Owning track: `goal-progression` (comparison scope: `comparison-and-reference`; log rendering: `history-and-trends`). |
| 17 | AI Coach — swing-aware conversation, personalized context, scoped to swing/session/history/plan | ⬜ | Nothing. No provider abstraction, no prompts, no conversation storage. |
| 18 | Preconfigured drill library, findings→drills mapping, admin-managed | ⬜ | Each check carries a one-line `fix` string. That is not a drill library. |
| 18.1–18.4 | Guided drills — per-drill check spec (hold/trigger), pose-only drill analysis mode, "Check my form" rep loop, coach roll-up, metric quarantine | ⬜ | Added 2026-08-17 (D59). Nothing exists; needs a new analyzer mode and a new fixture class (no current fixture is drill footage). Owning track: `drill-library`. |
| 18.5 | Coach-authored drills — one drill model with an authorship dimension, always plain class, "marked done" self-report labelled as such | ⬜ | Added 2026-08-18 (D60). Owning tracks: `drill-library` (schema/RLS), `coach-video-lessons` (authoring UI + demo transcode). |

### 19–22. Comparison, reference library, history, launch data

| § | Requirement | State | Notes |
|---|---|---|---|
| 19.1 | Compare against previous / same-club / selected / best swing | 🟡 | The compare *mechanism* is real; the selection logic ("most recent with this club", "best") is not. |
| 19.2/20 | Professional reference library, admin-managed, tier-gated | 🟡 | `proSwings.ts` is a hardcoded 2-entry list pointing at local fixture files. No pro profiles, no admin, no tiering. |
| 19.4 | Make differences clear rather than showing two videos | ⬜ | Today it shows two videos. |
| 21.1 | Browse/search/filter/favorites/coach-reviewed/delete | 🟡 | A sortable list exists. No search, filter, favorites, or delete. |
| 21.2/21.3 | Historical improvement and trends | 🟡 | The mobile Progress screen (Ideal Swing design-system step 08) computes real 30-day aggregates from the swing list — session/swing counts, best, session-average net gain, a then-vs-now compare of real swings. The coaching layer on it (priorities, category trends, coach note) is flagged placeholder content behind a `ProgressViewModel` seam that `priority-engine`/`goal-progression` fill; no per-category trend is computed yet. |
| 22 | Manually entered launch/simulator data | ⬜ | No fields, no UI, no storage. Owned by the `launch-data` track — and note it is the only authoritative source of face-angle degrees, which video never provides. |

### 23–28. Coach platform

| § | Requirement | State |
|---|---|---|
| 23 | Coach directory, listings, discovery | ⬜ |
| 24 | Golfer↔coach relationship, request/approve, revocable, access boundaries | ⬜ |
| 25 | Coach workspace, roster, golfer detail, swing review, review-request queue (D60) | ⬜ |
| 26 | Comments and frame-anchored video annotations, distinguishable from AI findings | ⬜ |
| 26.4 | Recorded video lessons — telestration + voice as an event-log artifact replayed by re-driving the player, transcripts, delivered-content persistence | ⬜ |
| 27 | Messaging as one conversation feed — typed immutable entries, lesson/review/drill cards as views over one log, report/block (D60) | ⬜ |
| 28 | Coach-created improvement plans, AI aware of the active plan | ⬜ |

> The player's existing hand-correction tools (`head_markers`, `swing_stages`) are the closest
> analogue to frame-anchored annotation and prove the interaction pattern works, but they are
> analyst tools, not coach-facing annotation.

### 29–31. Notifications, subscriptions, admin

| § | Requirement | State | Notes |
|---|---|---|---|
| 29 | Golfer + coach notifications, user-manageable preferences | ⬜ | Infrastructure is a foundation-phase track (`notifications`), because "swing analysis completed" is needed the moment analysis becomes async — not in the coach phase where the rest of §29 lives. |
| 30 | Four tiers (Free/Pro/Coach Standard/Coach Pro) | ⬜ | Billing is native in-app purchase; Stripe removed (D1). |
| 30.1 | Entitlement system, not per-screen hard-coding | ⬜ | Named explicitly as an architecture requirement, so it should exist before the features it gates. |
| 30 | Compatible with iOS/Android distribution requirements | ⬜ | Conflict resolved by D1 — satisfied by using StoreKit / Play Billing. |
| 31 | Admin: pro swings, drill library, scoring configuration, entitlements, coach admin | 🟡 | Scoring configuration is already file-versioned and admin-editable *in principle* (`scoring_config/*.json` + `build_config.py`), which is most of §31.3's intent. No admin UI, and nothing else in §31 exists. |

### 32–38. Operations, privacy, scale

| § | Requirement | State | Notes |
|---|---|---|---|
| 32 | Clear processing states, leave and return, no repeat uploads | ✅ | A real job protocol with per-stage progress, durable in Postgres, and orphan-job settlement. Built for one local worker, not for many users. |
| 33 | Failure handling and recovery | 🟡 | Analysis-side degradation is genuinely good (quality gates degrade rather than crash). Every device/network/interruption case is unaddressed because there is no device or network path. |
| 34 | Privacy, permissions, retention, deletion | ⬜ | No policy, no deletion path, no visibility controls. |
| 35 | Sharing and export | ⬜ | Owned by the `sharing-and-export` track; tier-gated, and never public unless the golfer chose it (§34.4). |
| 36 | Search, filtering, organization | 🟡 | Sort only. |
| 37 | Product analytics | ⬜ | Owned by `observability-and-slos` in the foundation phase, live from the first deployed environment rather than after five phases of features. |
| 38 | Production readiness and scale | ⬜ | Local Docker Postgres, local disk media, hand-invoked CLI analyzer. Nothing is deployed. Split across `analyzer-service` (capacity model, fair queuing), `observability-and-slos` (targets and telemetry) and `production-readiness` (retention, load testing). |
| 39 | Supabase, Upstash, Railway, Infisical, Azure | ⬜ | None wired. Current stack is local Postgres via Drizzle + local disk. Stripe struck from the list by D1. |

---

## What carries forward, and what does not

**Carries forward largely intact — this is the asset.**
The analyzer (`services/analyzer/swingsage/`) is a self-contained Python pipeline whose only
output is JSON artifacts. It does not care what client renders it or where it runs. Moving it
behind a queue on a host changes its invocation, not its internals. The same is true of the
scoring config, the debug tooling, the test suite, and the `analysis.json` contract itself.

**Carries forward as logic, not as code.**
The player's overlay rendering, frame-sync math and trace smoothing encode hard-won correctness
(the half-frame seek, endpoint-exact smoothing, never interpolating a gap). On a mobile client
that logic must be re-expressed against a different video API — the rules survive, the React
components may not.

**Does not carry forward.**
The single-seeded-admin data model, local-disk media, the hand-invoked CLI as the only ingest
path, and the desktop-first workspace layout. These are proof-of-concept scaffolding, and
`PROJECT_MAIN.md` §38 rules them out explicitly.

---

## Conflicts — two resolved, one standing

Three things in `PROJECT_MAIN.md` could not be built as literally stated. Two are now closed.

1. **Stripe vs. app-store billing (§30) — RESOLVED 2026-08-08 (`docs/decisions/` D1).**
   The doc required Stripe *and* compatibility with iOS/Android distribution rules, which both
   mandate native in-app purchase for digital subscriptions. Resolved in favour of the
   distribution requirement: **billing is StoreKit and Google Play Billing, and Stripe is
   removed from the stack.** Entitlement is fed by store transactions with server-side receipt
   validation, and stays authoritative on our server so admin-granted access works without a
   store transaction. §30 and §39 carry amendment notes.

2. **"Automatic swing detection" (§11) — RESOLVED as future state (`docs/decisions/` D2).**
   §11 segments a swing out of arbitrary footage; the existing event detection locates 8 events
   inside a clip already known to be a swing. These are different problems, and the second does
   not satisfy the first. §11 is accepted as a future-state feature and moved to the Future
   Capability phase. **The live consequence:** §9.3 hands-free and §9.4 long-recording capture
   must ship with a manual trim/select fallback, which the `in-app-capture` track owns. Without
   it, a hands-free recording produces a clip the analyzer cannot use.

3. **§43 lists 40+ product decisions still open** — tier limits, retention windows, one coach
   or many, whether audio is recorded, what a "best swing" is, and so on. They do not all need
   answering now, but each blocks a specific track and should be answered at that track's start
   rather than assumed mid-build.

Additionally, §44 explicitly leaves the mobile framework, storage, queue, API design and
infrastructure topology to the roadmap. Those are the first architectural decisions to take,
and they gate everything else.

---

## Platform gaps, and where they went

An architecture review on 2026-08-08 found that the requirement coverage above was sound but
the **platform** underneath it was not — API versioning, a generated shared schema, an
entitlement seam ahead of the features it gates, a real media pipeline, SLOs, telemetry, push,
and a client test strategy were all missing or scheduled too late to be anything but a retrofit.
Because a native app cannot be force-updated, several of those get permanently more expensive
after the first store release.

The roadmap was restructured accordingly: the spine grew to 10 steps and the foundation phase
gained four parallel tracks. Full finding-by-finding reasoning and consequences are in
[`decisions/`](decisions/) **D3**.
