# analyzer-service — Progress Log

Append-only. One entry per completed step: timestamp, what changed, anything worth keeping.

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
