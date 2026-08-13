# analyzer-service — Progress Log

Append-only. One entry per completed step: timestamp, what changed, anything worth keeping.

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
