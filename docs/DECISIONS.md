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

## D10 — RTMPose adopted as the default estimator (doc 03 §1 escalation taken)

**Date:** 2026-08-03

Doc 03 §1 keeps RTMPose as the upgrade path for when MediaPipe underperforms on occlusion.
It does, so we took it. Coverage, both fixtures, final pipeline:

| Joint | swing1 MP → RTM | swing2 MP → RTM |
|---|---|---|
| left_elbow | 10.1% → **99.2%** | 58.9% → **99.7%** |
| left_wrist | 15.7% → **94.2%** | 49.3% → **100%** |
| left_knee | 11.1% → **100%** | 38.4% → **100%** |
| left_ankle | 52.8% → **100%** | 65.1% → **100%** |
| grip_center | 71.5% → **100%** | 83.6% → **100%** |

The far-side occlusion problem that Stage 3 could not touch is essentially gone. Two
implementation notes:

* **No person detector.** rtmlib ships YOLOX, but the good weights are a 351 MB download and
  it re-detects a golfer who barely moves. MediaPipe already runs and its torso/head are its
  most reliable output, so it supplies the per-frame box. MediaPipe localises, RTMPose
  measures. Both stay behind the same interface, selectable with `--pose-model`.
* **Halpe26 over COCO17** — COCO has no foot keypoints, and doc 03 §2 needs them for stance
  width, flare and balance.

Cost: ~5 fps on CPU, so roughly 70s for a 340-frame clip on top of MediaPipe's 26s. Well
within doc 02's budget for offline analysis.

## D11 — Event detection anchors on sustained swing energy

**Date:** 2026-08-03
**Affects:** [05-SWING-PHASES-AND-SCORING.md](../instructions/05-SWING-PHASES-AND-SCORING.md) Part A

Two corrections the fixtures forced, both cases where the doc's stated criterion doesn't
survive real footage:

1. **Anchor on windowed energy, not peak speed.** A swing keeps the hands moving hard for
   over a second; lowering the club afterwards can momentarily beat it. On swing1 the bare
   speed argmax sat ~90 frames past Impact and dragged every event with it. Anchoring on a
   1.4s moving sum of hand speed fixes it.
2. **Impact is the hand low point, not a return to address height.** Doc 05 A.4 suggests the
   hands come back to address; on swing2 they never do (0.627 vs 0.661), so a crossing test
   finds nothing. The post-Top low point is a true extremum and survives.

Results — swing1 detects Top 198 / Impact 222 against a hand reading of ~196 / ~221, inside
doc 05's ±3 frame acceptance, with **tempo 3.38:1** landing in the classic 3:1 band.
swing2 gives 1.93:1, plausible for a junior with a slower transition.

Toe-Up and Mid-Follow-Through are the two events doc 05 marks club-dependent; both currently
use pose fallbacks with a plausibility guard and carry low confidence (0.4) to say so.

## D12 — Club tracking: backswing credible, downswing NOT — do not trust the trace yet

**Date:** 2026-08-03
**Affects:** [04-CLUB-TRACKING.md](../instructions/04-CLUB-TRACKING.md)

Implemented Layers A–D: three-frame motion differencing with the golfer's hull suppressed,
Hough shaft search in an annulus around `grip_center`, address calibration of club length,
per-segment smoothing. The debug view (`scripts/clubdebug.py`) is built, and doc 04 was
right to call it non-negotiable — every fix below came from looking at it.

**Honest state: the backswing trace reads as a real swing path. The downswing does not.**
Blue is still visibly a scribble around the top of the swing. This matches doc 04's own
warning that the downswing is the hard case (motion blur, 15–30% of frame width per frame).

Two findings worth keeping:

* **Take the head by marching, not by collinearity.** Picking the farthest collinear motion
  pixel lets one wind-blown tree pixel that happens to line up drag the head far off the
  club. Marching outward from the hands and stopping at the first real gap enforces that the
  shaft is *continuous*, and is capped at the address-calibrated club length because a rigid
  club cannot project longer than it is.
