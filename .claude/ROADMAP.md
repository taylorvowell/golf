# SwingSage Roadmap — generated 2026-08-13

> Macro source of truth. Declarations live in `.claude/ROADMAP.json`; this rollup is DERIVED by `/roadmap`
> (`node scripts/roadmap/derive.mjs`). Do not hand-edit the table — re-run the script. Single-track detail:
> `/feature <name> status`.

## Arc

Platform Foundation → Core Golfer Experience → Capture & Multi-Device → Coaching Intelligence → Improvement Tracking → Coach Platform → Subscriptions & Data Governance → Launch Readiness → Future Capability

## Tracks

| Track | Phase | Goal | Progress | Current | Lifecycle | Blocked on |
|-------|-------|------|----------|---------|-----------|------------|
| platform-foundation | Platform Foundation | Close PROJECT_MAIN §44's open architecture questions, then build identity, t… | 6/10 (60%, 1 in-prog) | 04 | active | — |
| **analyzer-service** (spine) | Platform Foundation | Promote the analyzer from a hand-invoked CLI to a hosted, queue-driven worke… | 4/5 (80%) | 05 | active | — |
| media-pipeline | Platform Foundation | Get 270-330MB phone video off a device on cellular, reliably: on-device trim… | 0/0 (—) | — | planned | — |
| observability-and-slos | Platform Foundation | Define and instrument the targets that make 'production ready' falsifiable: … | 0/0 (—) | — | planned | — |
| notifications | Platform Foundation | Push and email notification infrastructure with user-manageable preferences.… | 0/0 (—) | — | planned | — |
| mobile-app-shell | Core Golfer Experience | Mobile client scaffold for iPhone and Android: navigation, auth flows, onboa… | 1/3 (33%) | 02 | active | — |
| mobile-player | Core Golfer Experience | Re-express the frame-accurate player and overlay system on mobile, plus the … | 4/4 (100%) | null | complete | — |
| swing-ingest | Core Golfer Experience | The product flow on top of the media pipeline: turn one or two uploaded vide… | 0/0 (—) | — | planned | — |
| analysis-ground-truth | Core Golfer Experience | Make the analysis falsifiable before anyone pays for it: hand-labelled event… | 0/0 (—) | — | planned | — |
| in-app-capture | Capture & Multi-Device | Record a swing inside the app at a minimum of 60fps: capability detection wi… | 0/0 (—) | — | planned | — |
| dual-device-spike | Capture & Multi-Device | Retire the §12 feasibility risk early: prove two phones can be paired, trigg… | 0/0 (—) | — | planned | — |
| dual-device-capture | Capture & Multi-Device | DIFFERENTIATOR (§12). Two logged-in phones capturing one swing: device pairi… | 0/0 (—) | — | planned | — |
| swing-style-engine | Coaching Intelligence | Style-aware analysis (§15.4): classify each golfer into one of four swing st… | 0/0 (—) | — | planned | — |
| priority-engine | Coaching Intelligence | Replace weakest-check-first ordering with a real priority model: dependencie… | 0/0 (—) | — | planned | — |
| admin-surface | Coaching Intelligence | The administrative area §31 describes, as one surface rather than scattered … | 0/0 (—) | — | planned | — |
| drill-library | Coaching Intelligence | A managed, preconfigured drill library with finding-to-drill mappings — expl… | 0/0 (—) | — | planned | — |
| ai-coach | Coaching Intelligence | A swing-aware AI Coach grounded in the golfer's own analysis, profile, goals… | 0/0 (—) | — | planned | — |
| history-and-trends | Improvement Tracking | Practice sessions, equipment inventory, trends over time, and the search/fil… | 0/0 (—) | — | planned | — |
| comparison-and-reference | Improvement Tracking | Comparison that surfaces the differences rather than showing two videos, sel… | 0/0 (—) | — | planned | — |
| launch-data | Improvement Tracking | Manually entered launch-monitor and simulator metrics attached to a swing (§… | 0/0 (—) | — | planned | — |
| goal-progression | Improvement Tracking | The assigned, measured correction loop (§16.3, D55): the AI or human coach a… | 0/5 (0%) | 01 | planned | — |
| practice-loop | Improvement Tracking | The simulator/range session experience (§8.1–8.3, §9.5) — the product's prim… | 0/0 (—) | — | planned | — |
| coach-relationships | Coach Platform | The coach directory, the golfer-initiated request/approve relationship with … | 0/0 (—) | — | planned | — |
| coach-collaboration | Coach Platform | Frame-anchored annotations and comments clearly distinguishable from AI find… | 0/0 (—) | — | planned | — |
| billing-iap | Subscriptions & Data Governance | Attach native in-app purchase to the entitlement engine built in foundation … | 0/0 (—) | — | planned | — |
| production-readiness | Subscriptions & Data Governance | Privacy, retention and deletion made real in code — including the full delet… | 0/0 (—) | — | planned | — |
| sharing-and-export | Subscriptions & Data Governance | Share a swing with controlled access, export an eligible swing with selected… | 0/0 (—) | — | planned | — |
| launch-readiness | Launch Readiness | The gate between built and shipped. Store submission for both platforms incl… | 0/0 (—) | — | planned | — |
| swing-isolation | Future Capability | FUTURE STATE (D2). Find the actual golf swing inside a long recording — reje… | 0/0 (—) | — | future | — |

## Consistency

- ✅ spine: exactly one active (analyzer-service)
- ⚠ dependency: analyzer-service has started work but its HARD dep platform-foundation is not complete
- ✅ ownership overlap: none
- ✅ lifecycle/derived: none

## Recommended next

Spine: **analyzer-service 05** (`/build`). Then the other unblocked active/planned tracks per phase order. Externally-blocked
tracks wait on their `unblockTrigger`.
