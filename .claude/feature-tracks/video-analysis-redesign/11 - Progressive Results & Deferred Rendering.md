# 11 - Progressive Results & Deferred Rendering

**Phase:** Delivery
**Status:** not-started
**Estimated effort:** 2 sessions

## Overview

**Objective:** the golfer sees useful output sooner without the analysis waiting on
presentation media (plan D8, WP-034..036): `analysis_ready` stops including overlay burn-in
and contact-sheet rendering; progressive partial results land as staged writes of the SAME
artifact family (C3 ruling — no second format).

**Current state:** render (overlay.mp4 + contact.jpg) runs inside the critical path — the
2026-08-26 incident's timeout death happened AT the render stage; a single terminal artifact
flips status ready; clients poll and then fetch everything. The video itself is already
watchable pre-analysis (video route falls back to the uploaded original), and the poster
route already provides pre-analysis thumbnails — the plan's "video-only immediately"
milestone exists.

**Target state:** analysis_ready = geometry/events/metrics/scores final (status flips, score
syncs, client renders overlay from JSON as it already does); presentation render runs after,
updating artifacts without touching readiness; optional coarse/body partials
(`analysis.partial.json` revisions with `partial: true`, `complete_stages`) served to clients
that ask, replaced atomically per stage.

## Dependencies

- Steps 05 (stage spans measure the win), 07 (coarse pass exists to emit early output).
- Step 08 (final scores need provenance gates before they're published as final).

## Architectural Context

Matrix rows 15–16; C3. The job state machine grows states (coarse_ready → analysis_ready →
presentation_rendering → complete) — additive to the jobs table's string stage + view status.
Client scope here is MINIMAL: mobile AnalyzingBar already walks stages; rendering provisional
skeletons (WP-035's full scope) is client-track work — this step delivers the server
contract + the swap-safe fetch, and the report page consumes the final artifact exactly as
today. Do not build client provisional-rendering UI here.

## Files & Areas Touched

- `services/analyzer/swingsage/pipeline.py` (render extracted from run(); emits
  analysis-complete before render), `service/jobrun.py` (upload order: analysis.json + score
  → done event → render → render artifacts → render_complete event)
- `apps/web` events route + `complete.ts` (markViewReady on analysis-done; render artifacts
  arriving later 409-safe), thumb route (already poster-fallback-aware — verify the
  contact.jpg upgrade swap), job states
- `packages/schema` (partial-revision fields, additive)

## Steps

1. **Extract render.** `pipeline.run` returns at analysis-complete; render becomes a
   follow-on phase in the same worker invocation (same container, after the done event) —
   artifact PUTs allowed post-terminal for render-family names only (registry distinguishes).
2. **Ready semantics.** `markViewReady` fires on analysis-done; `swing_views.status = ready`
   while `presentation` state tracked separately on the job; give-up timers unchanged.
3. **Thumbnail path.** contact.jpg becomes optional/deferred; thumb route order: contact.jpg
   → poster.jpg → 404 (already mostly true — verify + test). Consider emitting the impact
   still (`stills/f<impact>.jpg`) during analysis as the swing-log thumb — one JPEG encode,
   fixes the known contact-sheet-as-thumbnail defect properly.
4. **Coarse partial (optional, flag `progressive_revisions_v2`).** After the step-07 coarse
   pass: write `analysis.partial.json` (same schema, `partial: true`, coarse pose + provisional
   events); job stage `coarse_ready`; clients that poll MAY fetch it (mobile adoption is a
   later client-track item). Immutable per revision; final write supersedes.
5. **Measure.** Step-05 spans: analysis_ready wall time before/after; render share.

## Quality Standards / Verification

- Analyzer pytest green; queue e2e: status ready BEFORE overlay.mp4 exists; overlay.mp4
  arrives and serves afterward; a render failure leaves the swing ready with a warning, never
  failed.
- Web tsc+lint; events-route tests for post-terminal render PUTs + new states.
- Timeout placement: a clip that would previously die at render now completes analysis.

## Migration Considerations

Old clients: nothing observable changes except ready arrives sooner (overlay.mp4 was never
client-fetched on mobile; web uses canvas overlay — the burn-in is a debug/reference render).
Partial artifacts are opt-in fetches.

## Technical-Debt Impact

**Reduces** (render out of critical path; incident class shrinks). The
`progressive_revisions_v2` flag: owner this step; success gate = a client consumer ships;
removal/keep decision at step 14 (if no client consumes partials by then, DELETE the partial
write rather than carry it).

## Observability

analysis_ready p50/p95 vs complete p50/p95, per fps class.

## Rollback

Render-inline is a policy boolean on the worker; flip back.

## Cleanup

The "Rendering" stage label in mobile `ANALYSIS_STAGES` demotes to a post-ready phase
(client copy tweak, coordinated with the stage-vocabulary unification).