* **Coverage must not measure presence.** The first metric counted "a head was found" and
  reported 97% on a visibly wrong downswing — which defeats the doc 02 quality gate whose
  entire job is stopping that reaching the UI. Now it requires measured confidence and
  excludes interpolated frames. **It is still not discriminating enough**: confidence comes
  from Hough score and length ratio, both of which stay high when the shaft *direction* is
  wrong. A direction-consistency term is the next thing to add.

**Do not build plane or club-path metrics (doc 05 Part B) on this yet.** The per-frame shaft
angle is usable through the backswing; the downswing is not.

## D13 — Club face: head orientation works partially; impact angle stays out of reach

**Date:** 2026-08-03
**Affects:** [04-CLUB-TRACKING.md](../instructions/04-CLUB-TRACKING.md) §6

Requested: see the face rotate through the swing (toe-up in the backswing, squaring toward
impact). Implemented as doc 04 §6 tier 2 — **head orientation, not face angle**. The head is
an elongated body, so the angle between its principal axis and the shaft is a real
geometric signal for how it rolls. Face *angle* is about the face normal in 3D and is not
recoverable here.

Two measurement traps, both found by reading the numbers rather than the pictures:

1. **PCA locks onto the shaft.** The crop around the head necessarily contains the last
   stretch of shaft, which is a far stronger elongated feature than the head. First results
   read ~28° to the shaft — i.e. the shaft's own direction. Fixed by keeping only blob
   pixels at or beyond the head along the shaft direction.
2. **The series was bimodal.** Even after that, values alternated between ~±90° (genuine
   head) and ~0–20° (residual shaft), which as a readout would look like the face violently
   rolling frame to frame. A club head's heel-toe axis is never parallel to its own shaft,
   so anything under 30° is rejected as contamination.

**Honest state — partially working, not shippable as a headline feature:**

| Checkpoint | swing1 | swing2 |
|---|---|---|
| Address | not measurable | square-ish (85.6° to shaft, conf 0.60) |
| Toe-Up | toe down / shut-ish (64.4°, conf 0.67) | not measurable |
| Top | square-ish (−84.5°, conf 0.55) | not measurable |
| Impact | **requires launch monitor** | **requires launch monitor** |

Each clip resolves at *different* checkpoints, which is the tell that this is at the edge of
what the deterministic CV can do — exactly why doc 04 §6 prescribes **AI assist on 2–3
keyframes with the head crop** for this tier. That needs the doc 07 provider, which is not
built. Tier 1 (authoritative) remains the simulator impact image (doc 06 §2).

The UI shows per-checkpoint classifications with confidence, says "not measurable" where it
is, and states plainly that impact face angle needs launch monitor data — doc 04 §6 forbids
displaying a fabricated number, and a plausible-looking one here would be worse than silence
because face angle is precisely what a golfer would act on.

**Also landed:** doc 05's promised Phase 4 refinement of the shaft-defined events. Mid-
Follow-Through now uses the real "shaft horizontal" test (swing1 255→268, swing2 132→141).
Toe-Up did not refine on either clip — no confident shaft passed within 18° of horizontal in
the backswing — so the pose proxy stands and keeps its lower confidence.

## D14 — Track the club HEAD, derive the shaft. Right idea, brittle candidate generation.

**Date:** 2026-08-04
**Affects:** [04-CLUB-TRACKING.md](../instructions/04-CLUB-TRACKING.md) Layers B–D

Restructured on a user observation: the shaft is *always* the line from the hands to the end
of the club, and the hands are already high-confidence from pose. So the only unknown worth
solving is the head position — and tracking a point has no undirected-line ambiguity at all.

This also removed a rule that was quietly wrong. I had disambiguated shaft direction with
"the head is further from the body than the hands", which the user correctly rejected: it
inverts on a chop or over-the-top move where the head comes down *inside* the hands. Their
replacement — the head follows a continuous path, so use trajectory continuity — is both
more general and what doc 04 Layer D already prescribed.

