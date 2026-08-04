# 03 — Body Position & Joint Tracking (the Stick Figure)

Goal: for every frame, a reliable 2D skeleton — head, neck, shoulders, elbows, wrists,
spine, hips, knees, ankles, feet — accurate enough to compute coaching-grade angles.
This document covers the research landscape, the chosen approach, and the full pipeline.

---

## 1. Research Landscape (2026)

Markerless human pose estimation is mature. Realistic candidates:

| Model | Keypoints | Speed | Accuracy | Notes |
|-------|-----------|-------|----------|-------|
| **MediaPipe Pose (BlazePose)** | **33 landmarks** incl. heels + foot tips | Very fast, CPU-friendly, Python API | Good | 3 sizes (lite/full/heavy). Also outputs rough 3D ("world landmarks") and per-point visibility scores. Best effort-to-value; huge community usage for golf specifically |
| **MoveNet (Thunder)** | 17 COCO | Very fast | Good — among the lowest joint-angle errors in gait studies alongside OpenPose | TF/TFJS; no extra keypoints for feet detail |
| **RTMPose (+RTMDet person detector, MMPose)** | 17 COCO / 26 halpe / 133 wholebody | Fast on GPU, fine on CPU for offline | **High** — this top-down stack is what Swing Catalyst uses for golf/baseball markerless capture | Best accuracy upgrade path; heavier setup (mmpose/onnxruntime) |
| ViTPose / HRNet | 17 | Slow | Highest | Overkill for v1; candidate for a future "pro re-analysis" mode |
| YOLOv8/11-pose | 17 | Fast | Medium | High recall, lower precision; not preferred as primary |
| OpenPose | 25 (incl. feet) | Slow, old tooling | Good | Historically strong but poor maintenance; skip |

**Decision: MediaPipe Pose "heavy" as the v1 engine, with an RTMPose upgrade path behind
the same interface.**

Why MediaPipe first:
- 33 landmarks natively include everything the product needs (eyes/ears/nose for head,
  shoulders, elbows, wrists, hips, knees, ankles, **heels and foot index/tips** — feet
  matter for golf: weight/flare/stance width).
- Per-landmark `visibility` doubles as our confidence score.
- Single `pip install mediapipe`; runs offline analysis at 60fps input comfortably.
- Known limitation to design around: it's a single-person, detector+tracker pipeline that
  can jitter or swap-sides in unusual poses — mitigated by our temporal post-processing
  (below) and by the fact that a golfer stays in-frame and roughly stationary.

Implementation rule: wrap pose behind `PoseEstimator` interface
(`estimate(frames) -> RawPoseSeries`), so `MediaPipeEstimator` and later `RTMPoseEstimator`
are drop-in. Store `pose.model` in analysis.json. If MediaPipe measurably fails on our
fixture set (occluded trail arm in DTL is the known hard case), escalate to RTMPose
(RTMDet person box → RTMPose halpe26, which adds head/neck and foot points) via
onnxruntime.

## 2. Skeleton Definition (product skeleton)

Native MediaPipe points used: nose, eyes, ears, shoulders (11,12), elbows (13,14), wrists
(15,16), hips (23,24), knees (25,26), ankles (27,28), heels (29,30), foot_index (31,32).
(Hand landmarks 17–22 exist but are unreliable when gripping a club — ignore; the club
pipeline owns the hands region.)

Derived points (computed in Stage 3, appended to the keypoint list):
- `neck` = midpoint(shoulders)
- `mid_hip` = midpoint(hips)
- `spine_mid` = midpoint(neck, mid_hip)  → spine drawn as neck→spine_mid→mid_hip
- `head_center` = midpoint(ears) (fallback: nose offset)
- `grip_center` = midpoint(wrists) — anchor for club detection (doc 04)

Bone list (for rendering + sanity checks): head_center–neck, neck–shoulderL/R,
shoulder–elbow–wrist each side, neck–spine_mid–mid_hip, mid_hip–hipL/R (implicit),
hip–knee–ankle each side, ankle–heel–foot_index each side.

## 3. Pipeline (Stage 2 + Stage 3)

### Stage 2 — Raw estimation
1. Decode frames at analysis resolution (720p is sufficient; keep aspect).
2. Run MediaPipe Pose (heavy, `min_detection_confidence=0.5`, tracking mode with
   `min_tracking_confidence=0.5`) frame-sequentially (its internal tracker exploits
   temporal continuity — do not parallelize frames across workers for v1).
3. Record per frame: 33 × (x, y, visibility) normalized, plus world landmarks (keep them —
   useful later for rough 3D angles like shoulder turn on DTL view).
4. If detection fails on a frame, record null; if it fails >N consecutive frames, retry
   that span with static image mode (detector every frame).

### Stage 3 — Post-processing (this is where quality is won)
Run in order:

1. **Confidence gate**: visibility < 0.3 → treat point as missing.
2. **Anatomical sanity checks** (per frame): bone lengths within ±35% of that bone's
   rolling-median length; left/right side-swap detection (if left/right shoulder/hip
   x-order flips for <5 frames relative to neighbors, swap back — classic pose glitch);
   points outside frame bounds → missing.
