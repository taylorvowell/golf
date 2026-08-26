# 12 - Runtime & GPU Optimization

**Phase:** Optimization
**Status:** not-started
**Estimated effort:** 2–3 sessions (experiments dominate)

## Overview

**Objective:** optimize the now-correct workload (plan 07, WP-037..041, E5.x) — batching,
precision/runtime exports, GPU decode, GPU class, warm strategy — each change one at a time,
golden-parity gated, decided on dollars per accepted view under the latency/accuracy gates.

**Current state:** RTMW batch 1 (26.1 ms/frame L4); PyTorch/ORT default precision; OpenCV
CPU decode (post step 06: shared, but still CPU); L4 only; scale-to-zero with 300 s
scaledown; no cost model beyond elapsedS.

**Target state:** measured, recorded choices for batch size, runtime (ORT CUDA vs TensorRT
FP16 vs torch.compile), decode path (NVDEC only if it wins), GPU class (L4 vs one
cheaper + one faster), and warm strategy (scale-to-zero vs session-aware windows vs
upload-overlap prewarm) — with the price table in config and dollars/accepted-view computed
from step-05 telemetry. INT8 only after geometry gates pass, and only if FP16 isn't enough.

## Dependencies

- Steps 04 (golden parity gates), 05 (cost attribution), 06 (decode seam), 07 (the workload
  is the adaptive one — optimizing the dense pipeline would tune numbers step 07 deletes).
- Steps 09/10 promoted or at least stable (semantic stability before runtime churn — plan
  Phase G).

## Architectural Context

Matrix rows 27–29, 44–45; plan 07 §2 order. Every runtime candidate passes the SAME golden
geometry tests (E5.2's rule: no runtime is promoted without parity). Warm strategy respects
the practice-session burst pattern (many swings/hour) — session-aware warmth (extend
scaledown during an active session; QStash flow control already keys per user) before any
permanent pool; upload-overlap prewarm (plan 01 §8) is an experiment here, not a default.

## Files & Areas Touched

- `services/analyzer/swingsage/pose_rtm.py` (batching, runtime backends), `clubpose/`
  (same), `frames.py` (NVDEC backend option), `service/modal_app.py` (GPU class, scaledown,
  prewarm hook), `scripts/` benchmark harnesses, config price table

## Steps

1. **E5.1 batch sweep** (1/4/8/16/32) per model on L4 via bench; parity via
   compare_analysis; pick per-model batch, record.
2. **E5.2 runtime sweep**: ORT CUDA (current) vs TensorRT FP16 (via ORT TensorRT EP or
   native) vs torch path where applicable; golden parity + calibration not worse (FP16
   confidence drift is a real risk — the calibration check from step 04 applies).
3. **E5.3 GPU decode**: NVDEC/PyNvVideoCodec behind the FrameProvider seam; adopt only on
   measured wall/cost win (profile first — decode may not dominate post-07).
4. **E5.4 GPU class**: L4 vs one cheaper (e.g. T4) and one faster (e.g. A10G/L40S as Modal
   offers); decision = min dollars/accepted-view subject to gates.
5. **E5.5 warm strategy** (WP-041): measure user-confirm→first-inference and incremental
   cost for scale-to-zero / longer scaledown during active session / upload-overlap prewarm
   (API pokes a warm endpoint at `source/complete`). No permanent warm pool without
   economics.
6. **Cost model.** Price table in config; `dollars_per_accepted_view` computed in the step-05
   reader; the ≤$0.06/view 240 fps planning ceiling checked and reported.
7. Each adopted change: its own commit + decision entry + golden run.

## Quality Standards / Verification

- Golden CI parity for every adopted runtime change; calibration gates.
- Measured report per experiment (plan output format); the 240 fps end-to-end number
  RE-MEASURED (the 5–12 min extrapolation dies here — target: inside SLO).
- Analyzer pytest green throughout.

## Migration Considerations

All server-internal; runtime flags per model version recorded in run manifests (step-05
records) so old artifacts remain attributable.

## Technical-Debt Impact

**Neutral to reducing** — each candidate either adopted (recorded) or deleted; no parallel
runtimes persist (the losing backends are not kept behind flags).

## Observability

Runtime/precision/GPU/batch fields already in the step-05 record; cost/view by fps class.

## Rollback

Per-change flags during evaluation only; adopted = default, rejected = removed.

## Cleanup

Benchmark harnesses stay under scripts/ (evaluation infra); rejected-path code removed in
the same session it loses.