Implementation now: the head lies on an arc of at most club-length around the hands, so
candidates come from a polar sweep of the motion mask; a prediction-gated walk outward from
Address picks one per frame; gaps interpolate between confident detections; shaft = hands →
head.

**Smoothness improved a lot** — frame-to-frame shaft angle change:

| | before | after |
|---|---|---|
| swing1 median / p95 | — | **0.2° / 5°** |
| swing2 median / p95 | 1.4° / 35.7° | **0.4° / 16.6°** |

**But coverage regressed badly on swing1**: backswing 95% → 60%, downswing 96% → **4%**,
and the trace is now below the quality gate and disabled. swing2 held (78/97/94%).

Diagnosis: the polar sweep needs continuous motion support along a ray, and swing1's
background is busy foliage close behind the golfer, so the mask is noisy and rays break
early. swing2's open range background is clean. This is a **candidate-generation** weakness,
not a flaw in the head-first design — the design is keeping the swing2 result *and* giving
the best smoothness numbers yet.

**Next step, before this is shippable:** fall back to the previous Hough-derived candidate
when the polar sweep yields none, and feed both into the same trajectory tracker. The
tracker is the part that works; it is being starved of candidates on one clip. Also worth
noting the sweep costs ~50-80s per clip against ~3s before.

**Do not treat swing1's club data as usable until this is fixed.**

## D15 — Wholebody hands + globally-optimal head tracking

**Date:** 2026-08-04

### D15a — RTMW wholebody: grip_center is now measured, not inferred

`grip_center` was the midpoint of the two **wrist** keypoints — the wrist bone, not the
hands. The club is held roughly a hand-length beyond that, so the shaft started short and
inside the real grip, and the error grew through the follow-through as the wrists rolled.

Switched the default estimator to **RTMW COCO-Wholebody (133 keypoints)**, which includes 21
per hand. `grip_center` now comes from the index/middle/ring/pinky MCP joints — the knuckles
the shaft actually rests across.

| | before | after |
|---|---|---|
| grip_center coverage (swing1) | 15.7% | **100%** |
| grip_center coverage (swing2) | 24.3% | **100%** |
| grip_center mean confidence | 0.66–0.93 | **1.000** |

This also **fixed the D14 regression on its own**: swing1's club coverage went 60/4/6% →
100/100/100% purely from having a trustworthy grip anchor. Cost is ~4 fps on CPU.

### D15b — The hand-pair direction prior does NOT work (negative result)

Tempting idea: the two hands sit adjacent along the grip, so lead→trail should point at the
head — a directed, high-confidence shaft prior immune to background clutter. Implemented and
measured: **coverage fell from 67/96/64% to 40/32/15%.**

Reason: the hands *overlap* on the grip, only ~12–50px apart. Over such a short baseline the
vector between them is dominated by keypoint noise rather than shaft geometry. The code is
retained (`hand_shaft_dirs`) but unused. The idea is not dead — the same hand data supports a
longer, better-conditioned baseline (**wrist → knuckles**, within one hand), which is the
version worth trying.

### D15c — Greedy tracking replaced by Viterbi DP (the fix that mattered)

A greedy per-frame walk cannot recover from an early mistake: it commits frame by frame, so a
wrong branch at the takeaway — where the club is slow and the mask thin — propagates through
the whole swing. Observed exactly that: swing1 tracked while **swing2 flipped from the
takeaway onward and never recovered**, even with the ball anchored at impact, because
accumulated prediction error made the correct candidate look expensive.

Replaced with **dynamic programming over whole paths**, anchored at two known points: the head
at Address is the calibrated ball position, and at Impact it is back at that same ball.
Transition cost is quadratic travel, normalised by club length. A branch that looks locally
good but requires the head to teleport across the hands to reach Impact now loses on global
cost. O(frames × candidates²) — negligible at ~6 candidates.

### D15d — Body mask must be torso-only

