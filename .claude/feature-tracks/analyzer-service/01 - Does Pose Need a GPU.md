# 01 - Does Pose Need a GPU

**Phase:** Platform Foundation
**Status:** complete

## Overview

The first step of this track is a **measurement, not a deploy** — deliberately. D18 left the
analyzer worker host undecided and reopened Railway, which has **no GPU**. Whether that disqualifies
Railway depends entirely on a number nobody had: how much faster pose runs on CUDA than on CPU.
Deploying first and measuring later would be choosing the host by guess.

## Steps

1. Establish whether CUDA is reachable at all from the analyzer's runtime.
2. Make the pose device configurable rather than hardcoded.
3. Measure CPU vs CUDA on a real fixture — **and whether the two agree**, because a keypoint that
   moves between hosts is a swing that scores differently depending on which machine analysed it.
4. Record the number and hand the host decision over with evidence attached.

## Verification

```
.venv\Scripts\python.exe -m pytest tests
.venv\Scripts\python.exe scripts/posebench.py out/<stem>/analysis.mp4 --frames 150
```

## Result

**CUDA is 2.32x faster, and agrees to within a pixel.**

| | CPU | CUDA |
|---|---|---|
| per frame | 70.4 ms | **30.4 ms** |
| 150 frames | 10.6 s | **4.6 s** |

Agreement across 6,150 compared keypoints: worst x/y disagreement **0.001305 normalized ≈ 0.94 px**
on the 720 analysis frame; worst confidence delta **0.000008**. Sub-pixel, and far below `MIN_CONF`
resolution — but **not bit-identical**, which matters for golden snapshots and cross-host
reproducibility (see D53).

Measured on a **GTX 1080** — a 2016 card, and the floor rather than the ceiling for what a GPU host
would give.

## Notes — three false results before the true one

This step produced **three** plausible wrong answers before a real one, all of the same shape: CUDA
silently falling back to CPU and the benchmark dutifully reporting the resulting non-difference.

1. **`onnxruntime` was the CPU-only build.** Its providers were `Azure` and `CPU` only, so the
   `device="cpu"` in `pose_rtm.py` was not even the binding constraint — the GPU was unreachable.
2. **`onnxruntime-gpu` 1.28 wants CUDA 13**; this machine has 12.6. It *advertised*
   `CUDAExecutionProvider`, failed to create it, fell back without raising, and the benchmark
   reported **0.98x**. Pinning 1.22 fixed the pairing.
3. **The forced-device path skipped the DLL setup.** There is no CUDA toolkit here; the CUDA 12 +
   cuDNN 9 DLLs onnxruntime needs are the ones **torch ships** in `torch/lib`, and importing torch
   is what puts them on the DLL search path. `pose_device()` did that import — but returned early
   when `SWINGSAGE_POSE_DEVICE` forced a device, which is exactly what the benchmark sets. So the
   one caller that asked for CUDA was the one caller that skipped enabling it, and the run reported
   **1.00x**.

Every one of those reads as *"the GPU does not help"* — a conclusion that would have picked the
production worker host off a measurement of CPU against CPU. **The fix that matters is not any of
the three: it is that `posebench.py` now asks the real session `get_providers()` and refuses to time
a CUDA pass that fell back.** `available` is a claim; a session is the capability.
