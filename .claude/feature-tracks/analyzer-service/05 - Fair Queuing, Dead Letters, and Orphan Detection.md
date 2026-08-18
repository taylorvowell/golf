# 05 - Fair Queuing, Dead Letters, and Orphan Detection

## Overview

Step 04 proved the queue loop end-to-end but left it trusting: a job that stops sending
events stays `running` forever, a message that exhausts its retries vanishes into QStash's
DLQ with no row ever flipping to `failed`, one user can occupy every delivery slot, and
nothing bounds how many jobs a user can pile up. This step makes the queue path safe to
operate unattended — all of it host-agnostic and provable locally against the QStash dev
server. The deploy half of the track (production QStash credentials, the worker host) stays
behind the OPEN worker-host HANDOFF row and is NOT this step.

Five deliverables:

1. **Per-user fair queuing** — `flowControl: { key: <userId>, parallelism }` on the QStash
   publish so one user's burst cannot monopolize delivery attempts against the single-flight
   worker. (SDK ≥2.11 shape: `key`/`parallelism`/`rate`/`period`; `ratePerSecond` is
   deprecated — do not use it.)
2. **Failure callback → dead-letter visibility** — a `failureCallback` URL on the publish;
   a new internal route marks the job and view `failed` when QStash exhausts retries, and
   records the `dlqId` so the message can be found in the DLQ later. Without this, retry
   exhaustion is invisible to the product.
3. **Orphan detection for queue jobs** — a `last_event_at` heartbeat column stamped by the
   events route on every event; `reconcile()` (today spawn-only, `jobs.ts:142`) learns a
   queue branch: `running` with a stale heartbeat, or `queued` for longer than the delivery
   window, settles to `failed` on the next poll. The worker's existing progress cadence
   (throttled to one post per 2s during stages, `jobrun.py:58`) is the heartbeat — no new
   worker-side signal needed, but stage gaps can be minutes (club stage), so the timeout
   must tolerate that.
4. **Backpressure at enqueue** — a per-user cap on active (`queued`+`running`) queue jobs;
   exceeding it is a user-readable refusal at `startReanalysis`, not a silent queue pile-up.
   (The worker's own 429-on-busy → QStash retry is the downstream absorber and already
   exists, `server.py:102-104`.)
5. **The capacity model** — the measured numbers that make an analysis-latency SLO
   possible: per-job wall clock (measured 2026-08-18: 5m41s for a 5.4s 60fps clip, CPU
   pose + GPU club detector on the GTX 1080), single-flight worker ⇒ jobs/hour/worker,
   and the CUDA multiplier from step 01 (2.32×). Written to the track's `_PROGRESS.md`
   and `docs/decisions/` as the input the observability-and-slos track consumes. The done
   event additionally carries `elapsedS` (pipeline `result.elapsed_s`, currently dropped
   by `jobrun.py`) so every future job self-reports its duration into the job log.

## Dependencies

- In-track: steps 01–04 `complete` (the queue loop this hardens).
- Cross-track: none new. platform-foundation owns the schema conventions this reuses
  (additive migration, RLS untouched).

## Architectural Context

- **Grounding (verified 2026-08-18):** publish is `client.publishJSON({ url, body: spec,
  retries: 3 })` with nothing else set — `apps/web/src/lib/jobs/dispatch.ts:128-136`. No
  `flowControl`, no `failureCallback` anywhere in `apps/web/src`. `reconcile()` early-returns
  for `runner !== "spawn"` — `apps/web/src/lib/jobs.ts:137-142`. The events route is the
  only writer of queue-job progress — `app/api/internal/jobs/[id]/events/route.ts`. The
  `jobs.error` column exists and is written nowhere — `schema.ts:231`.
- **Failure-callback auth reuses the job token, not QStash signatures.** The failure
  callback's payload carries the original message body base64-encoded, and that body is the
  job spec, which contains `job.token` (HMAC, claims `{jobId, viewId, actorId,
  targetRevision, exp}`). The route decodes the payload, extracts the token, and goes
  through the same `requireJobAccess`-style verification as the other internal routes — no
  QStash signing keys on the web side, no new credential, D26 preserved (writes run as the
  enqueuing user). Token TTL is 6h (`dispatch.ts:20`), far beyond retry exhaustion
  (exponential backoff, 3 retries ⇒ minutes).
