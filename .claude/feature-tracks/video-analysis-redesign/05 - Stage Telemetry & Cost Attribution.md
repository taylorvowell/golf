# 05 - Stage Telemetry & Cost Attribution

**Phase:** Foundations
**Status:** not-started
**Estimated effort:** 1 session

## Overview

**Objective:** attribute ≥95% of job wall time and billed work to named stages (plan WP-013,
E0.2) so every later optimization step argues from measurements, and unify the two
disagreeing stage vocabularies.

**Current state:** per-stage wall clock is printed and discarded; `PipelineResult.elapsed_s`
is the only structured number; real per-stage timing exists only inside `modal_app.bench`;
`jobs.log` (200-line jsonb ring) is the only sink; `jobs.ts STAGES` (11 regex tuples) and
`jobrun.py STAGE_PCT` (16 names) disagree; p95 latency is unanswerable without string-scanning
logs.

**Target state:** every job emits a structured per-stage record (stage, wall s, frames
touched, and where cheap: GPU/CPU class, memory high-water, R2 bytes, container cold/warm,
batch size, model/policy versions) persisted queryably; one stage vocabulary owned by the
worker's named events.

## Dependencies

- Step 01 (guard events share the same record shape).

## Architectural Context

Matrix rows 14, 45, 49; C4. Seam with the planned `observability-and-slos` track: THIS step
owns pipeline/job-shaped telemetry (the analysis-latency SLO's raw data); that track owns
product analytics, error tracking, dashboards at large. Record the split in `docs/decisions/`.

## Files & Areas Touched

- `services/analyzer/swingsage/pipeline.py` (stage spans emitted via `on_event`, replacing
  print-derived timing — prints stay verbatim for the spawn scraper until step 14)
- `services/analyzer/service/jobrun.py` (`stage_metrics` accumulated; posted with `done`)
- `apps/web/src/db/schema.ts` + migration: `job_metrics` jsonb on `jobs` (or sibling table if
  rows exceed comfort), written by the events route
- `apps/web/src/lib/jobs.ts` (spawn path maps its scraped stages onto the SAME vocabulary)
- `scripts/` small reader: p50/p95 per stage per fps class from job rows

## Steps

1. Define the stage vocabulary = `jobrun.STAGE_PCT` names (16), extended with `guard` and
   `upload`. Document as the one list; `jobs.ts` STAGES maps onto it.
2. Emit `stage_span` events (start/end, frames, notes) from `pipeline.run`; accumulate in
   jobrun; attach the full array to the `done` event (and to `failed`, for partial
   attribution).
3. Persist on the events route; include capture fps, unique frames, resolution, policy/model
   versions, cold/warm (Modal exposes container reuse via a module-level flag), variants
   on/off.
4. Reader script answering: p50/p95 upload-complete→ready by fps class; per-stage share;
   cost/view via a configured L4 $/s rate (rate in config, not code — plan 07 §7).
5. Acceptance run: one queue job on the deployed worker; verify ≥95% of wall time lands in
   named spans.

## Quality Standards / Verification

- Analyzer pytest green (span emission unit-tested with a fake on_event).
- Web tsc+lint; events-route test persists spans.
- The ≥95% attribution check on a real job (bench or queue:e2e).

## Migration Considerations

Additive column; old jobs have null metrics. Prints untouched (spawn compatibility) — their
removal is step 14's, with the scraper.

## Technical-Debt Impact

**Reduces** (one vocabulary, measured pipeline). Neutral storage cost (~1–2 KB/job).

## Observability

This step IS observability. DLQ ids already land in job logs; surfacing/alerting stays with
`observability-and-slos`.

## Rollback

Additive; revert the emitters.

## Cleanup

None here; the stdout scraper's deletion (step 14) depends on this vocabulary being the one
source.
