# 13 - Reliability: Checkpoints, Retry Completion, Orphan Sweeper

**Phase:** Optimization
**Status:** not-started
**Estimated effort:** 2 sessions

## Overview

**Objective:** finish the reliability items the plan requires that steps 01/05 didn't cover
(WP-011/012 remainder, plan 10): stage checkpoints with resume, persisted failure classes,
idempotency fingerprints, and an orphan sweeper that doesn't depend on the owner polling.

**Current state:** step 01 made deterministic failures terminal; four retry layers exist and
are stratified; but a mid-run infra death re-runs the whole pipeline from zero (Modal retry);
`jobs.error` vs `message` inconsistently populated; no failure_class column; reconcile is
poll-driven with silently-swallowed writes; idempotency = targetRevision pinning only (no
input fingerprint, so an identical re-run recomputes).

**Target state:** expensive completed stages resume instead of re-running on infra retries;
failure classes persisted and queryable; an identical successful run is reused, not
recomputed; orphans settle without an owner poll; reconcile write failures are visible.

## Dependencies

- Steps 05 (spans tell us which stages are worth checkpointing), 07 (stage boundaries are
  policy-shaped), 09/10 (checkpoint formats stabilize after the new stages exist).

## Architectural Context

Matrix rows 10–13; plan 10 §2–6, §10. Scope discipline: checkpoint the FEW expensive stages
(pose observations; club candidates), not a generic framework — the no-speculative-abstraction
rule. Compatibility key = {media sha, manifest sha, pipeline version, model versions,
frame_policy version} (the plan's idempotency identity), stored in a small run manifest
beside checkpoints under the revision prefix.

## Files & Areas Touched

- `services/analyzer/service/jobrun.py` (checkpoint write/read via the artifact PUT/GET
  surface — worker stays credential-free), `swingsage/pipeline.py` (resume entry points)
- `apps/web` internal routes (checkpoint names in the registry), `jobs` schema migration
  (`failure_class`; merge `error`/`message` semantics), `lib/jobs.ts` (sweeper), a cron
  route or scheduled invocation for `reconcile-all`
- `packages/schema` (run-manifest mini schema)

## Steps

1. **Run manifest + fingerprint.** Compute the idempotency identity at job start; store with
   the job; on enqueue, an identical fingerprint with a successful prior run → return that
   run (revision pointer), skip compute.
2. **Checkpoints.** After pose refinement and after club candidate generation: write
   `checkpoints/<stage>.json.zst` under the revision prefix. On Modal retry (same job id,
   same fingerprint): load compatible checkpoints, resume. Incompatible (version/policy
   mismatch) → full run.
3. **Failure classes.** `jobs.failure_class` (retryable_infra / terminal_workload /
   terminal_quality / terminal_media / unknown); events route + failure callback + sweeper
   all write it; `error` column folds into structured use.
4. **Sweeper.** A scheduled reconcile-all (Vercel cron or QStash schedule) applying the
   existing queueOrphanVerdict to ALL live jobs; reconcile writes log failures instead of
   `.catch(() => {})` silence.
5. **DLQ surfacing.** dlq id + failure class exposed in the reader script (step 05); alert
   wiring stays with observability-and-slos.

## Quality Standards / Verification

- Simulated worker death after club stage (test harness kills between events) → retry
  resumes, pose/club stages not re-run (span evidence), artifact identical to uninterrupted
  run (compare_analysis).
- Deterministic-timeout fixture: never re-runs (step 01 rule holds through the checkpoint
  path).
- Double-enqueue with identical fingerprint → one compute.
- Web tsc+lint + migration; analyzer pytest green.

## Migration Considerations

Checkpoints are additive objects under the revision prefix; absent = full run (old behavior).
Jobs schema migration additive.

## Technical-Debt Impact

**Reduces** (audit debt: error/message split, silent reconciles, poll-only settlement,
retry-from-zero waste).

## Observability

checkpoint_resume_success / retry-waste seconds in the step-05 record.

## Rollback

Checkpoint reads behind a flag for one release; sweeper is disableable.

## Cleanup

`.catch(() => {})` sites replaced; `jobs.error`/`message` duality resolved.
