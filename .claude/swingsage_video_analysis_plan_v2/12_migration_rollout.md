# 12 - Migration, Shadow Validation, Rollout, and Rollback

## 1. Goal

Replace the current analysis architecture without breaking existing mobile/web clients or historical reports.

## 2. Feature flags

Add independent flags for:

```text
source_manifest_v2
frame_manifest_v2
adaptive_body_sampling
club_pose_v2
club_sequence_solver_v2
impact_fusion_v2
progressive_revisions_v2
gpu_decode_v2
tensorrt_body_v2
tensorrt_club_v2
visual_trim_fallback_v1
deferred_presentation_render_v1
```

Avoid one monolithic "new pipeline" switch.

## 3. Compatibility strategy

Keep current published 49-keypoint output contract via adapter.

Old clients can continue receiving a final materialized `analysis.json` shape while new clients understand revisions/provenance.

Do not require simultaneous mobile + web + analyzer deployment.

## 4. Migration phases

### Phase A - No-output-change foundations

Ship:

- trim/source manifest;
- server frame manifest;
- pre-GPU workload guard;
- stage timing instrumentation;
- retry classification/checkpoints.

Expected user output remains unchanged.

### Phase B - Evaluation infrastructure

Ship internal only:

- annotation schema;
- golden-set evaluator;
- artifact diff tool;
- benchmark dashboards.

### Phase C - Adaptive body in shadow mode

Run old and new body policies on a sample of swings.

Compare:

- event-frame geometry;
- score decisions;
- confidence;
- GPU seconds.

Do not show new body output yet.

### Phase D - Club pose shadow mode

Run club-pose v2 on sampled jobs while production output remains current.

Store evaluation artifacts separately.

Promote only after positional GT gates pass.

### Phase E - Impact fusion shadow mode

Compute old and new impact simultaneously. Review disagreement, especially high-confidence large differences.

### Phase F - Progressive client support

New clients render coarse/body/club revisions. Final artifact remains backwards-compatible.

### Phase G - Runtime optimization

Only after semantic outputs are stable, change runtime/decode/precision one piece at a time with golden regression.

### Phase H - Pre-upload visual fallback

Roll out by device cohort after battery/latency validation.

## 5. Rollout percentages

For model/semantic changes:

```text
internal -> 1% -> 5% -> 20% -> 50% -> 100%
```

Hold each step long enough to observe:

- latency;
- cost;
- failure rate;
- abstention rate;
- quality-disagreement telemetry;
- support/user complaints.

## 6. Rollback

Because analysis runs are immutable and versioned:

- new jobs can immediately return to prior pipeline/model versions;
- historical new-version analyses remain reproducible;
- do not overwrite artifacts;
- database latest-run pointer can choose the accepted production run.

## 7. Re-analysis

Do not automatically re-analyze all historical swings when models improve.

Options:

- re-analyze on user request;
- re-analyze recent/favorite swings;
- background batch only when economics justify it;
- keep old scoring/model version visible for reproducibility.

## 8. Rollout stop conditions

Automatically halt promotion on:

- frame identity mismatch;
- increased high-confidence catastrophic impact errors;
- increased high-confidence club false positives;
- scoring regression beyond gate;
- p95/p99 latency breach;
- cost/view breach;
- rising terminal job failures;
- unexpected client revision/render bugs.