- **Terminal rows stay soft.** The events route's already-terminal short-circuit pattern
  (`events/route.ts:66-71`) applies to the failure route too: a failure callback landing
  after the job settled (e.g. orphan sweep got there first) acks 200 and changes nothing.
- **Refusals never reach the DLQ.** PipelineError acks 200 at the worker (`server.py:106-107`)
  — that taxonomy is load-bearing and unchanged. Only infra failures (5xx) retry and can
  dead-letter, which is exactly what the failure callback should surface.
- **`last_event_at` is additive** — one nullable timestamptz column + one migration; no
  existing column changes meaning. The spawn path never writes it and never reads it.
- **Thresholds are env-tunable with safe defaults**, not hardcoded: heartbeat timeout must
  survive the club stage's multi-minute silence between `stage_started` posts (measured
  ~7min of variants on CPU). Defaults: `JOBS_QUEUE_HEARTBEAT_TIMEOUT_S=900` (15 min),
  `JOBS_QUEUE_PENDING_TIMEOUT_S=3600` (1 h — covers QStash backoff `min(86400, e^(2.5n))`
  for 3 retries), `JOBS_MAX_ACTIVE_PER_USER=3`, `JOBS_FLOW_PARALLELISM=1`.
- **The QStash local dev server claims full feature parity** (flow control, callbacks, DLQ;
  in-memory). Verify empirically during implementation; if a feature is dev-server-absent,
  the e2e still must pass with the options SET (they are pass-through publish options) and
  the unit tests carry the behavioural proof. Log any such gap in the track `_PROGRESS.md`.

## Files & Areas Touched

- `apps/web/src/lib/jobs/dispatch.ts` — flowControl + failureCallback on publish; the
  per-user active-jobs admission check (or in `jobs.ts` beside the per-view check at
  `jobs.ts:203-206`).
- `apps/web/src/lib/jobs.ts` — queue branch in `reconcile()`; env-threshold helpers.
- `apps/web/src/app/api/internal/jobs/[id]/failure/route.ts` — NEW: the failure callback.
- `apps/web/src/app/api/internal/jobs/[id]/events/route.ts` — stamp `last_event_at`;
  accept `elapsedS` on the done event into the job log.
- `apps/web/src/db/schema.ts` + `apps/web/drizzle/0011_*.sql` — `jobs.last_event_at`.
- `apps/web/src/lib/jobs/internal.ts` — shared token-from-callback-payload helper if the
  failure route can't use `requireJobAccess` directly.
- `services/analyzer/service/jobrun.py` — done event gains `elapsedS`.
- `services/analyzer/tests/test_jobrun.py` — pin `elapsedS` on done.
- Web tests: `dispatch` publish-options pin, failure-route unit tests, reconcile queue-branch
  tests, admission-cap test.
