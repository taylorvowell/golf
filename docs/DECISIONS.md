# Decisions & Spec Deviations

Log every deviation from `instructions/` here so the plan stays truthful (doc 00).

---

## D1 — MediaPipe 1.0 removed the legacy `mp.solutions.pose` API

**Date:** 2026-08-03
**Affects:** [03-POSE-TRACKING.md](../instructions/03-POSE-TRACKING.md) §3 Stage 2

Doc 03 is written against the legacy Solutions API (`mp.solutions.pose.Pose(...)`,
`min_detection_confidence`, `static_image_mode`). Verified on this machine:

```
mediapipe 1.0.0 → hasattr(mp.solutions, "pose") == False
                  mediapipe.tasks.python.vision.PoseLandmarker  == available
```

**Decision:** use the Tasks API. This is a rename, not a capability loss — everything doc 03
depends on survives:

| Doc 03 needs | Tasks API equivalent | Verified |
|---|---|---|
| "heavy" model | `pose_landmarker_heavy.task` bundle (30.6 MB, vendored in `services/analyzer/models/`) | ✅ |
| 33 landmarks incl. heels/foot_index | `pose_landmarks` (unchanged topology) | ✅ |
| `visibility` as confidence | `NormalizedLandmark.visibility` (+ new `presence`) | ✅ |
| temporal tracking, frame-sequential | `RunningMode.VIDEO` + `detect_for_video(img, timestamp_ms)` | ✅ |
| world landmarks | `pose_world_landmarks` | ✅ |
| segmentation mask (doc 04 Layer A) | `output_segmentation_masks=True` | ✅ |
| `min_detection_confidence` / `min_tracking_confidence` | `min_pose_detection_confidence` / `min_tracking_confidence` / `min_pose_presence_confidence` | ✅ |

**Consequences to respect:**
- `detect_for_video` timestamps **must be monotonically increasing**, and there is no
  `reset()`. One `PoseLandmarker` instance per video, created fresh; never reuse an instance
  across clips or rewind timestamps.
- Doc 03 §3.4's "retry a failed span in static image mode" needs a **second landmarker in
  `RunningMode.IMAGE`**, since a VIDEO-mode instance can't rewind.

## D2 — Python 3.14, not the spec's 3.11

**Date:** 2026-08-03
**Affects:** [02-ARCHITECTURE.md](../instructions/02-ARCHITECTURE.md) stack table

mediapipe 1.0.0, opencv 5.0.0, numpy 2.5.1 all have cp314 wheels and install clean. No 3.11
venv needed. Revisit only if a later dependency lacks 3.14 wheels.

## D4 — Gate 1 result on fixture `20260803_185301` (first real swing)

**Date:** 2026-08-03
**Artifacts:** `services/analyzer/out/20260803_185301/`

Raw Stage 2 pose only — no Stage 3 post-processing yet. 396 frames, 100% detection
coverage (a golfer was found in every frame; no dropouts, no wrong-person, no teleporting,
no left/right side-swap through the body rotation).

Quality splits cleanly by **camera-facing side**:

| Region | Result |
|---|---|
| Head, neck, spine, shoulders, hips | conf ≈ 1.00 throughout — excellent |
| Right (near-camera) side | 90–100% coverage — excellent |
| Impact frame (~221) | both wrists correctly on the grip |
| Left (far/occluded) arm | left_elbow 10%, left_wrist 16% coverage — unreliable |
| Finish (~228–344) | both arms poorly placed; confidence honestly drops to 0.22–0.45 |

**Confidence is trustworthy.** Every visibly-wrong joint is flagged low-confidence, and
every high-confidence joint is correct. This validates doc 00's "confidence everywhere"
principle as implementable — the UI's dim/dash styling will land on the right joints.

### D4a — Camera angle is a first-class product concern, not polish

The clip is an **oblique ~45° view from the golfer's front-trail side** — neither of the
two views the product supports (DTL, face-on). This angle maximizes self-occlusion of the
far arm, and is the root cause of the worst numbers above. A clean DTL or face-on would
materially improve far-side tracking with no code change.

