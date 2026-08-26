# 01 - Production Safety & Correctness Quick Wins

**Phase:** Foundations
**Status:** not-started
**Estimated effort:** 1 session

## Overview

**Objective:** close the open incident paths and the audit's cheap correctness bugs before
any architectural work. No architecture changes — every item is small, independently
shippable, and reversible in one commit.

**Current state:** nothing refuses an oversized clip before GPU (75 GPU-min burned
2026-08-26); a deterministic timeout is retried ×2 by Modal; `JOBS_CLUB_VARIANTS` defaults
true (676.6 s vs 124.6 s per job); the capture path has no admission control (double
`source/complete` → two QStash jobs for one view); imports run the ATTACK detector via a null
fallback while claiming SWISH; slow-mo imports get `fps = captureFps` stamped on a
30 fps-clock container.

**Target state:** oversized/malformed workloads become terminal pre-GPU failures with a
golfer-readable reason; deterministic failures are never blindly retried; production runs the
124.6 s shape by default; one in-flight analysis per view; imports run SWISH; slow-mo import
review surfaces use the container clock.

## Dependencies

- Step 00 complete.

## Architectural Context

Matrix rows 9, 10, 11, 50 + audit live bugs. Plan WP-007/WP-012 (partial). The full manifest
comes in 02 — this step's guard uses what the server can already probe (ffprobe +
`probe_capture_fps`), so the incident class is closed *now*, then hardened by the manifest.

## Files & Areas Touched

- `services/analyzer/service/jobrun.py`, `service/modal_app.py` (guard + non-retryable class)
- `services/analyzer/swingsage/video.py` (probe reuse; no behavior change)
- `apps/web/src/lib/jobs/policy.ts` (`clubVariants` default), `apps/web/src/lib/jobs.ts` /
  `lib/ingest.ts` (capture single-flight)
- `apps/mobile/src/features/swings/useImportSwing.ts` (detector arg; fps/clock split)
- `apps/mobile/src/features/session/reviewWindow.ts` (typing only if needed)
- `docs/decisions/` (variants default; guard thresholds)

## Steps

1. **Workload guard (server, pre-GPU).** In `run_queue_job` before pipeline: ffprobe the
   downloaded source; compute estimated normalized frame count from
   `cfr_target_fps` × duration (retime-aware via `probe_capture_fps`). Reject over a budget
   (start: > 2,000 frames or > 15 s real duration or unsupported codec/resolution) with
   `PipelineError`-class terminal failure and a user-readable reason ("This clip is N s —
   SwingSage analyzes a single trimmed swing…"). Threshold in one place, env-overridable.
2. **Non-retryable deterministic failures.** Guard rejections and stage-budget timeouts must
   not re-run: raise as terminal (`failed` event) BEFORE Modal's retry machinery can matter —
   i.e. classify inside `run_queue_job` (a raised guard failure posts `failed` and returns
   normally so Modal sees success-of-delivery). Document the rule in jobrun docstring.
3. **Flip `clubVariants()` default to false.** Variants become explicit dev opt-in
   (`JOBS_CLUB_VARIANTS=true`). Record in `docs/decisions/` — production pays 124.6 s; the
   27-variant artifact remains available per-run for the trace-verdict work.
4. **Capture-path admission.** In `startCaptureAnalysis`: same already-running guard order as
   `startReanalysis` (check active job for view before enqueue) + apply
   `JOBS_MAX_ACTIVE_PER_USER`. A second `source/complete` while a job is live returns the
   existing job (the route already advertises re-enqueue-as-retry — keep that for
   failed/absent jobs only).
5. **Import detector bug.** `useImportSwing.ts`: pass the resolved impact method (default
   `"swish"`) instead of `undefined`.
6. **Slow-mo import clock split.** Introduce distinct fields on the take handed to review:
   `containerFps` (drives FrameClockView + seekToFrame + lastFrame) and `captureFps`/
   `slowMoFactor` (drive real-seconds math + playback rate). Fix poster sample times to real
   seconds. `SavedImport.fps` carries containerFps; slowMo factors stay alongside.

## Quality Standards / Verification

- Analyzer: `.venv\Scripts\python.exe -m pytest tests` green (new guard tests included).
- Web: `pnpm --filter web exec tsc --noEmit && pnpm --filter web lint`.
- Guard test: a synthetic 41.6 s/30 fps probe result → terminal failure, zero pipeline stages
  run, `retryable=false`, message user-readable.
- Admission test: two rapid `completeCapture` calls → one job row, one QStash publish (mock).
- Import test: detector called with `"swish"`; slow-mo take review math uses containerFps for
  frames, real seconds for windows.

## Migration Considerations

Old in-flight jobs unaffected (guard applies to new deliveries). Variants flip changes new
artifacts only (27→1 solutions stored) — the player's variant picker already tolerates absent
variants (`clubVariantOptions` reads what exists). Existing 27-variant artifacts unchanged.

## Technical-Debt Impact

**Reduces.** Closes two incident paths and three live bugs; adds one env-tunable threshold
(hardened, not replaced, by 02's manifest).

## Observability

Guard rejections logged to the job row with reason + probed facts (fps, capture fps,
duration, est. frames) — this is also the telemetry that sizes 02's thresholds.

## Rollback

Each item is an independent commit; revert individually. Variants default is a one-line
revert.

## Cleanup

None deferred — no temporary mechanisms introduced.
