# 07 - Performance, GPU Runtime, Latency, and Cost

## 1. Current measured baseline

From the supplied production brief:

- RTMW pose: 26.1 ms/frame on L4;
- roughly 450 to 500-frame 60-fps-class job: 124.6 s end-to-end with variants off;
- variants-on development shape: 676.6 s;
- malformed roughly 2,445-frame slow-motion jobs reached 30+ minutes and timeout behavior;
- 60-fps-class cost: roughly $0.03 to $0.05;
- correctly handled 240 fps current-pipeline cost was estimated around $0.15 to $0.25;
- p95 target: <180 s, p99 <300 s.

The redesign should first remove unnecessary work, then optimize the remaining kernels.

## 2. Optimization order

```text
1. stop processing wrong frames/stages
2. reduce full-frame work via ROI/crops
3. batch within one swing
4. keep decode/preprocess close to GPU
5. benchmark FP16/runtime exports
6. tune container startup/autoscaling
7. consider INT8 only after geometry gates pass
8. consider different GPU/provider only after the workload is correct
```

## 3. Intra-clip batching

A five-second clip is naturally batchable without waiting for another user's request.

Benchmark batch sizes:

```text
1, 4, 8, 16, 32
```

for each body and club model.

Measure:

- wall time;
- GPU utilization;
- GPU memory;
- billed CPU/GPU seconds;
- p50/p95 per-stage latency;
- numerical/geometric parity.

Prefer intra-clip batching over cross-user batching because it does not intentionally add queue latency.

## 4. GPU decode and preprocessing

Benchmark NVIDIA NVDEC/PyNvVideoCodec or equivalent GPU-resident decode path:

```text
NVDEC
 -> device frame
 -> GPU crop/resize
 -> batched inference
 -> compact CPU geometry
```

Compare against current FFmpeg/Python path.

Do not assume decode is the main bottleneck. Profile first.

## 5. Runtime matrix

For each candidate model benchmark:

```text
PyTorch baseline
PyTorch FP16
PyTorch compile if stable
ONNX Runtime CUDA
TensorRT FP16
```

INT8 is later because small subpixel localization errors can matter in club/body geometry.

Every runtime candidate must pass the same golden-set geometry tests.

## 6. Latency target budget

An initial target budget for a 240 fps five-second swing could be:

| Stage | Target wall-time class | Notes |
|---|---:|---|
| verify/frame manifest | 1 to 5 s | mostly CPU/decode metadata |
| coarse pass | 5 to 15 s | first progressive result |
| body refinement | 5 to 20 s | batched, sparse/direct forced frames |
| club refinement | 15 to 45 s | biggest uncertainty |
| event/impact + metrics | 3 to 15 s | mostly local windows/CPU |
| scoring/artifact commit | < 3 s | deterministic |
| interactive final | stretch 45 to 90 s | benchmark target |

These are architecture targets, not measured predictions.

## 7. Cost model

Use billed worker seconds rather than model FPS.

For current Modal pricing, store the price table in configuration rather than hard-code business logic. Compute:

```text
job_cost = GPU_seconds * GPU_rate
         + CPU_seconds * CPU_rate
         + memory_GB_seconds * memory_rate
         + storage/queue marginal costs
```

Primary operating KPI:

```text
dollars_per_accepted_view
```

where accepted means the swing passed quality gates and produced usable output.

Initial planning ceiling:

- <= $0.06 per analyzed camera view for 240 fps production swings;
- lower is desirable, but do not trade away accuracy to hit a cosmetic cost target.

## 8. GPU selection

Benchmark at least the current L4 and one cheaper/slower and one faster alternative if available.

Decision rule:

```text
minimize dollars/view
subject to:
  body accuracy >= gate
  club accuracy >= gate
  event accuracy >= gate
  p95 latency <= SLO
```

A faster GPU can be cheaper per completed job if it finishes enough faster. A cheaper hourly GPU can be more expensive if underutilized or too slow.

## 9. Cold start and warm strategy

Do not immediately pay for a permanently warm GPU.

Experiment with:

1. scale-to-zero baseline;
2. longer scaledown window during an active practice session;
3. buffer container during active demand;
4. worker/model preparation overlapping upload;
5. permanent minimum container only if the economics justify it.

Measure user-confirm to first-inference and incremental cost.

Practice sessions are bursty, so session-aware warmth may outperform a permanent pool.

## 10. Parallelism

After coarse pass, body, club, ball, and audio branches can overlap.

Benchmark:

- serial execution;
- same-container CUDA stream overlap where safe;
- CPU/GPU overlap;
- separate workers only if data transfer/startup cost does not erase gains.

Do not optimize wall time by simply doubling billed resources without tracking dollars/view.

## 11. Rendering removal from critical path

The mobile/web clients already draw geometry.

Therefore:

- final interactive result should not wait for overlay burn-in;
- contact sheets should use event frames only unless a feature needs more;
- share video is post-result optional work.

## 12. Performance instrumentation

Record per job:

```text
source/capture fps
unique frame count
frames selected per stage
pixels processed per stage
batch size
runtime/model/precision
GPU type
container cold/warm
stage start/end
GPU seconds
CPU seconds
memory high-water mark
R2 read/write bytes
retry/checkpoint behavior
final quality state
```

Without these fields, cost/latency regressions will be difficult to diagnose.
