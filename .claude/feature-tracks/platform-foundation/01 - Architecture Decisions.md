# 01 - Architecture Decisions

**Phase:** Platform Foundation
**Status:** not-started
**Estimated effort:** 1–2 days

## Overview

`PROJECT_MAIN.md` §44 explicitly refuses to prescribe the mobile framework, camera stack, video
transport, device-to-device protocol, AI provider, queue, cache, database schema, API design,
infrastructure topology, storage provider, monitoring or CI — "those should be decided by the
technical roadmap". This step is that decision, written down once so steps 02–08 and every
later track build against a settled answer instead of re-litigating it.

It produces decisions and a thin proving skeleton, **not** features. Nothing here ships user
value; everything after it does.

One of these is genuinely hard and must not be waved through:

- **The mobile client.** §2.2 states performance beats code-sharing purity, and §2.3 makes
  ≥60 fps capture non-negotiable. A framework choice that cannot hit 60 fps capture and
  smooth overlay rendering on mid-range Android fails the product, not just the code.

**Already decided — do not reopen:** billing is native in-app purchase and Stripe is dropped
(`docs/DECISIONS.md` D1), and automatic swing detection is deferred to a future phase
(D2). Both were live conflicts when this file was written and are now closed.

## Dependencies

None — this is the first step of the spine.

## Architectural Context

- North star: `.claude/ai-instructions/PROJECT_MAIN.md`, especially §2 (principles),
  §38 (production readiness), §39 (required/preferred technologies), §44 (what is *not*
  prescribed).
- Current system: `docs/CURRENT-STATE.md`. The analyzer is a self-contained Python pipeline
  whose only output is JSON artifacts — it does not care what renders them or where it runs.
  That property is why it survives this pivot and should be preserved, not designed away.
- Gap being closed: `docs/PRODUCT-COVERAGE.md`.
- §39 names Supabase, Upstash, Railway, Infisical and Azure-preferred (Stripe was removed by
  D1). These are *given*, not open — but §39 also says a preferred technology must not be
  preserved at the expense of a non-negotiable capability. If one of them blocks 60 fps
  capture, reliable camera access, accurate overlays or multi-device sync, that is a finding to
  surface, not a constraint to silently break.

## Files & Areas Touched

- `docs/DECISIONS.md` — one numbered entry per decision below (this is the real deliverable)
- `docs/ARCHITECTURE.md` — new: the resulting system diagram and component boundaries
- `apps/mobile/` — created only far enough to prove the framework choice on a real device
- `infra/` — created only far enough to hold environment/topology declarations

## Steps

1. **Re-read the north star before deciding anything.** §2, §12, §38, §39, §40, §44.
   Sections 12 (multi-phone sync) and 40 (device compatibility) constrain the client choice
   more than anything in §2 does — decide the client with them in view, not after.
2. **Decide the mobile client**, and record why. Evaluate against, in priority order:
   sustained ≥60 fps capture on mid-range Android; frame-accurate playback and scrubbing with
   a canvas/GPU overlay on top; access to native camera APIs when the cross-platform layer is
   insufficient; ability to reuse the existing TypeScript rendering logic; and multi-device
   coordination later. Prove the top candidate on a real device before committing (step 2's
   spike), not from documentation alone.
3. **Decide what the existing Next.js app becomes.** The realistic answer is that it stops
   being the golfer surface and becomes the coach workspace + admin + marketing/billing web
   surface, and that the golfer player is re-expressed on mobile. Say so explicitly, because
   several later tracks (`coach-relationships`, `drill-library`, `entitlements-and-billing`)
   assume a web surface exists.
4. **Decide the data platform.** Supabase is required (§4.1) and is Postgres, so the existing
   Drizzle schema and migrations can move rather than be rewritten. Decide explicitly: does
   Drizzle stay as the query layer, or does the app move to Supabase's client? Decide where
   row-level security sits, because §24.3 and §34.2 make coach access a data-access boundary,
   not a UI check.
5. **Decide media storage and transport.** Object storage replacing local disk; direct-to-
   storage upload from the device vs. proxying through the API; how the analyzer reads input
   and writes artifacts; CDN/signed-URL strategy for video playback. §38 requires no
   unnecessary reprocessing, so artifact addressing must be stable and cacheable.
6. **Decide the analysis queue and worker topology.** Upstash is named (§39); Railway is named
   for hosting. Decide how a job is enqueued, how progress reaches the client, and how one
   user's workload is prevented from degrading everyone else's (§38 states this explicitly).
   The existing job protocol (stage/progress_pct/message, durable in Postgres) is a working
   contract — decide whether it survives the network boundary or is replaced.
7. **Decide secrets and environments.** Infisical is named. Define the environment set (local,
   preview, production) and how the analyzer, the API and the mobile app each obtain config.
