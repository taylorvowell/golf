# 03 - Reproducible Environment and Worker Skeleton

**Phase:** Platform Foundation
**Status:** not-started

## Overview

The pipeline now has one programmatic entry point (step 02), but no machine other than the two
dev boxes can run it. Runtime dependencies are pinned nowhere — `requirements-dev.txt` carries
two test pins and a header admitting "reproducing a venv from scratch is still a manual job."
There is no Dockerfile anywhere in the repo, no `services/analyzer/service/` package, and the
GPU stack works by a fragile accident that is documented only in code comments: the CUDA 12 +
cuDNN 9 DLLs that `onnxruntime-gpu` links against are the ones **torch ships**, and a plain
`pip install torch` silently gives a CPU build.

This step makes the environment reproducible (pinned runtime requirements + a documented,
verified rebuild procedure), gives the analyzer a container image that runs the test suite
green from a clean build, and creates the `services/analyzer/service/` worker skeleton: a job
spec → `AnalysisRequest` → `pipeline.run()` runner emitting structured JSON-line events — the
container's entrypoint that later steps (queue delivery, storage I/O, Postgres job state)
flesh out. It is deliberately **host-agnostic**: the worker host is an OPEN handoff row
(Taylor's, spend), and nothing here depends on it.

## Dependencies

- In-track: step 02 (complete) — `swingsage/pipeline.py` with `AnalysisRequest` /
  `PipelineEvent` / `run()` is the surface the worker skeleton consumes.
- Cross-track: none. Explicitly does NOT need the worker-host decision, QStash wiring, or
  object storage — those are later steps of this track.

## Architectural Context

- **Pin what is measured, not what is minimal.** The versions on this machine are the ones
  step 01's 2.32x measurement and D53's determinism baseline were taken on: `torch
  2.13.0+cu126`, `onnxruntime-gpu 1.22.0` (CUDA-12-major match — 1.28 wants CUDA 13),
  `mediapipe 1.0.0`, `opencv-python 5.0.0.93`, `numpy 2.3.5`, `scipy 1.18.0`, `ultralytics
  8.4.115`, `rtmlib 0.0.16`, `jsonschema 4.26.0`. One `requirements.txt`, exact pins, with the
  torch cu126 `--extra-index-url` line in the file. The cu126 wheels run fine on CPU-only
  machines — the cost is image size, which is an optimization for later, not a correctness
  question now.
- **The DLL trick must survive containerization.** `pose_rtm.py:_enable_cuda_dlls()` imports
  torch to put `site-packages/torch/lib` on the DLL/library search path; skipping it makes
  `InferenceSession(providers=["CUDA..."])` silently return a CPU session. On Linux the same
  dependency holds via `ld` search paths. `pose_device()`'s probe + `SWINGSAGE_POSE_DEVICE`
  force is the honesty mechanism — the container must not defeat it.
- **Model assets are volumes, not image layers.** ~630 MB total: `models/
  pose_landmarker_heavy.task` (30 MB, manual download), the rtmlib cache (~410 MB,
  self-downloading from URLs hardcoded in `pose_rtm.py`), and `runs/clubhead/weights/best.pt`
  (19 MB, **trained locally — no reproducible fetch path exists**; it lives only on the two
  dev machines). The image carries code + pip deps; assets mount at their existing relative
  paths. Baking the club weights into an image would silently version them — they are
  overwritten by every retrain and hashed at load time for exactly that reason.
- **The worker skeleton is a seam, not a service.** `service/worker.py` consumes a versioned
  job-spec JSON and emits `PipelineEvent`s as JSON lines. No queue, no storage, no DB — those
  are later steps. The stdout-regex protocol belongs to `burnin.py`/`jobs.ts` and is untouched;
  the worker's JSON-line events are a new, additive surface with no existing consumers.
- **ffmpeg is a system dependency** (`shutil.which("ffmpeg")` in `video.py`/`render.py`). The
  dev machine runs ffmpeg 9 (no `-vsync`; code already uses `-fps_mode`), so any container
  ffmpeg ≥ 5.1 is compatible.

## Files & Areas Touched

- `services/analyzer/requirements.txt` — new: pinned runtime deps + torch index line.
- `services/analyzer/requirements-dev.txt` — header rewritten (no longer "manual job"; fix the
  dead pointer to a CLAUDE.md toolchain table that actually lives in `docs/CURRENT-STATE.md`).
- `services/analyzer/Dockerfile` + `services/analyzer/.dockerignore` — new: python base image
  (newest python with linux wheels for every pin), ffmpeg via apt, pip install from pins,
  entrypoint `python -m service.worker`.
- `services/analyzer/service/` — new package: `__init__.py`, `worker.py` (job spec →
  `AnalysisRequest` → `run()` → JSON-line events → exit code).
- `services/analyzer/tests/` — new unit tests for job-spec parsing/validation and event
  serialization (pipeline `run` monkeypatched; no heavy fixtures).
- `.gitignore` — fix the dead "see docs/STATUS.md for the URLs" pointer (STATUS.md does not
  exist; point at `docs/RUNBOOK.md`'s new section).
- `docs/RUNBOOK.md` — new section: venv rebuild from scratch (incl. torch cu126 index and the
  onnxruntime-gpu/CUDA-major rule), model-asset acquisition table, container build/run.
- `docs/CURRENT-STATE.md` §11 — toolchain table updated: pins now exist; fix the numpy drift
  (installed 2.3.5, table says 2.5.1).
- `docs/decisions/analysis-and-ai.md` — one present-tense entry: the environment is pinned,
  the pins mirror the measured configuration, assets mount as volumes.

## Steps

1. Generate the pinned `requirements.txt` from the working venv's installed dist-info (direct
   deps only — numpy, opencv-python, opencv-contrib-python if actually imported, scipy,
   mediapipe, torch, torchvision, ultralytics, rtmlib, onnxruntime-gpu, jsonschema), verify
   `cv2` contrib usage before including it, and note/remove the stale
   `opencv_python_headless 4.10` in the venv if it shadows anything.
2. Rewrite the `requirements-dev.txt` header: dev-only pins, pointer to `requirements.txt`,
   correct doc reference.
3. Write `service/worker.py`: a versioned job-spec (`{"schema": 1, "video": ..., "out_dir":
   ..., "view": ..., "handedness": ..., "club_detector": ..., ...}`) read from a file path
   argument or stdin; strict validation (unknown fields rejected, club detector never
   defaulted); maps to `AnalysisRequest`; runs `pipeline.run()` with an `on_event` that writes
   one JSON object per line to stdout; `PipelineError` → non-zero exit with the message as the
   failure reason.
4. Unit tests: spec → request mapping (round-trip the fields it covers), rejection cases,
   event JSON-line shape with `run` monkeypatched.
5. Write the Dockerfile: slim python base, apt ffmpeg, `pip install -r requirements.txt`
   (layer-cached), copy `swingsage/`, `scripts/`, `service/`, `scoring_config/`, declare the
   three asset mount points, entrypoint `python -m service.worker`. `.dockerignore` excludes
   `out/`, `.venv/`, `runs/`, `models/`, caches, fixtures.
6. Build the image (background — multi-GB wheel download) and run the test suite inside it:
   `docker run --rm <img> python -m pytest tests`. Chase wheel/platform failures until green;
   record the chosen python version in the RUNBOOK section.
7. Update the four docs (`RUNBOOK`, `CURRENT-STATE` §11, `.gitignore` pointer, decisions
   entry).

## Quality Standards

- No behavior change to `burnin.py`, `pipeline.py`, or the stdout protocol — this step only
  adds surfaces around them.
- The club-detector no-default rule holds in the job spec exactly as it does in the CLI.
- Exact `==` pins; the file states *why* these versions (measured configuration) so the next
  upgrade is a decision, not an accident.
- The worker emits nothing but JSON lines on stdout (diagnostics to stderr) so a future
  consumer never has to regex-filter it.

## Verification

All from `services/analyzer/` unless noted.

```
# 1. Suite green locally, including the new service tests
.venv\Scripts\python.exe -m pytest tests

# 2. The image builds from a clean context (background; first build downloads GBs)
docker build -t swingsage-analyzer:dev .

# 3. The suite is green INSIDE the container — the from-scratch reproducibility proof
docker run --rm swingsage-analyzer:dev python -m pytest tests

# 4. The worker skeleton round-trips a spec without running the pipeline
#    (covered by the unit tests in gate 1; spot-check the CLI shape manually if desired)
```

A pass is: gates 1–3 all green. Gate 3 is the load-bearing one — it proves the pinned
requirements reconstruct a working environment with zero manual steps.

## Definition of Done

- `requirements.txt` exists with exact pins and the torch index line; `requirements-dev.txt`
  header no longer describes rebuilds as manual.
- `services/analyzer/service/worker.py` + tests exist; `Dockerfile` builds; in-container
  pytest is green.
- RUNBOOK has the venv-rebuild + asset + container section; CURRENT-STATE §11 reflects
  reality; the `.gitignore` dead pointer is fixed; the decisions entry exists.

## Notes

- The club-head weights (`best.pt`) remain unreproducible outside the dev machines — getting
  them into a deployed worker (artifact registry? storage bucket?) is a later-step decision
  that the volume-mount seam deliberately leaves open.
- Image-size optimization (CPU-only torch variant for a CPU host) is explicitly deferred until
  the worker-host handoff row closes; one fat, faithful image beats two divergent ones today.
- In-container pytest runs the same frozen test data as local; the 2 standing skips are
  model-dependent and stay skips in the container (no assets mounted during gate 3).
