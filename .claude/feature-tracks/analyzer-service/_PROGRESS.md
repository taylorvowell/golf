# analyzer-service — Progress Log

Append-only. One entry per completed step: timestamp, what changed, anything worth keeping.

---

## 06 - Model Assets and Container Bootstrap
**Completed:** 2026-08-18 17:05 UTC
**Phase:** Platform Foundation
**Summary:** Every model file the pipeline loads now has a committed `sha256` and a stated
source in `service/models.py`, and a container that cannot get one refuses to start.
`service/fetchmodels.py` verifies (`--check`, never touches the network) or fetches, hashing
the temp file **before** the atomic rename so a partial download can never become the loaded
model; `service/entrypoint.sh` bootstraps then `exec`s; `server.py` re-runs the check before
binding its socket. The private club-head `best.pt` — with no fetch path since step 03 — gets
one through the media store the web app already owns: `pnpm --filter web models:publish`
hashes it, uploads it to the new `swing-models` bucket under a content-addressed key, and
prints the hash (for the manifest) and a signed URL (for `SWINGSAGE_CLUB_WEIGHTS_URL`). D26
holds — the worker still has no storage credential and knows nothing about buckets. Also
added the worker-side half of the never-default-the-club-detector rule: a stated-but-absent
detector is a `SpecError` at spec parse, not a failure after five minutes of pose. Gates:
analyzer 189/2s/1x (+24), web tsc+lint clean, vitest 206 (+14), fresh container exits 1
naming all three missing assets and their sources.
**Notes:** This step is the HOST-AGNOSTIC half of the original step-06 declaration, split out
so the deploy's prerequisites could land while the host choice sits on Taylor's OPEN handoff
row; the deploy is now step 07. Two things worth keeping: the MediaPipe URL was verified by
actually fetching it in-container and matching the committed hash (a manifest URL nobody has
ever fetched is a deploy-day failure waiting to happen), and the in-image test suite opts out
of the bootstrap with `SWINGSAGE_SKIP_MODEL_BOOTSTRAP=1` rather than downloading 480 MB —
step 03's from-scratch reproducibility proof stays cheap.

---

## 05 - Fair Queuing, Dead Letters, and Orphan Detection
**Completed:** 2026-08-18 15:05 UTC
**Phase:** Platform Foundation
**Summary:** The queue path now polices itself, all host-agnostically and proven live against
the QStash dev server. Publish carries per-user flow control (`user-<id>`,
`JOBS_FLOW_PARALLELISM`=1) and a failure callback; the new
`/api/internal/jobs/<id>/failure` route settles retry-exhausted jobs `failed`, writes
`jobs.error` (its first writer) and logs the `dlqId` — authenticated by the job token
recovered from the dead message's own `sourceBody`, so the web side still holds no QStash
signing key. The events route stamps `jobs.last_event_at` (migration 0011) on every worker
post, and `reconcile()`'s queue branch settles silent `running` rows (heartbeat 900s) and
undelivered `queued` rows (3600s backstop). Enqueue refuses at 3 active jobs per user
(swing-ownership join, not RLS visibility). Done events self-report `elapsedS` into the job
log. All policy pure + unit-tested (`lib/jobs/policy.ts`, 13 tests). Gates: analyzer
165/2s/1x, web tsc+lint clean vitest 192 (+13), migration applied, positive e2e PASSED twice
(view rev 3→4→5, "pipeline elapsed 407.3s" logged), negative path PASSED FOR REAL — worker
killed, QStash burned all 4 deliveries (~35 min of true backoff), failure callback settled
the job with `dlqId 1787064288255-0`.
**Notes:** Two dev-server facts learned empirically: flow-control keys reject colons
(alphanumeric/hyphen/underscore/period only — publish 400s), and the failure callback DOES
carry `sourceBody`, so the token-from-body design works without a QStash signing key on the
web side. Refusals (PipelineError, acked 200) never retry and never dead-letter — the
failure callback firing always means infrastructure. Capacity model recorded in
docs/decisions/platform-data.md: 269–407s/job measured on CPU pose + GTX 1080 detector,
~10.5 jobs/hr/worker single-flight; CUDA projects ~4.5 min/job — the p95<180s SLO needs a
faster host class and/or horizontal workers, which is the sizing half of the worker-host
HANDOFF decision. The route-auth meta-test now accepts `jobContextForClaims` (the shared
verifier behind `requireJobAccess`) as a sanctioned internal-route guard. Step 06 (declared,
lazy) is the deploy half — blocked on the worker-host HANDOFF row.

