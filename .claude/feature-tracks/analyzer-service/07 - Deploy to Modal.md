# 07 - Deploy to Modal

## Overview

Put the queue-driven worker on its decided production host — **Modal** (D64) — and prove the
loop on it. Steps 02–06 made this deliberately small: the pipeline is one entry point
(`pipeline.run`), the environment is a reproducible image, the queue loop is proven against
the QStash dev server, every model asset is hash-pinned with a fetch path, and the worker
holds no credential beyond the per-job token. What remains is expressing that worker as a
Modal app, deploying it, re-proving the e2e loop with **production QStash** delivering to the
real host, and re-measuring the capacity model against the p95 < 180s analysis SLO.

**One design change is forced by the host.** Modal web endpoints cap a single HTTP request at
~150s, and `service/server.py` holds the QStash delivery open for the whole pipeline run
(76–407s measured). On Modal the worker therefore splits into the platform's idiomatic shape:

- **`ingress`** — a small CPU web function (FastAPI over `@modal.asgi_app`) serving
  `POST /jobs` + `GET /healthz`. It verifies the QStash signature (same `qstash.Receiver`,
  same `WORKER_PUBLIC_URL` exact-match rule), validates the schema-2 spec
  (`jobrun.parse_queue_spec`), **`spawn`s** the pipeline function, and acks 200 immediately.
  401 bad signature / 400 unusable spec keep their meanings at the door.
- **`run_job`** — a GPU (L4) Modal Function with a long timeout that runs the existing
  `jobrun` work: source download, `pipeline.run`, artifact PUTs, events, verified done.
  Single-flight becomes per-container (Modal runs one input per container by default);
  global concurrency is capped by `max_containers`; per-user parallelism stays QStash
  flowControl's job.

**Retry semantics move, and the move must be recorded.** Today an infra failure 5xxs the
delivery and QStash redelivers. On Modal the delivery has already been acked, so:
QStash retries now cover only failure to *accept* (Modal down, spawn failure, bad spec —
which then dead-letters into the existing `failureCallback`); mid-run infra failures are
retried by **Modal** (`modal.Retries` on `run_job`); a job that still dies is settled by the
step-05 orphan detection (heartbeat 900s → reconcile settles it failed). Refusals
(`PipelineError`) are unchanged: terminal `failed` event, never retried.

`service/server.py` is not deleted — it remains the local-dev worker and the RUNBOOK loop.
`service/modal_app.py` is additive.

## Dependencies

- Steps 02–06 complete (they are).
- External (all verified 2026-08-22, per `_PROGRESS.md`): Modal CLI authenticated
  (`taylorvowell`), production QStash token + signing keys in
  `production-credentials.local.txt`, R2 buckets exist, `models:publish` path works.

## Architectural Context

- **D26 holds on Modal.** The worker still sees only URLs + the per-job HMAC token. The
  private club weights reach Modal the same way they reach Docker: a signed URL
  (`SWINGSAGE_CLUB_WEIGHTS_URL`) minted by `pnpm --filter web models:publish`, stored in a
  **Modal Secret**, consumed once by a fetch that hash-verifies against the committed
  manifest. No storage credential ever lands on Modal.
- **Model assets live on a `modal.Volume`, not image layers** — the same rule the Dockerfile
  states for Docker. `SWINGSAGE_MODEL_ROOT` and `SWINGSAGE_RTMLIB_CACHE` (built in step 06
  for exactly this) point into the volume. A one-shot `fetch_models` function populates it;
  `run_job` containers re-verify hashes (`--check`, no network) before serving, preserving
  step 06's "refuses to run without verified assets" property.
- **The image is the existing Dockerfile**, built by `modal.Image.from_dockerfile` with a
  trimmed context (Modal caps build context at 100MB; the Dockerfile only COPYs
  `services/analyzer` code + `packages/schema/schemas`, so an ignore list keeps the context
  tiny). FastAPI is layered on top for `ingress` only. No second environment definition.
- **Pose must actually run on CUDA.** Step 01's entire lesson is that CUDA silently falls
  back to CPU and reads as "the GPU does not help". Set `SWINGSAGE_POSE_DEVICE=cuda` on
  `run_job` and confirm the measured per-frame pose cost is GPU-class (~30ms/frame, not
  ~70ms), on top of any wall-clock number.
- **The web app is not deployed yet** (platform-foundation step 10 owns migrations +
  Vercel). The e2e therefore runs with the local Next dev server exposed through a
  **cloudflared quick tunnel** — production QStash and the Modal worker are the real things
  under test; the control plane is the same code that will deploy. `APP_INTERNAL_BASE_URL`
  is the single origin embedded in specs, so the tunnel URL flows to source/artifacts/events
  automatically.
- **`club_variants` stays ON for this step's e2e and the flag's production default is NOT
  decided here** — it is a pending proposal for Taylor
  (`.claude/architecture/swing-analysis-speed-2026-08-18.md` §5). This step *measures* both
  shapes on the real host so that decision has numbers.

## Files & Areas Touched

- `services/analyzer/service/modal_app.py` — new: the Modal app (image, volume, secret,
  `ingress`, `run_job`, `fetch_models`, a `bench` local entrypoint for the capacity numbers).
- `services/analyzer/service/jobrun.py` — only if a seam is needed (e.g. exposing spec
  parse separately); behavior unchanged.
- `services/analyzer/tests/` — tests for the ingress ack/spawn decision logic (pure parts;
  no network).
- `apps/web/.env.example` — the production-queue block gains the Modal worker URL shape.
- `docs/decisions/platform-data.md` — edit the QStash/Modal entry in place: deployed shape,
  retry-semantics move, measured capacity.