**Action:** upload-time camera guidance (framing diagram per view + a post-upload
"this doesn't look like DTL or face-on" warning) is promoted from a doc 02 error-handling
footnote to a Phase 1 deliverable. Auto view-detection stays in the v2 parking lot.

### D4b — Add a golf-specific anatomical prior: both hands are on the grip

Doc 03 §3.2's sanity checks are generic (bone lengths, side-swap). This sport gives us a
much stronger constraint the spec doesn't use: **from address through follow-through the
hands are together on the club**, so `left_wrist ≈ right_wrist` within roughly one hand
width.

This matters beyond cosmetics: `grip_center = midpoint(wrists)` is the **search anchor for
club detection** (doc 04 §2 Layer B). At address the misplaced left wrist drags grip_center
into the torso, which would send the club search into the wrong region before Phase 4 even
starts. Proposed Stage 3 rule: when one wrist is high-confidence and the other is below
threshold, snap the low one toward the high one rather than trusting its position, and
derive grip_center from the confident wrist alone.

**Status:** proposed addition to doc 03 §3, to implement with the rest of Stage 3.

## D5 — ROI cropping does NOT improve MediaPipe pose (negative result, do not retry)

**Date:** 2026-08-03
**Affects:** [03-POSE-TRACKING.md](../instructions/03-POSE-TRACKING.md) §3.4

Fixture `swing2` is a true DTL but filmed at distance — the golfer is 407px tall and only
**17% of frame width**. Hypothesis: crop to the golfer from the 4K original so the landmark
model spends its capacity on the body, not the driving range. Implemented as a two-pass
estimator (pass 1 locates, pass 2 re-runs on an ffmpeg crop of the source).

**Result: worse, at both margins tested.**

| Joint | Full frame | ROI pad 0.12 | ROI pad 0.45 |
|---|---|---|---|
| right_knee | **100%** | 58.1% | 55.7% |
| right_ankle | **100%** | 64.5% | 60.1% |
| right_foot_index | **100%** | 62.2% | 57.2% |
| left_wrist | **49.3%** | 17.0% | 17.3% |
| overall mean conf | **0.789** | 0.717 | 0.734 |

Two compounding reasons, both structural rather than tuning problems:

1. **The landmark model resizes its person ROI to a fixed square input regardless of source
   resolution.** The golfer already exceeds that size in the plain 720p analysis video, so
   cropping adds no effective detail — there is no resolution headroom to win back.
2. **BlazePose expands its person ROI beyond the body and needs margin around it.** A tight
   crop puts the body against the frame edges, that expansion gets clipped, and the joints
   nearest the edges degrade most — which is exactly the observed signature (feet/ankles/
   knees collapse; head/neck/shoulders/hips stay at 1.00). Raising the pad to 0.45 helped
   the arms but not the legs, because the source frame ends below the feet and the
   requested margin cannot be honoured.

**Decision:** full-frame single-pass is the default. `--roi` is retained only to reproduce
this experiment. Doc 03 §3.4's ROI-crop suggestion should be read as a fix for
*multiple-people disambiguation only*, never as a quality lever.

**Confirmed independently** by re-running full-frame at 2× the analysis resolution:

| | 720p | 1440p |
|---|---|---|
| overall mean conf | 0.789 | 0.795 |
| left_elbow coverage | 58.9% | 58.7% |
| left_knee coverage | 38.4% | 38.4% |
| pose stage time | 22s | 31s |

Doubling the pixels bought nothing for 40% more compute. This independently validates
doc 02's "720p is sufficient" guidance — and supplies the reason the doc omits: the
landmark model's fixed-size input, not the source, is the binding constraint. **Keep the
analysis resolution at 720p; raising it is pure cost.**

**Consequence:** input resolution is not the constraint, so MediaPipe is at its accuracy
ceiling on this footage. Remaining levers are Stage 3 post-processing (unbuilt) and the
doc 03 §1 RTMPose escalation — not more pixels.

## D6 — Low confidence means *unverified*, not *wrong* (Stage 3 gating)

**Date:** 2026-08-03
**Affects:** [03-POSE-TRACKING.md](../instructions/03-POSE-TRACKING.md) §3.1