- `apps/web/.env.example` — the four new env vars, documented.
- `docs/decisions/platform.md` (or the queue's existing decisions home) — the failure/
  fairness/backpressure policy entry. `docs/RUNBOOK.md` §queue — note the new envs.

## Steps

1. **Migration**: add `jobs.last_event_at timestamptz` (nullable). `pnpm db:generate` or
   hand-write `0011_queue_heartbeat.sql` following 0010's style; run `pnpm db:migrate`.
2. **Events route**: stamp `last_event_at: now()` on every accepted event write; extend the
   done-event schema with optional `elapsedS` (number), appended to the job `log` as
   `"pipeline elapsed 341.2s"` — never on a golfer-facing surface.
3. **Worker**: `jobrun.py` includes `elapsedS: result.elapsed_s` in the hard done post.
   Pin in `test_jobrun.py`.
4. **Dispatch**: add `flowControl: { key: userId, parallelism: envInt("JOBS_FLOW_PARALLELISM", 1) }`
   and `failureCallback: ${APP_INTERNAL_BASE_URL}/api/internal/jobs/${jobId}/failure` to
   `publishJSON`. The flow-control key is the enqueuing user id (actorId), not the view.
5. **Failure route**: parse QStash failure payload (`status`, `retried`, `maxRetries`,
   `dlqId`, base64 `body`); decode body → spec → `job.token`; verify token & job match
   (same gate shape as `internal.ts:25-46`); terminal short-circuit; else mark job `failed`
   (write the reason INTO `jobs.error` — first writer of that column — and message), record
   `dlqId` in the log, `markViewFailed`. Unit-test: valid payload settles job+view; terminal
   no-ops; bad/missing token 401; foreign job id 401/404.
6. **Backpressure**: in `startReanalysis` (queue driver only), count the actor's
   `queued|running` queue-runner jobs; at `JOBS_MAX_ACTIVE_PER_USER` refuse with a
   user-readable error. Test the cap boundary.
7. **Reconcile queue branch**: replace the `runner !== "spawn"` early-return with: spawn →
   existing logic; queue + `running` + `last_event_at` (fallback `started_at`) older than
   heartbeat timeout → settle `failed` ("worker went silent"); queue + `queued` older than
   pending timeout → settle `failed` ("never delivered"). Same best-effort,
   owner-actor-only write semantics as the spawn branch (`jobs.ts:156-177`). Unit-test all
   three branches with injected clock.
8. **Env + docs**: `.env.example` entries; RUNBOOK queue section addendum; decisions entry
   (policy: what retries, what dead-letters, what the caps are, why refusals never DLQ);
   capacity model appended to `_PROGRESS.md` entry and the decisions entry.
9. **Prove the loop live**: QStash dev server + worker + `pnpm dev` up; `JOBS_DRIVER=queue
   pnpm --filter web queue:e2e` passes with the new publish options. Then the negative
   path: enqueue with the worker DOWN, watch retries exhaust, confirm the failure callback
   settles the job `failed` with a `dlqId` in the log (dev-server DLQ). If the dev server
   does not implement failure callbacks, record the gap and prove the route with its unit
   tests instead — do not fake the live proof.

## Quality Standards

- No credential widening: the worker still holds no DB/storage secret; the web side still
  holds no QStash signing key; every internal-route write runs as the enqueuing user (D26).
- Additive schema only; migration follows 0010's comment style.
- Thresholds in env with defaults, never inline magic numbers; all four documented.
- Diagnostics (elapsedS, dlqId) go to the job log — never a golfer-facing screen.
- Refusal taxonomy untouched: PipelineError never retries, never dead-letters.

## Verification

```
# 1. Analyzer suite (from services/analyzer/)
.venv\Scripts\python.exe -m pytest tests

# 2. Web oracle
pnpm --filter web exec tsc --noEmit
pnpm --filter web lint
pnpm --filter web test

# 3. Migration applies cleanly
pnpm --filter web db:migrate

# 4. The live loop with the new publish options (QStash dev + worker + next dev up)
pnpm --filter web queue:e2e

# 5. The negative path (worker down): job settles failed via failure callback or,
#    if the dev server lacks failure-callback support, the documented unit-test proof.
```

Pass = 1–4 green, 5 demonstrated one way and recorded which way in `_PROGRESS.md`.

## Definition of Done

- One user cannot occupy more than `JOBS_FLOW_PARALLELISM` concurrent deliveries or hold
  more than `JOBS_MAX_ACTIVE_PER_USER` active jobs.
- A queue job whose worker dies mid-run, or whose message exhausts retries, reaches
  `failed` (with `jobs.error` set) without human intervention — no permanent `running`.
- Every completed job's true pipeline duration is in its log.
- The capacity model (jobs/hour/worker, CPU vs CUDA) is written down where the SLO track
  will find it.
- All existing gates stay green; the container story is untouched (no new worker deps).

## Notes

- Authored 2026-08-18 by the orchestrator's lazy-step-file path, grounded by two code-map
  agents (dispatch/jobs/routes; server/jobrun/worker) and a QStash docs pass (flow control
  `key/parallelism/rate/period`; failure-callback payload incl. `dlqId`; backoff
  `min(86400, e^(2.5n))`; dev server claims parity, in-memory only).
- Deliberately NOT here: production QStash credentials, worker-host deploy, DLQ retry
  tooling/UI (post-host), global (not per-user) admission control, and any spawn-path
  change beyond leaving it exactly as is.