3. **Outlier rejection (temporal)**: per keypoint per axis, a point whose displacement from
   its neighbors exceeds a velocity threshold (calibrated per joint: wrists move fast in a
   swing — thresholds must be generous for wrists/elbows during downswing, tight for hips/
   ankles/head) → missing.
4. **Gap interpolation**: fill gaps ≤ 8 frames (~130ms) with cubic spline per axis; mark
   `interp: true`. Gaps > 8 frames stay missing (UI dashes the joint).
5. **Smoothing**: **One-Euro filter** per keypoint (great lag/jitter tradeoff; tune
   `min_cutoff≈1.0, beta≈0.3` on fixtures) — NOT a plain moving average (would lag the fast
   downswing and corrupt tempo/impact metrics). Optionally follow with Savitzky-Golay
   (window 7, order 2) since we're offline and can use non-causal smoothing.
6. **Derived joints** computed after smoothing.
7. **Quality report**: per-joint coverage %, mean confidence, list of low-confidence spans
   (feeds Stage 7 AI review and UI warnings).

### Known hard cases & mitigations
- **DTL trail-arm occlusion** (trail arm hidden behind body mid-swing): expected; rely on
  interpolation + visibility flags; never fabricate long occluded spans. Scoring in doc 05
  only uses trail-arm angles at events where it's visible.
- **Motion blur on wrists/club in downswing**: wrists usually survive (MediaPipe is
  torso-anchored); accept lower confidence for ~5 frames around impact.
- **Baggy clothing / low light**: quality gate + user guidance ("film in good light,
  contrasting clothes").
- **Multiple people in frame**: MediaPipe picks one — constrain by selecting the person
  whose bbox overlaps the motion-burst region from auto-trim; if wrong-person tracking is
  detected (skeleton teleports), re-run with an ROI crop around the golfer.

## 4. Optional Stage 7 — AI Correction Pass (Claude vision)

Deterministic CV handles ~95% of frames. For flagged low-confidence spans only:
1. Render the current skeleton overlay onto the actual frame image (a few representative
   frames per span, e.g. every 3rd).
2. Send to Claude (doc 07) with a strict prompt: "Here is frame N with our detected
   skeleton. Return JSON corrections only for joints that are visibly misplaced:
   `{frame, joint, x, y} | {frame, joint, status:'occluded'}`. Coordinates normalized."
3. Validate corrections (schema + anatomical sanity vs. neighbors); apply, mark
   `source:'ai'`, re-run local smoothing across the span.
Budget: cap at ~10 frames per swing sent to AI. This keeps local dev fast and cheap and
production costs trivial. It is also the mechanism the user asked for: "machine read...
with some AI analysis or correction."

## 5. Angle & Measurement Toolkit (consumed by doc 05)

All computed from smoothed 2D keypoints (+ world landmarks where noted). Angle between
vectors via atan2; report signed angles where direction matters; all values per-frame
time series AND sampled at the 8 events.

Face-On view metrics: shoulder line tilt, hip line tilt, head lateral sway (px→% of hip
width, vs. address), weight-shift proxy (mid_hip x vs. stance center), stance width
(ankles / shoulder width ratio), knee flex L/R (hip-knee-ankle), lead-arm–shoulder-line
angle, wrist hinge proxy (elbow-wrist vs. grip_center-clubhead line, needs doc 04),
spine side-bend, finish balance (mid_hip over lead foot).

DTL view metrics: **spine angle from vertical at address** (neck–mid_hip vs. vertical) and
its retention through the swing (early-extension detector = perpendicular distance of
mid_hip from its address position toward the ball line), posture line, knee flex, arm
hang at address (shoulder→wrist verticality), swing-plane proxy (shaft angle at address vs.
shaft at mid-downswing — doc 04), head drop/raise, hip depth (butt stays on the address
heel-line or not.

Rotation caveat (be honest in-product): true shoulder/hip *turn* in degrees is a 3D
quantity; from a single 2D view we approximate — face-on uses apparent shoulder-width
compression ratio + world landmarks; DTL sees turn poorly. Label these metrics
"estimated." A future two-view (upload both) mode can fuse for real 3D.

Normalization for cross-swing comparison: express distances relative to golfer's
pixel height at address (ankle-to-head_center) so camera distance doesn't matter.

## 6. Rendering Spec (frontend)

- Joints: 5px circles; bones 3px lines; left side one hue, right side another; derived
  spine in a third. Confidence < 0.5 → hollow circle + dashed bone.
- Interpolated frames: 60% opacity.
- Sub-pixel drawing on a devicePixelRatio-scaled canvas; scale normalized coords by
  rendered video box (letterbox-aware).
- Optional "ghost" mode: overlay address-frame skeleton at 25% opacity while scrubbing
  (great for spotting sway/early extension).

## 7. Validation Plan

- Fixture set: ≥15 clips covering both views, both handedness, indoor sim + outdoor range,
  phone-tripod and handheld.
- Golden snapshot tests: pose JSON for 3 fixtures; diffs > small epsilon fail CI.
- Manual QA harness: a debug page that renders skeleton over video with per-joint
  confidence heat — used every time Stage 2/3 parameters change.
- Quantitative spot-check: hand-label 12 joints on 10 frames across 3 videos (simple
  labeling script); require mean error < ~2% of image height for visible joints.