Doc 03 §3.1 sends any keypoint with visibility < 0.3 straight to *missing*. Measured against
the fixtures that is wrong in both directions: at swing2 frame 30 the grip is **correctly
placed and low-confidence**, while at swing1 frame 100 the left wrist is **wrongly placed
and low-confidence**. A threshold cannot tell those apart; only a check can.

**Decision:** sub-threshold keypoints enter as `PROVISIONAL` and are demoted only when a
positive check fails, or promoted when independent evidence corroborates them:

- **Wrist agreement** — a provisional wrist matching a confident partner within the grip
  separation limit is confirmed.
- **Temporal corroboration** — a provisional point that lands where confident neighbours
  within ±4 frames predict it (inside the joint's acceleration limit) is confirmed. A
  spurious detection has no reason to fall on the interpolated trajectory.

Promotion raises `conf`, not just internal status. The third element of a keypoint is
defined as **our post-validation confidence**, not the model's raw opinion, because that is
what the UI renders and what later stages act on. (Missing this initially made promotion a
no-op — status improved while every downstream consumer still saw the old number.)

## D7 — Bone-length sanity is upper-bound only

**Date:** 2026-08-03
**Affects:** [03-POSE-TRACKING.md](../instructions/03-POSE-TRACKING.md) §3.2

Doc 03 §3.2 wants bone lengths within ±35% of a rolling median. In 2D a bone can look
arbitrarily short through foreshortening — routine for arms in DTL, where the lead arm
points at the camera at the top — but it can never look *longer* than it is. A symmetric
band therefore flags correct geometry as error. We check only the upper bound (>1.3× the
bone's p95 observed length). Zero false rejects on both fixtures.

## D8 — One-Euro applied forward and backward

**Date:** 2026-08-03
**Affects:** [03-POSE-TRACKING.md](../instructions/03-POSE-TRACKING.md) §3.5

One-Euro is causal and therefore lags — and doc 03 chose it over a moving average precisely
to avoid corrupting the fast downswing and the tempo/impact metrics that depend on it.
Since analysis is offline we run it forward and backward and average, cancelling the phase
lag outright, then apply the doc's Savitzky-Golay pass (window 7, order 2).

## D9 — Stage 3 results on both fixtures

**Date:** 2026-08-03

| Joint (coverage) | swing1 raw → S3 | swing2 raw → S3 |
|---|---|---|
| left_wrist | 15.7% → **43.7%** | 49.3% → **78.3%** |
| right_wrist | 71.5% → 71.5% | 58.7% → **83.9%** |
| **grip_center** | 24.3% → **71.5%** | 24.3% → **83.9%** |
| left_elbow | 10.1% → 10.6% | 58.9% → 58.4% |
| left_knee | 11.1% → 11.6% | 38.4% → 38.4% |

Also: 2 side-swaps repaired and 38 frames interpolated on swing1; 199 grip rejects and 311
promotions across the two clips. Verified by eye at address/top/impact/finish on both —
promoted joints sit on the grip and club; rejected ones were genuinely misplaced.

`grip_center` clearing 70–84% is the result that matters: it is the search anchor for club
detection (doc 04 Layer B), and at 24% Phase 4 would have started hunting in the wrong
region. Part of that gain is Stage 3 and part is the derivation rule — with both hands on
one grip, the wrists are two observations of the same point, so `grip_center` defers to the
confident wrist instead of averaging in a weak one.

**Not fixed:** far-side elbow and knee (swing1 ~11%, swing2 ~38–58%). These are genuinely
occluded, not noisy — no amount of filtering invents them. They are the case for the
doc 03 §1 RTMPose escalation.

**Headline metric caveat:** overall *mean confidence* drops (0.797 → 0.722) because
rejected joints score zero. That is the system removing bad data, not degrading. Per-joint
coverage is the metric to track; mean confidence is misleading here.

## D3 — ffmpeg installed via winget (`Gyan.FFmpeg` 8.1.2)

**Date:** 2026-08-03

Note for future shells: winget's PATH update is not picked up by already-running shells.
ffmpeg 8.1.2 also deprecates `-vsync` in favor of `-fps_mode`; doc 02's Frame Sync section
says `ffmpeg -vsync cfr -r 60` — use **`-fps_mode cfr -r 60`**.