The mask suppressing the golfer was a convex hull over *all* keypoints, which spans the arms
and legs — the corridor the club swings through. At impact it was erasing the club exactly
where it passes the legs, so the tracker latched onto the butt side. Now torso only
(shoulders, hips, head): still removes the large moving mass, leaves the swing corridor
visible.

### Combined result, verified frame by frame against the real club

| Checkpoint | swing1 | swing2 |
|---|---|---|
| Address | correct | correct |
| Toe-Up | **flipped** (conf 0.59, flagged) | correct |
| Top | correct | correct |
| Mid-Downswing | correct | correct |
| Impact | **correct** | **correct** |
| Finish | plausible | uncertain |

Coverage reads 100% on both clips, but that number has overstated quality twice before —
`scripts/checkclub.py` renders the club over the real frame at each event and is the check
that actually counts. Remaining weakness is Toe-Up on swing1, where the club is slow, low
against grass, and its confidence correctly reports the doubt.

## D16 — Stage 6 metrics, and two definitions corrected by the data

**Date:** 2026-08-04
**Affects:** [05-SWING-PHASES-AND-SCORING.md](../instructions/05-SWING-PHASES-AND-SCORING.md) Part B

Built `metrics.py`: per-frame series plus a snapshot at each of the 8 events, everything
normalised by the golfer's own pixel height so it is camera-distance independent (doc 03 §5).
Surfaced in the player, keyed to the nearest event.

### D16a — Wrist hinge is forearm vs SHAFT, not forearm vs hand

First implementation measured the angle between the lead forearm and the lead hand. It read
**170–178° at every event** — i.e. no hinge, at the top, which is anatomically impossible.
The hand points were fine (hand/forearm length ratio 0.52 against ~0.55 real anatomy, 100%
coverage), so the geometry was right and the *definition* was wrong: in a golf swing the hand
stays roughly in line with the forearm, and it is the **shaft** that angles away from it.
Doc 03 §5 says this outright — "elbow-wrist vs grip_center-clubhead line".

Re-measured against the club shaft, the series is immediately coherent:

| Event | swing1 | swing2 |
|---|---|---|
| Address | 30.6° | 16.6° |
| Toe-Up | 164.4° | 125.9° |
| Top | 116.6° | 30.1° |
| **Impact** | **13.1°** | **5.7°** |
| Finish | 84.9° | 159.5° |

Near-zero at impact on both clips is the classic straight line from lead arm through the
shaft — a real coaching checkpoint falling out of the geometry, which is the sanity check
that the metric is measuring what it claims. Forearm-vs-hand is retained as a secondary
signal (`wrist_deviation`, i.e. wrist cup/bow).

### D16b — Stance width is face-on only

Reported 0.59× shoulder width on swing2 against a real-world 1.0–1.4×. Down-the-line looks
*along* the stance line, so both ankles foreshorten onto each other and the ratio is
meaningless. Doc 05 C1 already marks it FO. Now returns null with a note rather than a number
the scoring engine would happily grade.

This is the general trap in Part B and the reason each metric is gated by view: a 2D
projection will always return *a* number, and it takes domain knowledge to know when that
number means nothing.

### D16c — `lead_arm_angle` is projection-sensitive, and that is geometry not noise

Reads 59.5° at swing1's mid-backswing, between 174° at address and 171° at impact. Checked
frame by frame expecting a detection glitch, and found the opposite: the value moves
**smoothly** (112 → 91 → 74 → 64 → 59 → 64 → 72 → 84) at **confidence 1.00 throughout**.

So the arm genuinely *projects* as bent. At mid-backswing it points partly toward the camera
and the 2D elbow angle foreshortens. This is the same 3D→2D limit as X-factor and stance
width, and it is the more dangerous version because nothing about the output looks wrong —
smooth, confident, plausible, and misleading.

**Doc 05 C1's "lead arm relatively straight at Top" check would be actively misled by it.**
Now exposed as `lead_arm_angle_2d` alongside `lead_arm_in_plane`, a 0–1 indicator of how much
limb length survives projection; the scoring engine must gate the check on it. A two-view
upload (doc 03 §5) or world landmarks are the real fixes.