- `docs/ENVIRONMENT.md` — Modal section: app name, endpoint URL, secret name, volume name.
- `docs/RUNBOOK.md` — deploy procedure, secret refresh on club-weights republish,
  e2e-against-Modal procedure.
- `.claude/feature-tracks/analyzer-service/_STATUS.json` / `_PROGRESS.md` — via tracker.

## Steps

1. **Write `service/modal_app.py`.** App `swingsage-analyzer`; image
   `from_dockerfile("services/analyzer/Dockerfile")` with an ignore list that keeps the
   context under 100MB; `.pip_install("fastapi[standard]")` layered for ingress; volume
   `swingsage-models` mounted at `/mnt/models`; secret `swingsage-analyzer` (QStash signing
   keys, `SWINGSAGE_CLUB_WEIGHTS_URL`, `WORKER_PUBLIC_URL`); env
   `SWINGSAGE_MODEL_ROOT=/mnt/models/app`, `SWINGSAGE_RTMLIB_CACHE=/mnt/models/rtmlib`,
   `SWINGSAGE_POSE_DEVICE=cuda`, `SWINGSAGE_SKIP_MODEL_BOOTSTRAP=1` (bootstrap is explicit
   here, not entrypoint-driven). `run_job`: `gpu="L4"`, `timeout=1800`, `cpu=8`,
   `memory=16384`, `retries=modal.Retries(max_retries=2)`, hash-`--check` before work.
   `ingress`: CPU, verifies signature against `WORKER_PUBLIC_URL`, validates spec, spawns,
   acks `{"accepted": true}`.
2. **Create the Modal secret** from `production-credentials.local.txt` + a fresh
   `models:publish` signed URL. Values never printed; use a scratch dotenv →
   `modal secret create --from-dotenv` → delete.
3. **Populate the volume**: `modal run service/modal_app.py::fetch_models`; verify it exits
   green and a second run is a no-op (`--check` all-ok).
4. **Deploy**: `modal deploy service/modal_app.py`. Read the printed ingress URL; write it
   into the secret as `WORKER_PUBLIC_URL` (exact-match rule) and redeploy if it changed.
   `curl /healthz` → 200; unsigned `POST /jobs` → 401.
5. **Bench on the real host** (`modal run service/modal_app.py::bench` against a fixture
   staged on the volume): production shape (`club_variants=False`) and the dev shape, both
   timed; per-frame pose ms captured to prove CUDA is real (step-01 rule).
6. **E2E on the real rails**: cloudflared quick tunnel → local :3000; run
   `pnpm --filter web queue:e2e` with `QSTASH_URL`/`QSTASH_TOKEN` (production),
   `WORKER_URL` (Modal ingress `/jobs`), `APP_INTERNAL_BASE_URL` (tunnel) overridden in the
   shell (process env beats `--env-file`); `WORKER_CLUB_DETECTOR` set to the in-image path.
   PASS = job done, view revision advanced, `analysis.json` published.
7. **Re-derive the capacity model** from the measured numbers (jobs/hr/container, $/swing at
   L4 per-second pricing, cold-start cost, p95 vs the 180s SLO, what the SLO needs —
   variants-off and/or horizontal scale) and record it in `docs/decisions/platform-data.md`.
8. **Documentation** per the file list above; `_STATUS`/`_PROGRESS` via tracker.

## Quality Standards

- No storage or DB credential on Modal, ever (D26). The secret holds signing keys, one
  signed weights URL, and the worker's own public URL — nothing else.
- The club detector is never defaulted (standing trap): the spec still names it explicitly
  and a stated-but-absent path is still a `SpecError` at parse.
- No silent CPU fallback: the capacity numbers must include per-frame pose cost, and a
  CPU-class number fails the step even if the wall clock looks fine.
- `server.py` local loop untouched and still green — Modal is additive.
- Secrets never appear in tool output, the repo, or the step file.

## Verification

```
# 1. Analyzer suite (from services/analyzer/) — new ingress-logic tests included
.venv\Scripts\python.exe -m pytest tests

# 2. Deployed app exists and its endpoint answers
.venv\Scripts\python.exe -m modal app list   # swingsage-analyzer deployed
curl -sf <INGRESS_URL>/healthz               # 200 {"ok": true}

# 3. Signature is enforced at the door
curl -s -o /dev/null -w "%{http_code}" -X POST <INGRESS_URL>/jobs -d '{}'   # 401

# 4. The loop, end to end, on the real host and real queue
#    (tunnel up, env overridden as in Steps 6)
pnpm --filter web queue:e2e                  # PASS: done, revision advanced, published

# 5. Web oracle
pnpm --filter web exec tsc --noEmit
pnpm --filter web lint
pnpm --filter web test
```

Pass = all green, plus the bench numbers recorded (both pipeline shapes + per-frame pose ms
proving CUDA) in `docs/decisions/platform-data.md`.

## Definition of Done

The worker runs on Modal behind a signature-verified public endpoint; production QStash
delivered a real job to it and the full loop (source → pipeline on L4 → artifacts → verified
done → Postgres view flip) passed; retry/dead-letter semantics on the new host are stated in
the decisions register; the capacity model is re-measured on the real host class with honest
GPU numbers and compared against the p95 < 180s SLO; and a club-weights republish has a
documented one-page path to the running worker (publish → secret update).

## Notes

- The web app's own production deploy (Vercel + migrations on `swingsage-prod`) is
  **platform-foundation step 10**, not this step. The tunnel is the honest interim: it
  proves the worker host and the queue rails without pretending the web side is deployed.
- QStash production limits tolerate long synchronous responses (15m free / 2h paid), so the
  150s constraint is Modal's, not QStash's — the spawn shape is a host adaptation, not a
  queue requirement.
