# 10 - Infrastructure, Job Orchestration, Reliability, and Observability

## 1. Keep the existing platform initially

The existing topology is suitable for this redesign:

- Vercel API;
- Supabase Postgres;
- Cloudflare R2;
- QStash;
- Modal GPU worker.

Do not add a new queue, orchestration platform, or GPU provider until benchmark data shows a real need.

## 2. Job identity and idempotency

Define an idempotency key from:

```text
view_id
source_media_hash
source_manifest_hash
pipeline_version
model_versions
frame_policy_version
scoring_version
```

If an identical successful run already exists, return/reuse it rather than recomputing.

## 3. QStash delivery versus analysis retry

Separate:

### Delivery retry

QStash may redeliver a request if delivery failed.

The worker endpoint must be idempotent.

### Stage retry

Only retry a stage when the failure class is genuinely transient.

Examples:

Retryable:

- worker/container infrastructure death;
- temporary R2 read failure;
- transient API callback failure;
- GPU allocation failure.

Terminal/non-retryable:

- impossible frame count;
- unsupported codec;
- invalid source manifest;
- deterministic out-of-memory for known configuration;
- deterministic stage timeout due to planned workload;
- quality gate indicating no usable golfer/video.

## 4. Checkpoint strategy

Write immutable stage checkpoints to R2.

At stage start:

1. check for compatible completed checkpoint;
2. verify hash/version;
3. load it if present;
4. run only missing work.

This prevents a render or callback failure from rerunning expensive club/body stages.

## 5. Workload guard

Before allocating GPU compute, calculate:

```text
unique source frames
real duration
capture fps
planned pose direct frames
planned club global frames
planned native club frames
resolution/pixel budget
estimated memory
estimated worst-case stage budget
```

Reject or select a safe fallback policy before inference if limits are exceeded.

## 6. Timeout policy

Use stage-specific soft budgets plus job hard timeout.

A timeout object should record:

```json
{
  "stage": "club_refinement",
  "elapsed_s": 240,
  "planned_frames": 430,
  "completed_frames": 382,
  "failure_class": "stage_budget_exceeded",
  "retryable": false
}
```

Do not automatically rerun the same deterministic workload twice.

## 7. Progress events

Progress messages should represent actual milestones, not fake percentages.

Recommended fields:

```text
job state
stage
stage items complete/total
coarse/body/club/final readiness
elapsed time
provisional/final status
```

Client can continue current polling initially. Later, realtime push can be evaluated separately if polling becomes a cost/UX issue.

## 8. Observability event schema

Every job emits structured events with:

```text
job_id / view_id / analysis_run_id
pipeline/model/policy versions
capture fps / unique frames / resolution
selected frame counts per stage
container cold/warm
GPU type
batch size
runtime/precision
stage timing
GPU/CPU/memory seconds
R2 bytes
quality gates
confidence summary
retry/checkpoint state
failure class
```

## 9. Dashboards

Minimum operational dashboards:

### Latency

- upload-complete to coarse-ready p50/p95/p99;
- upload-complete to analysis-ready p50/p95/p99;
- per-stage latency by FPS/device/worker version.

### Cost

- GPU seconds/view;
- total worker cost/view;
- cost by 30/60/120/240;
- retry waste;
- failed-job spend.

### Quality

- pose quality gate rate;
- club usable/abstain rate;
- impact confidence distribution;
- high-confidence disagreement alerts;
- trim fallback/manual-adjust rates.

### Reliability

- terminal/retryable failures;
- orphan jobs;
- checkpoint resume success;
- QStash redeliveries;
- timeouts.

## 10. Orphan sweeper

Replace a single long heartbeat assumption with explicit lease/heartbeat semantics.

A running job owns a lease until time T and periodically extends it.

Sweeper behavior:

- expired lease + no active worker -> recover or fail according to checkpoint state;
- do not infer completion from lack of callbacks alone;
- never duplicate a still-valid active lease.

## 11. Dual-camera future

A two-camera swing remains two view analysis jobs.

Shared opportunities:

- same parent swing/session ID;
- coordinated scheduling/warm container reuse;
- shared club/body model caches;
- optional cross-view event agreement after each view independently produces events;
- never let one camera fabricate missing geometry in the other unless a future calibrated multi-view feature explicitly supports it.