### Still to validate
Thresholds throughout are provisional and flagged (`provisional_thresholds: true`); doc 05
requires them in a versioned `scoring_config.json` before scoring ships. `spine_from_vertical`
reads ~15–16° at address on both clips where doc 05 C1 expects 30–45° for DTL — either the
convention differs (torso lean vs hip-bend) or it is under-reading; needs a hand measurement
against a protractor on one frame before it is scored.

## D17 — Backswing smoothing: solve in ANGLE over a dense profile, not discrete peaks

**Date:** 2026-08-04
**Affects:** [04-CLUB-TRACKING.md](../instructions/04-CLUB-TRACKING.md) Layers C/D

Reported symptom: the downswing looked smooth but the backswing did not. Confirmed — swing2's
backswing had a single flipped frame at f61 with the lowest confidence in the segment (0.62).
f61 is the takeaway passing through horizontal, where the club is dark against grass and dark
shorts: the motion mask nearly vanishes, so **the correct direction had no peak at all** and a
peak-picker is forced to choose among wrong options.

Three changes, each measured:

1. **Dense angular profile instead of discrete candidates.** `angular_profile` reports support
   and reach for *every* direction around the hands, including directions with none. Viterbi
   then runs over shaft **angle**, which is the natural state — the head rides an arc of
   roughly fixed radius, so its motion is rotation, and solving in angle separates rotation
   from the radius changes caused by foreshortening. A low-evidence frame is now carried
   through by its neighbours on smoothness rather than forced onto a wrong peak.

2. **Radius smoothed as its own signal.** The previous "assume near-full club length when
   support is weak" fallback overshot precisely where it was used most: the club foreshortens
   at the top, which is also where support is weakest, so the drawn head pushed past the real
   one. Radius is now interpolated and smoothed across frames, and frames whose radius was
   inferred are marked `interp` with confidence capped at 0.35.

3. **Phase-dependent shaft-continuity tolerance.** Tightening the allowed gap along a ray from
   0.18 to 0.09 club-lengths fixed the backswing (accel p95 127 → 77 on swing1) but **broke
   the downswing** (123 → 149), because there the shaft genuinely is a broken blur streak
   (doc 04 §4). What a "hole in the shaft" means depends on the phase: in slow phases it means
   the ray has run past the head into moving background — wind in the foliage behind swing1's
   golfer was reading as club. Now 0.09 normally, 0.22 from Top through Impact+4.

**Result — head-path acceleration p95 (lower is smoother):**

| | before | after |
|---|---|---|
| swing1 backswing | 66.5px | **60.6px** |
| swing2 backswing | 67.0px | **18.2px** |
| swing1 downswing | 85.1px* | 122.9px |
| swing2 downswing | 85.1px | **62.3px** |

swing2's backswing is now 3.7× smoother and its f61 flip is gone (confidence 0.62 → 0.75).
Also ~3× faster overall (swing2 club stage 30s → 7s) since the profile is computed once per
frame rather than searched repeatedly.

**Residual:** swing1 still overshoots slightly at the very top, where the club is nearly
stationary and heavily foreshortened — doc 04 §4 names this exact case ("club decelerates to
~0 → motion mask fades"). Its confidence reports the doubt. The doc's own answer is the AI
assist on that keyframe, which needs the doc 07 provider.

## D18 — Background model + hand-anchored swing plane (the two that actually worked)

**Date:** 2026-08-04

Stopped tuning tracker costs and looked at the input instead. On swing1 the motion mask
carried **46,000–77,000 white pixels per frame** against a club worth a few hundred: wind
speckled the whole foliage background and every edge of the golfer lit up. The tracker was
choosing among noise, which is why every cost tweak traded one segment against another
instead of fixing anything. Two changes, both suggested by the user:

### D18a — MOG2 background model instead of frame differencing alone

The camera is static, so every pixel has a stable distribution across the clip. MOG2 models
each pixel as a *mixture*, which is exactly what handles repetitive motion: leaves
oscillating in wind settle into the background model, whereas three-frame differencing flags
them every frame because they genuinely did move. Trained over the clip then re-read at zero
learning rate so early frames get the same quality as late ones.

### D18b — Fit the swing plane to the HANDS, not the club head

The user's observation: hand tracking is near-perfect (grip_center 100% at ~1.00 off measured
knuckles) while the club head is the least reliable signal we have. Fitting the head's plane
from head data alone means fitting five parameters — centre x/y, both axes, rotation — to the
noisiest data in the pipeline, so **the model absorbs the very outliers it exists to reject**.