---

## 04 - The Queue-Driven Worker Loop
**Completed:** 2026-08-13 21:12 UTC
**Phase:** Platform Foundation
**Summary:** The spawn+stdout-regex path now has a queue-driven successor, built and proven
end to end on this machine with zero cloud spend: `lib/jobs/dispatch.ts` (behind
`JOBS_DRIVER=queue`, opt-in like `MEDIA_DRIVER`) publishes a schema-2 job spec to the QStash
local dev server, which delivers to `service/server.py` (signature-verified, one job at a
time); the worker downloads the source over HTTP, runs `pipeline.run()` with throttled event
forwarding, PUTs artifacts back, and posts a terminal event the web app VERIFIES
(`analysis.json` present at the target revision) before flipping the view. E2E harness
(`pnpm --filter web queue:e2e`) passed on pro_2: job done, view ready at revision 2. Gates:
analyzer 165/2s/1x (+24 new tests), web tsc+lint+vitest 179, schema 100 (additive
`Job.runner`, locked), container rebuilt with the qstash pin — in-container 127/13s/1x.
**Notes:** The worker holds no DB or storage credential — URLs plus an HMAC-signed per-job
token ({jobId, viewId, actorId, targetRevision, exp}); `/api/internal/jobs/*` verifies it and
writes as the enqueuing user, so no elevation lands on a request path (D26) and the web app
stays the sole owner of media addressing. Failure taxonomy is the retry contract: a
`PipelineError` acks 200 (a refusal is an answer — never retried), infra failures 5xx into
QStash's schedule, and 429 covers single-flight. `WORKER_CLUB_DETECTOR` must be explicit
(path or `none`) — the standing club-detector trap enforced at enqueue; the spawn path's
silent omission of `--club-detector` on reanalysis remains an open pre-existing defect worth
a later fix. `jobs` gained `runner`/`target_revision` (migration 0010); `reconcile()` is
spawn-only now. Queue-path source comes from the store via `swing_views.raw_media_key` (the
harness provisions it for fixtures; `swing-ingest` will own it properly). Step 05 declared
(lazy): fair queuing, retry/DLQ, remote-orphan detection, capacity model; deploy still waits
on the OPEN worker-host row.

---

## 03 - Reproducible Environment and Worker Skeleton
**Completed:** 2026-08-13 19:20 UTC
**Phase:** Platform Foundation
**Summary:** The analyzer environment is now reproducible from nothing: `requirements.txt`
exact-pins the measured configuration (the versions D53 and the 2.32x number were taken on),
with rtmlib installed `--no-deps` because its metadata hard-requires the CPU-only
`onnxruntime` — the exact silent-CUDA-fallback vector from step 01. `services/analyzer/
Dockerfile` (repo-root context, python:3.13-slim + ffmpeg, 8.4GB) ships the shared contract
schemas with `SWINGSAGE_SCHEMA_DIR` set, and `service/worker.py` is the container entrypoint:
versioned job-spec JSON → `AnalysisRequest` → `pipeline.run()`, one JSON object per line,
strict validation (unknown fields refuse; club detector never defaulted). Gates: local suite
141 passed / 2 skipped / 1 xfailed (12 new worker tests); image builds clean; **in-container
suite green (103 passed / 13 skipped / 1 xfailed)** — the from-scratch reproducibility proof.
**Notes:** Fixed two latent monorepo-coupling bugs the container exposed: `contract.py`
computed `parents[3]` at import time (crashing any monorepo-less install before its own
documented `SWINGSAGE_SCHEMA_DIR` override could apply), and `test_contract.py` had the same
walk. The stale `opencv_python_headless 4.10` in the local venv was left untouched (removing
it risks the shared `cv2` files); the pinned rebuild excludes it. `runs/clubhead/weights/
best.pt` remains a local-only asset with no reproducible fetch path — shipping it to a
deployed worker is an open later-step decision. Step 04 declared (lazy): the worker loop;
its deploy half waits on the OPEN worker-host handoff row.

