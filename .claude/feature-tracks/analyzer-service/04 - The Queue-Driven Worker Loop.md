# 04 - The Queue-Driven Worker Loop

**Phase:** Platform Foundation
**Status:** not-started

## Overview

The worker can run one job from a spec (step 03), but nothing delivers jobs to it: the only
path from "golfer taps re-analyse" to "analyzer runs" is `jobs.ts` spawning `burnin.py` on the
web server's own machine and regex-parsing its stdout. That path cannot survive the analyzer
moving to a host of its own.

This step builds the queue loop end to end, host-agnostically, and proves it on this machine:
the web app publishes a job to QStash → QStash HTTP-delivers it to a small worker HTTP server →
the worker verifies the signature, downloads the source clip over HTTP, runs
`pipeline.run()`, uploads the produced artifacts over HTTP, and reports progress and the
terminal state to a callback — job state living in Postgres the whole way (D9: "the queue
carries dispatch, not truth"). The **deploy** of this loop to a real host stays blocked on the
OPEN worker-host handoff row; everything here runs against the **QStash local dev server**, so
no Upstash account, no credential and no spend is needed.

The queue path lands behind a driver seam (`JOBS_DRIVER=queue`, default `spawn`) mirroring
`MEDIA_DRIVER`'s opt-in rule — the spawn path keeps working unchanged for local development
until the hosted worker exists, and nothing infers cloud from the environment.

## Dependencies

- In-track: step 02 (`pipeline.run` surface), step 03 (`service/worker.py` spec validation,
  the container image, pinned requirements) — both complete.
- Cross-track: `platform-foundation` steps that built `lib/media` (keys, store, publish) and
  the `jobs` table — already shipped. Nothing here needs the worker-host decision, the second
  Supabase project, or production QStash credentials.

## Architectural Context

- **D9 stands: QStash dispatches, Postgres is the truth.** The job row is created by the web
  app at enqueue time; QStash only carries the spec to the worker. Retry/dead-letter policy,
  per-user fair queuing and backpressure are *later steps of this track* — this step sets only
  safe defaults (bounded retries, worker parallelism 1) and leaves the knobs visible.
- **The worker sees URLs, never storage.** The web app is the single owner of the key scheme
  (`lib/media/keys.ts`) and the store seam. The job spec hands the worker three things: a
  source URL to GET, an artifact base URL to PUT results against, and an events URL to POST
  progress/terminal state to. The worker holds no DB credential, no storage credential, and no
  knowledge of buckets or key math — which is exactly what makes it deployable to any host
  later. With the local media driver the web app streams the bytes itself; when the driver
  `canRedirect` (Supabase), the source GET can 307 to a signed URL (same pattern as the
  existing `video/route.ts`). Direct signed *upload* URLs are a deploy-step optimization,
  deliberately not built now.
- **Auth is a stateless per-job token, not elevation.** Internal routes must not run elevated
  reads on a request path (D26), and `jobs_write` RLS is owner-only. So the enqueue side mints
  an HMAC-signed token (server secret `WORKER_CALLBACK_SECRET`) whose claims name the job:
  `{jobId, viewId, actorId, targetRevision, exp}`. The internal routes verify the signature,
  then do every DB write through `withUser(claims.actorId)` — the same identity the spawn
  path's closure captures today. No new principal, no service-role on a request path, no
  token column in the DB.
- **Publish-to-next-revision ordering survives.** The spawn path's "publish r(n+1), only then
  flip the row" ordering (see `jobs.ts` `finish()`) is a correctness rule, not an
  implementation detail. Here it holds structurally: the worker PUTs artifacts at
  `targetRevision = enqueue-time revision + 1` (computed once, carried in the token), and only
  the terminal `done` callback — after all uploads — flips `swing_views` to the new revision.
  A failed run costs the re-analysis, never the swing.
- **Deterministic refusals are not retryable.** A `PipelineError` ("pose confidence too low")
  is an *answer*, not an outage: the worker reports `failed` to the callback and returns 200
  to QStash so it is not redelivered. Infrastructure failures (source download failed,
  callback unreachable, a second job already running) return 5xx/429 so QStash's retry
  schedule applies. Getting this backwards either melts the queue on a bad clip or silently
  drops real outages.
- **The stdout regex protocol is now legacy, not load-bearing, for queue jobs.** The worker
  consumes `pipeline.run(on_event=...)` in-process — typed events, no parsing. `burnin.py`'s
  print lines still reach stdout inside the worker process and are simply ignored (they are
  still the spawn path's protocol; removing them is a later cleanup once the spawn driver
  retires).
- **`club_detector` stays never-defaulted.** The spec names the detector path explicitly; the
  weights remain a worker-local asset (volume mount / local checkout) with no fetch path —
  that open item moves to the deploy step, it is not solved here.
- **`reconcile()` is a spawn-path concept.** It probes the local working dir's
  `.analysis.lock`, which is meaningless for a job running on another host. Queue jobs carry
  `runner='queue'` and skip disk reconciliation; orphan detection for remote workers
  (heartbeat/timeout) belongs to the retry/DLQ step.

## Files & Areas Touched

**Analyzer (Python)** — from `services/analyzer/`:

- `service/server.py` — new: stdlib `ThreadingHTTPServer` with one POST endpoint receiving
  QStash deliveries; Upstash signature verification (official `qstash` SDK `Receiver`, keys
  from `QSTASH_CURRENT_SIGNING_KEY`/`QSTASH_NEXT_SIGNING_KEY`); single-flight guard (second
  concurrent delivery → 429).
- `service/jobrun.py` — new: job-spec **schema 2** (`{"schema": 2, "job": {...urls, token},
  "analysis": {...schema-1 fields sans video/out_dir}}`) → download source to a scratch dir →
  `AnalysisRequest` → `run()` with a throttled event-forwarding callback → upload artifacts →
  terminal callback. Reuses step 03's field validation for the `analysis` block.
- `service/worker.py` — unchanged (schema 1, file/stdin CLI, still the container smoke-test
  entrypoint).
- `requirements.txt` — add the `qstash` SDK pin (signature verification only).
- `tests/test_jobrun.py`, `tests/test_server.py` — new: spec-2 validation, event throttle,
  upload/callback loop against a local stub HTTP server, signature rejection, the
  retryable-vs-refusal status mapping. `pipeline.run` monkeypatched throughout.

**Web (TypeScript)** — from `apps/web/`:

- `drizzle/` migration — `jobs` gains `runner text notNull default 'spawn'` and
  `target_revision integer`; nothing else.
- `src/lib/jobs/token.ts` — new: HMAC sign/verify of the per-job claims (node:crypto, no new
  dependency).
- `src/lib/jobs/dispatch.ts` — new: enqueue = insert job row (`runner:'queue'`,
  `status:'queued'`, `targetRevision`), resolve the source object in `SOURCE_BUCKET` (a queue
  job's source comes from the store, never from a local path), mint token + the three URLs,
  publish via `@upstash/qstash` with bounded retries.
- `src/lib/jobs/complete.ts` — new: the done/failed row+view+score transition, factored out of
  `jobs.ts:finish()` so the spawn path and the callback route share one implementation
  (read-back of `analysis.json` at the new revision, `swing_views` update, `syncSwingScore`).
- `src/lib/jobs.ts` — refactor to use `complete.ts`; `startReanalysis` branches on
  `JOBS_DRIVER`; `getJob`/`reconcile` skip disk reconciliation for `runner='queue'` rows.
- `src/app/api/internal/jobs/[id]/source/route.ts` — GET, token-authed, stream-or-redirect
  from `SOURCE_BUCKET`.
- `src/app/api/internal/jobs/[id]/artifacts/[name]/route.ts` — PUT, token-authed, name must be
  in `ARTIFACT_NAMES`, body → `store.put` at `artifactKey({...address, revision:
  targetRevision}, name)`.
- `src/app/api/internal/jobs/[id]/events/route.ts` — POST, token-authed:
  `progress` → row update; `done`/`failed` → `complete.ts`.
- `package.json` — add `@upstash/qstash`.
- vitest units: token round-trip + tamper rejection, dispatch spec shape, event-transition
  reducer, artifact-name validation.
- `.env.example` — `JOBS_DRIVER`, `QSTASH_URL`, `QSTASH_TOKEN`, `WORKER_URL`,
  `APP_INTERNAL_BASE_URL`, `WORKER_CALLBACK_SECRET` (worker side reads the two signing keys).
- `src/db/queueE2E.ts` (tsx harness, `pnpm --filter web queue:e2e`) — provision one
  fixture-backed swing's source into the store if absent, enqueue through `dispatch.ts`, poll
  the job row to terminal, assert `swing_views.status='ready'`, `artifactRevision` bumped, and
  `analysis.json` present at the new revision.

**Docs**

- `docs/RUNBOOK.md` — new section: running the queue loop locally (QStash dev server command,
  worker server command, env, the e2e harness).
- `docs/ENVIRONMENT.md` — the new env vars and the QStash dev server port.
- `docs/decisions/platform-data.md` — edit the QStash entry in place: dispatch is built and
  proven locally; the worker host (and production QStash credentials) remain OPEN.
- `docs/CURRENT-STATE.md` — the job-dispatch paragraph reflects both drivers.

## Steps

1. Confirm current QStash facts via docs research before coding (dev-server CLI + test
   signing keys, `@upstash/qstash` publish API + retry/flow-control shape, Python `qstash`
   `Receiver.verify` signature semantics, delivery-timeout semantics for a 2–10 min
   synchronous handler). Record anything that changes the design in this file's Notes before
   proceeding.
2. Web: migration (`runner`, `target_revision`), `token.ts`, `complete.ts` factored out of
   `jobs.ts` with the spawn path green against existing behavior (tsc + lint + vitest).
3. Web: `dispatch.ts` + the three internal routes + the `JOBS_DRIVER` seam in
   `startReanalysis`; `reconcile` gated to spawn jobs; vitest units.
4. Analyzer: `qstash` pin installed in the venv; `service/jobrun.py` (spec 2, download,
   throttled events, upload, terminal callback, refusal-vs-retryable mapping);
   `service/server.py` (signature verify, single-flight, status codes); pytest units with
   stub HTTP servers.
5. The e2e harness (`queueE2E.ts`): source-into-store provisioning, enqueue, poll, assert.
6. Run the full local loop: QStash dev server + `next dev` + worker server (venv) +
   `JOBS_DRIVER=queue`; drive the harness on one fixture-backed swing; fix until green.
7. Rebuild the container image (requirements changed) and re-run in-container pytest.
8. Docs: RUNBOOK section, ENVIRONMENT vars, decisions edit, CURRENT-STATE paragraph.

## Quality Standards

- No behavior change to the spawn path beyond the `complete.ts` refactor — `getJob` polling
  responses keep their exact shape (the mobile client and `useReanalyze` depend on it).
- The worker emits no artifact the pipeline did not produce; absent artifacts are reported,
  never fabricated (same contract as `publishFromWorkingDir`).
- Every internal route rejects: bad signature, expired token, job-id mismatch, unknown
  artifact name, wrong job status for the transition. Rejections are 4xx with a reason —
  never a silent 200.
- Secrets never appear in job rows, logs, or QStash message bodies other than the signed
  token itself (which contains no secret).
- Strict TS, no `any`; Python matches the analyzer's existing test discipline.

## Verification

```
# 1. Analyzer suite green locally, including the new service tests
#    (from services/analyzer/)
.venv\Scripts\python.exe -m pytest tests

# 2. Web oracle green
pnpm --filter web exec tsc --noEmit
pnpm --filter web lint
pnpm --filter web test

# 3. The load-bearing gate: the full queue loop, locally
#    (QStash dev server + next dev + worker server running; JOBS_DRIVER=queue)
pnpm --filter web queue:e2e
#    Pass = job row reaches done; swing_views.status ready; artifactRevision bumped;
#    analysis.json present in the store at the new revision.

# 4. The container still reproduces from scratch (pins changed)
#    (from services/analyzer/)
docker build -t swingsage-analyzer:dev -f Dockerfile ../..
docker run --rm swingsage-analyzer:dev python -m pytest tests
```

A pass is gates 1–4 all green. Gate 3 is the step's reason to exist.

## Definition of Done

- `JOBS_DRIVER=queue` drives a real fixture swing through QStash-dev → worker → artifacts →
  callback → `ready`, proven by the harness; `JOBS_DRIVER` unset leaves the spawn path
  exactly as it was.
- The worker holds no credential except the QStash signing keys and speaks only HTTP.
- Job state transitions live in Postgres and are written under the enqueuing user's identity.
- Docs updated (RUNBOOK, ENVIRONMENT, decisions edit, CURRENT-STATE); no new HANDOFF row —
  nothing here needs Taylor.

## Notes

- **QStash facts confirmed (docs research, 2026-08-13):** dev server is
  `npx @upstash/qstash-cli dev` (port 8080, fixed test signing keys, no account needed).
  `@upstash/qstash` v2.11.3 `publishJSON({url, body, retries, timeout, flowControl})`.
  Python `qstash` v3.4.0 `Receiver(current_signing_key, next_signing_key).verify(body=raw,
  signature=hdr, url=...)` — raises on failure, and the `url` must EXACTLY match the URL the
  message was published to, so the worker takes its own public URL from env
  (`WORKER_PUBLIC_URL`) rather than reconstructing it from the request. Synchronous delivery
  waits up to the plan max (15 min free / 2 h pay-as-you-go) — a 2–10 min synchronous handler
  is viable now; revisit at deploy if p99 approaches the plan ceiling. Retries default 3 with
  exponential backoff; failure callbacks + a built-in DLQ exist (the retry/DLQ step's
  primitives). Flow-control `key` + `parallelism` is the per-user fair-queuing primitive for a
  later step.
- Retry policy, dead-letter handling, per-user fair queuing (QStash flow-control keys),
  backpressure, and worker orphan detection are the next steps of this track — this step only
  proves the loop.
- Production QStash credentials and the worker deploy are blocked on the OPEN worker-host row;
  the loop is deliberately provable without either.
- The club-head weights fetch path remains open (deploy step); the dev worker reads the local
  `runs/clubhead/weights/best.pt`.