The hands and the head sweep near-concentric arcs on the same plane. So centre and
orientation now come from the hand ellipse, and only a single robust scale factor is fitted
to the head points: one parameter on noisy data instead of five.

The off-plane count *rose* (swing1 backswing 3/65 → 17/65) — the correct sign. A stricter,
better-anchored model catches outliers the self-fitted one was quietly absorbing.

### D18c — The plane is a hinge gate, not a pull

A real swing plane shifts mid-backswing (a golfer can start the takeaway straight then move
it left or right) — that is technique, not error. Penalising off-plane distance
proportionally drags the path onto an idealised ellipse and measurably hurt (swing1 backswing
accel p95 61 → 92). Deviations inside `plane_tol` are free; only gross departures are pushed
back. Tolerance tuned on total acceleration across both clips and both segments:
no plane 264, tol 0.12 → 246, tol 0.20 → 274.

### Result — head-path acceleration p95 (lower is smoother)

| | session start | now |
|---|---|---|
| swing1 backswing | 66.5px | **31.1px** |
| swing1 downswing | 122.9px | **92.5px** |
| swing2 backswing | 67.0px | **17.0px** |
| swing2 downswing | 85.1px | **59.0px** |

swing1's backswing verified frame by frame across 15 consecutive frames — the club overlay
follows the real club throughout, which it did not before.

**Lesson worth keeping:** three separate rounds of cost-function tuning moved numbers around
without fixing anything, because the input was noise-dominated. Fixing the mask and anchoring
the model to the most reliable measurement available did more than all the tuning combined.

## D19 — Detect the SHAFT as an oriented line; two detectors, each where it wins

**Date:** 2026-08-04
**Affects:** [04-CLUB-TRACKING.md](../instructions/04-CLUB-TRACKING.md) Layers B/C

User observation: in most frames where tracking is wrong, *the shaft is plainly visible* —
and a shaft is a straight line from the hands to the head. Ray-marching motion blobs had
thrown that structure away, asking only "did anything move near this ray".

`shaft_profile` scores line evidence per direction using **gradient orientation**: along a
real shaft the intensity changes across it, so the image gradient is perpendicular to the
shaft. Evidence is `max(0, |g·perp| - |g·along|)`, which is large only for structures
genuinely oriented along the ray. Foliage and grass have random edge orientation and score
near zero — and crucially this works whether or not the club is moving, so it survives the
frames where the motion mask is useless.

### The result was a clean split, not a clean win

| swing1 head-path accel p95 | motion profile | shaft lines |
|---|---|---|
| backswing | **31.1** | 69.5 |
| downswing | 92.5 | **46.0** |

Opposite failure modes: in slow phases the club barely moves but the **fence behind swing1's
golfer is a perfect straight line**, so a line detector is drawn to the background. In the
downswing the club is a blur — its motion mask is smeared and unreliable, while its shaft is
still a clean oriented edge. Attempts to reconcile them with one detector (motion as a hard
gate, then as a soft gate) landed between the two and beat neither.

**Decision: use each detector where it measurably wins** — motion profile outside the
downswing, shaft lines from Top through Impact+4.

Also: 90 angular bins beat 180. Finer bins give the solver more near-identical options to
jitter between without adding information, since the shaft is several pixels wide anyway.

### Cumulative result this session