---

## 02 - One Entry Point for the Pipeline
**Completed:** 2026-08-13 17:42 UTC
**Phase:** Platform Foundation
**Summary:** Extracted the entire pipeline composition (~700 lines: all stages, the seven
club-variant re-runs, `analysis.json` doc assembly, `OutputLock`, `SCHEMA_VERSION`) out of
`scripts/burnin.py:main()` into `swingsage/pipeline.py` — `run(AnalysisRequest, on_event)` with
typed `PipelineEvent` progress and a `PipelineResult`. `burnin.py` is now a thin CLI that builds
the request and maps `PipelineError` to the same exit codes/messages. Fidelity proven strongly:
pre- vs post-refactor CPU runs of `pro_2` produced **byte-identical** `analysis.json` and
`coach_report.json` at tolerance 0.0 (`scripts/compare_analysis.py`, new), and all 11 stage lines
`apps/web/src/lib/jobs.ts` regex-parses still appear in the run log. Suite 129 passed / 2 skipped
/ 1 xfailed (6 new tests pin CLI↔`AnalysisRequest` default equivalence, the no-default-weights
rule, and lock behavior).
**Notes:** stdout stays a compatibility surface until the worker consumes `on_event` in-process —
the rule is stated in both module docstrings and in `docs/decisions/analysis-and-ai.md` ("The
pipeline has one programmatic entry point"). Step 03's natural scope, per step 02's Notes:
requirements pinning / reproducible venv + the `services/analyzer/service/` worker skeleton —
still host-agnostic, so it does not wait on the worker-host handoff row.

---

## 01 - Does Pose Need a GPU (entry added retroactively with step 02's)
**Completed:** 2026-08-13 09:45 UTC
**Phase:** Platform Foundation
**Summary:** Measured CUDA vs CPU pose on this pipeline: **2.32x** (70.4 → 30.4 ms/frame) on the
GTX 1080, agreement 0.94 px worst-case across 6,150 keypoints — sub-pixel but not bit-identical
(D53). Three plausible false results (silent CUDA→CPU fallbacks) preceded the true one;
`posebench.py` now refuses to time a fallback by asking the real session's `get_providers()`.
**Notes:** The number is attached to the worker-host handoff row; the host decision is Taylor's.

Track goal: promote the analyzer from a hand-invoked CLI to a hosted, queue-driven worker reading
and writing object storage — with per-user fair queuing, backpressure, retry/dead-letter handling
and a validated analysis-latency SLO.

**Became the spine on 2026-08-13.** `mobile-player` completed, and what core function is missing is
**getting a swing in**: there is no upload route anywhere in `apps/web/src/app/api`, no capture, and
no worker. Every swing on disk exists because `burnin.py` was run by hand.

**The first step is a MEASUREMENT, not a deploy** — deliberately, and it is the reason this track
leads the ingest chain rather than `media-pipeline`. D18 left the worker host undecided and reopened
Railway, which has **no GPU**. Whether that disqualifies Railway depends entirely on a number nobody
has: how much faster pose is on CUDA than on CPU. Deploying first and measuring later would be
choosing the host by guess.

**Starting position (2026-08-13), verified rather than assumed:**

| | |
|---|---|
| GPU | **CUDA is available** — GTX 1080 (Pascal, compute 6.1), `torch 2.13.0+cu126` |
| Pose | Runs on **CPU**. `swingsage/pose_rtm.py` hardcodes `device="cpu"` in the one `RTMPose(...)` call |
| Runtime | The installed `onnxruntime` was the **CPU-only build** — available providers were `AzureExecutionProvider` and `CPUExecutionProvider` only, so the GPU could not have been used even by changing that string |
| Club detector | Already uses the GPU (YOLO11s via ultralytics/torch). Pose is the stage that does not. |

So the GPU sits idle through the slowest stage of the pipeline. That is the measurement.
