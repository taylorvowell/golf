# 06 - Shared Decode & Pipeline Restructure

**Phase:** Analysis Core
**Status:** not-started
**Estimated effort:** 2–3 sessions

## Overview

**Objective:** remove the structural waste that makes 240 fps infeasible regardless of any
model choice: 18 video-decode passes with zero frame sharing, ~10 MB/frame residency per
`club.track` call, MOG2 run 24× per variants job, and the RTMPose session rebuilt per job.
This is the enabling refactor for steps 07/09 — behavior-preserving, proven by artifact
parity.

**Current state (audit):** OpenCV sequential decode in every stage; `pose.estimate`,
`pose_rtm.estimate`, `club_detect.run` (all BGR frames in RAM), `club.track` (gray + blur +
Sobel gx/gy + MOG2 masks, all full-clip lists), `face.analyse`, `render.burn_in` each decode
independently. A 1,200-frame 240 fps clip ≈ 12 GB resident in one `club.track` call vs 16 GB
on the worker — latent OOM. Session/model loads are per-job even on warm containers.

**Target state:** one `FrameProvider` abstraction (sequential decode once per resolution
tier, chunked/streaming, bounded memory) consumed by pose, detector, club, face and render;
derived planes (gray/blur/gradients/motion masks) computed per chunk, not materialized
full-clip; RTMPose/YOLO sessions cached at module level for warm-container reuse; a memory
budget assertion replacing the latent OOM.

## Dependencies

- Step 05 (before/after timing is measured, not asserted).
- Step 04 recommended (golden CI catches drift) — hard dependency is `compare_analysis.py`
  which already exists.

## Architectural Context

Matrix rows 28–29; plan 07 §2 optimization order items 1–4 (this is "stop processing wrong
frames" enablement + "keep decode close" groundwork; NVDEC itself is step 12). Justified
speculative-abstraction test: the provider has ≥5 real consumers on day one.

## Files & Areas Touched

- `services/analyzer/swingsage/frames.py` (new FrameProvider), `pose.py`, `pose_rtm.py`,
  `club_detect.py`, `club.py`, `face.py`, `render.py`, `pipeline.py`
- `services/analyzer/tests/` (parity + memory-budget tests)

## Steps

1. **FrameProvider.** Sequential chunked decode (configurable chunk, default ~64 frames) with
   per-consumer plane requests (bgr/gray/blur/sobel) computed once per chunk and released;
   random-access path for retry_gaps/contact_sheet stays direct VideoCapture.
2. **Restructure `club.track`** to stream chunks: motion masks (3-frame diff needs a 2-frame
   tail), MOG2 (train once per JOB, not per call — its double-pass stays but on the shared
   provider), Sobel per chunk. The angular/shaft profile accumulation is already per-frame;
   the global DP over bins is unchanged (needs profiles, not pixels).
3. **Single-decode composition** in `pipeline.run`: pose-localiser + RTMW + detector + face
   share one pass where cadence allows (they are all every-frame today); club consumes the
   same provider in its own pass if fusing is awkward — target ≤3 full decodes of
   analysis.mp4 (from 16 with variants on / 5 off).
4. **Session reuse.** Module-level cached RTMPose + YOLO + MediaPipe options keyed by
   model/config; Modal warm container skips reload (preflight already verifies hashes).
5. **Memory budget.** Provider tracks high-water; assert against a configured ceiling; guard
   (step 01) uses est-frames × per-frame cost as its memory check input.
6. **Parity.** `compare_analysis.py --tol` between pre- and post-refactor artifacts on all
   ten fixtures (variants off and on): geometry identical within float tolerance. MOG2
   train-once is the one permitted numeric delta — if it moves geometry beyond tolerance,
   keep per-call training and record why.

## Quality Standards / Verification

- Analyzer pytest green; goldens unchanged (this refactor must not move numbers beyond the
  MOG2 exception, which if taken re-goldens deliberately with the diff reviewed).
- `compare_analysis.py` clean on 10/10 fixtures.
- Step-05 telemetry before/after on the bench: decode passes ≤3, memory high-water reported,
  wall time not worse (expected better).

## Migration Considerations

Pure internal refactor; artifact bytes equivalent; no client, DB, or contract change. stdout
stage prints preserved verbatim (spawn scraper).

## Technical-Debt Impact

**Reduces** (audit structural debt #1, #2, #7). No temporary mechanisms.

## Observability

Step-05 spans gain `decode_passes` and `mem_high_water` fields.

## Rollback

Single revert; no persisted-state change.

## Cleanup

Dead code deleted in passing where touched: `video.crop_scale`, `pose.swing_bbox`,
`pose.remap_to_full`, `ClubFrame.cands` (audit housekeeping #18).