| head-path accel p95 | session start | now |
|---|---|---|
| swing1 backswing | 66.5px | **30.8px** |
| **swing1 downswing** | 122.9px | **54.2px** |
| swing2 backswing | 67.0px | **16.9px** |
| swing2 downswing | 85.1px | **58.7px** |

Verified visually, not just numerically: swing1's downswing overlay tracks the real club
across 12 consecutive frames with confidence rising 0.76 → 0.95, and the accumulated-sweep
view now shows the head path as a proper arc down through the body and out to the ball rather
than the straight diagonal it was.

**Diagnostic worth keeping:** `sweep.py` accumulates a whole segment into one long-exposure
image. The club's arc shows up as a bright band where the signal genuinely exists, which is
how we could tell the early backswing was tracking correctly and the upper backswing had no
signal left to follow. It answers "is the information even there" before any tuning.

## D20 — Two negative results: AI-vision ground truth, and the low-order path curve

**Date:** 2026-08-04

### D20a — The CV tracker beats AI visual estimation (test removed)

Ran a head-to-head: model-vision estimates of the club head on 8 swing1 backswing frames,
read off a gridded contact sheet, against the tracker's output. **The tracker won in every
frame**, by 150–386px, and the AI error was *systematically biased back along the shaft
toward the hands* rather than random — under-estimating how far down the shaft the head sits.

Two things worth keeping from it:

* The backswing tracker is **more accurate than the head-path smoothness metric suggested**.
  Several rounds of tuning optimised acceleration as a proxy for correctness, and this test
  says the proxy was under-selling real accuracy. Smoothness and correctness are not the same
  quantity.
* AI vision on a downscaled 8-up contact sheet is not usable ground truth. Doing it properly
  needs full-resolution crops around the shaft end, one frame at a time.

Test artifacts removed; not worth carrying.

### D20b — Low-order path curve does not beat the existing solver

The constraint is sound: a club head path is a straight line, a smooth curve, or a curve with
at most one direction change — never jagged — so it is a low-degree polynomial in time. And
unlike frame-to-frame smoothness, a cubic *cannot* express a run of frames on the wrong side
of the hands, which is the failure that let swing2 stay flipped for a whole segment.

Implemented as a robust weighted cubic per segment, fitted on high-confidence detections only
and **excluding the transition** (around Top the club is nearly stationary and heavily
foreshortened — least reliable input, and nobody analyses it).

Measured on swing1, total head-path accel p95 across both segments:

| | backswing | downswing | total |
|---|---|---|---|
| no curve | **30.8** | **54.2** | **85.0** |
| curve, global blend | 22.0 | 76.3 | 98.3 |
| curve, seam-local blend | 102.3 | 76.3 | 178.6 |

The curve genuinely improves the backswing (30.8 → 22.0) but costs more in the downswing, and
excluding the transition leaves a seam whose discontinuity costs more than the outliers
removed. Fundamentally the DP already enforces smoothness and the plane gate already removes
outliers, so a third smoothing mostly fights them.

**Left implemented behind `use_path_curve=False`.** The constraint would matter more with a
noisier detector, and the backswing gain suggests it is worth revisiting once there is a real
position-error metric rather than a smoothness proxy.

### The metric problem is now the blocker

Both results above point the same way: **head-path acceleration is the wrong target.** It
rewards smoothing and cannot distinguish "smooth and correct" from "smooth and wrong". Doc 04
§7 already prescribes the fix — hand-label the club head every 5th frame on 5 clips and
measure position error in pixels. Until that exists, further tuning is unfalsifiable.

## D3 — ffmpeg installed via winget (`Gyan.FFmpeg` 8.1.2)

**Date:** 2026-08-03

Note for future shells: winget's PATH update is not picked up by already-running shells.
ffmpeg 8.1.2 also deprecates `-vsync` in favor of `-fps_mode`; doc 02's Frame Sync section
says `ffmpeg -vsync cfr -r 60` — use **`-fps_mode cfr -r 60`**.