7a. **Decide the offline model.** Recording happens where signal is worst — a driving range, a
   course. Decide whether the client is offline-first with a local store and sync, or
   online-required with a queued upload, and what a golfer sees when they record five swings
   with no connection. Retrofitting offline into a shipped client is a rewrite, which is why
   this is a step-01 decision rather than a `media-pipeline` discovery.
7b. **Decide the mobile release pipeline.** Store submission, review latency, staged rollout,
   whether over-the-air JS updates are used and what that means for the minimum-supported-client
   policy in step 07, plus crash reporting. A web deploy story does not cover shipping a binary
   through two store review processes.
7c. **Set the SLOs.** Numeric targets for analysis latency (p95), upload success rate,
   crash-free session rate and analysis failure rate. §38's expectations are qualitative, and
   without numbers "production ready" is unfalsifiable — the same failure mode as tuning club
   tracking on smoothness because no position-error metric existed. `observability-and-slos`
   instruments these; this step decides them.
7d. **Decide the AI data-processing position.** Which golfer data may reach a model vendor
   (§17.2 wants profile, goals, history, equipment), whether it may be retained or trained on,
   and how user-authored free text — notes, goals, messages — is handled given it flows into
   prompts. `ai-coach` implements against this; it must not invent it.
7e. **Decide the deletion cascade.** §4.3 promises users understand what deletion removes and
   §34 makes retention tier-driven. Decide now what an account deletion must reach: object
   storage, derived artifacts, AI conversation history, coach-visible copies, analytics. Every
   later track that creates user data inherits an obligation from this decision, so it has to
   exist before those tracks do.
8. **Fix the entitlement seam implied by D1.** Billing is native in-app purchase, so decide
   where receipt validation lives, how store subscription state maps onto our own entitlement
   record, and how admin-granted complimentary access works without a store transaction.
   Entitlement must stay authoritative server-side — the app never trusts a client-reported
   purchase. Do **not** re-litigate the Stripe question; D1 closed it.
9. **Decide the AI provider abstraction boundary** — not the model. §44 leaves the model open
   and §17 requires the AI Coach be grounded in the golfer's own data. Fix the seam now so
   `ai-coach` is not the track that invents it.
10. **Write `docs/ARCHITECTURE.md`** — the component map, the boundaries between mobile client,
    API, analyzer worker, storage and database, and the request/data flow for the one path that
    matters most: a golfer records a swing and sees its analysis.
11. **Append one `docs/DECISIONS.md` entry per decision above**, in the file's own format, each
    with Context / Decision / Alternatives / Consequences and a `Status:` line.
12. **Surface anything §39 forces that conflicts with a non-negotiable capability.** Do not
    quietly absorb it.

## Quality Standards

- Every decision above appears in `docs/DECISIONS.md` with a real *Alternatives* section. An
  entry with no alternative considered is not a decision, it is a default.
- No decision is recorded on documentation alone where a measurement was possible — the client
  choice in particular is proven on hardware in step 02, and this file is amended if the spike
  contradicts it.
- `docs/ARCHITECTURE.md` describes the target, and says plainly which parts are not built yet,
  in the same style as `docs/CURRENT-STATE.md`.
- Nothing in `services/analyzer/swingsage/` changes. If a decision seems to require editing the
  pipeline's internals, the boundary is wrong.

## Verification

Documentation-and-decision step; the objective oracles must still pass unchanged, because
nothing here should touch running code:

```
cd services/analyzer && .venv\Scripts\python.exe -m pytest tests
pnpm --filter web exec tsc --noEmit && pnpm --filter web lint
```

Report to the user (do not block on it — decide, log, proceed):

- Summarise each decision and its alternative. Several (client framework, billing model) are
  product decisions as much as technical ones and are expensive to reverse, so they should be
  visible even though the build does not wait on approval.
- State whether the §39-vs-capability check produced "no conflict" or a named conflict.

## Definition of Done

- [ ] `docs/DECISIONS.md` contains a numbered, `Status:`-marked entry for each of: mobile
      client, role of the existing web app, data platform + RLS boundary, media storage and
      transport, queue and worker topology, secrets/environments, the IAP entitlement seam,
      AI provider seam, offline model, mobile release pipeline, SLO targets, AI
      data-processing position, deletion cascade.
- [ ] `docs/ARCHITECTURE.md` exists and covers the record-a-swing-to-analysis path end to end.
- [ ] `services/analyzer/` is untouched: `git diff --stat services/analyzer/swingsage` is empty.
- [ ] Both oracle commands above pass.
- [ ] The decision set has been reported to the user.

## Notes

Resist scaffolding beyond what proves a decision. The failure mode for a step like this is
building a large empty skeleton against an unproven choice; the second failure mode is deciding
nothing and letting each later track improvise. The output is decisions plus the minimum code
that shows they hold.

`PROJECT_MAIN.md` §43 lists 40+ *product* decisions still open (tier limits, retention windows,
one coach or many, whether audio is recorded). Those are deliberately **not** in scope here —
each belongs to the track that needs it, answered at that track's start. Do not answer them
speculatively now.
