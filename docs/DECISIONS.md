# Decisions & Spec Deviations

Log every deviation from `instructions/` here so the plan stays truthful (doc 00).

**This is an append-only log, not a statement of current design.** Entries are never deleted
or renumbered — many are cited by number from source comments, so a renumber would silently
break those references. When a decision is overruled, the new entry supersedes it and
the old one is *marked*, not removed: a negative result stays valuable long after the code that
produced it is gone.

Every entry therefore carries a **`Status:`** line. Read it before acting on the entry.

| Status | Means |
|---|---|
| `ACTIVE` | Describes how the code works now. Safe to rely on. |
| `SUPERSEDED by Dxx` | The conclusion no longer holds. **Do not act on it**; read the superseding entry. |
| `SUPERSEDED IN PART by Dxx` | Some of it still binds — the Status line says which. |
| `NEGATIVE RESULT — do not retry` | An approach that was built and measured and lost. The most valuable entries here; deleting them is how you pay for the same experiment twice. |
| `HISTORICAL` | A measurement from a pipeline generation that no longer exists. Context only. |
| `OPEN` | A known problem with no resolution yet. |

Current tally: **41 ACTIVE · 5 NEGATIVE RESULT · 3 SUPERSEDED · 2 HISTORICAL · 2 OPEN.**

Two traps this log has set for readers, both worth knowing before you trust any number in it:

- **D26 invalidated every confidence figure recorded before it.** "Coverage 100% @ 1.00" in
  D4, D9, D15a and STATUS.md's tables was a clamp mapping SimCC peak magnitudes onto 1.00 —
  the artefact, not the model. Post-rescale figures are not comparable to pre-rescale ones.
- **D12's superseded verdict leaked into product UI.** Player copy still cites "DECISIONS
  D12/D14" to tell users the downswing is approximate, which D19 disproved. Internal decision
  numbers should never appear in user-facing text at all.

---

## D1 — MediaPipe 1.0 removed the legacy `mp.solutions.pose` API

**Date:** 2026-08-03
**Affects:** [03-POSE-TRACKING.md](../instructions/03-POSE-TRACKING.md) §3 Stage 2
**Status:** ACTIVE — Tasks API and the monotonic-timestamp constraint still govern `pose.py`. The version facts live in CLAUDE.md's toolchain table, not here.

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
**Status:** SUPERSEDED by D21 — 3.13 and 3.14 both work. This was an environment fact, not a decision; CLAUDE.md's toolchain table owns it now. Kept only because retiring the number would orphan the heading.

mediapipe 1.0.0, opencv 5.0.0, numpy 2.5.1 all have cp314 wheels and install clean. No 3.11
venv needed. Revisit only if a later dependency lacks 3.14 wheels.

## D4 — Gate 1 result on fixture `20260803_185301` (first real swing)

**Date:** 2026-08-03
**Artifacts:** `services/analyzer/out/20260803_185301/`
**Status:** HISTORICAL — MediaPipe-era Gate 1 baseline. Coverage superseded by D10/D15a; the confidence figures additionally predate the D26 rescale, so read neither as current.

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

**Status:** ACTIVE — camera guidance is still an unbuilt Phase 1 deliverable.
The clip is an **oblique ~45° view from the golfer's front-trail side** — neither of the
two views the product supports (DTL, face-on). This angle maximizes self-occlusion of the
far arm, and is the root cause of the worst numbers above. A clean DTL or face-on would
materially improve far-side tracking with no code change.

**Action:** upload-time camera guidance (framing diagram per view + a post-upload
"this doesn't look like DTL or face-on" warning) is promoted from a doc 02 error-handling
footnote to a Phase 1 deliverable. Auto view-detection stays in the v2 parking lot.

### D4b — Add a golf-specific anatomical prior: both hands are on the grip

**Status:** ACTIVE — implemented as Stage 3's `trust_hands` path and confident-wrist grip derivation. (Its original 'proposed' status line was stale.)
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


## D5 — ROI cropping does NOT improve MediaPipe pose (negative result, do not retry)

**Date:** 2026-08-03
**Affects:** [03-POSE-TRACKING.md](../instructions/03-POSE-TRACKING.md) §3.4
**Status:** NEGATIVE RESULT — do not retry: ROI cropping. Measured worse at both margins, for structural reasons.

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
**Status:** ACTIVE — the PROVISIONAL/promotion model is live in `postprocess.py`.

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
**Status:** ACTIVE — upper-bound-only bone check is live.

Doc 03 §3.2 wants bone lengths within ±35% of a rolling median. In 2D a bone can look
arbitrarily short through foreshortening — routine for arms in DTL, where the lead arm
points at the camera at the top — but it can never look *longer* than it is. A symmetric
band therefore flags correct geometry as error. We check only the upper bound (>1.3× the
bone's p95 observed length). Zero false rejects on both fixtures.

## D8 — One-Euro applied forward and backward

**Date:** 2026-08-03
**Affects:** [03-POSE-TRACKING.md](../instructions/03-POSE-TRACKING.md) §3.5
**Status:** ACTIVE — forward+backward One-Euro is live.

One-Euro is causal and therefore lags — and doc 03 chose it over a moving average precisely
to avoid corrupting the fast downswing and the tempo/impact metrics that depend on it.
Since analysis is offline we run it forward and backward and average, cancelling the phase
lag outright, then apply the doc's Savitzky-Golay pass (window 7, order 2).

## D9 — Stage 3 results on both fixtures

**Date:** 2026-08-03
**Status:** HISTORICAL — MediaPipe-era Stage 3 numbers, superseded by D10/D15a. Confidence figures predate the D26 rescale.

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
**Status:** ACTIVE — RTMPose remains the default estimator — but its Halpe26 choice is superseded by D15a's wholebody 133.

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
**Status:** ACTIVE — the windowed-energy anchor is live, and is the path D21a's tempo shift travels through.

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
**Status:** SUPERSEDED by D17/D18/D19. Its verdict — 'the downswing is NOT credible, do not trust the trace' — no longer holds: swing1 downswing head-path accel p95 went 122.9 -> 54.2 px and was verified visually across 12 consecutive frames. **This entry is still quoted in user-facing UI copy; that copy is wrong and should be fixed.**

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
**Status:** SUPERSEDED IN PART by D17-D19. The per-checkpoint results table is stale — all three checkpoints now resolve on swing2 where two read 'not measurable'. The **face-angle honesty policy is ACTIVE and non-negotiable**: never show a fabricated impact number.

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
**Status:** ACTIVE — as design — track the head and derive the shaft, disambiguate by trajectory continuity. Both are live and D23 builds on them. The coverage regression it reports was resolved by D15a.

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
**Status:** ACTIVE

### D15a — RTMW wholebody: grip_center is now measured, not inferred

**Status:** ACTIVE — wholebody `grip_center` is live. Caveat: the '1.00 confidence' figures here predate the D26 rescale and were inflated by the clamp D26 removed.
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

**Status:** NEGATIVE RESULT — do not retry: the hand-pair direction prior. The baseline is too short to beat keypoint noise.
Tempting idea: the two hands sit adjacent along the grip, so lead→trail should point at the
head — a directed, high-confidence shaft prior immune to background clutter. Implemented and
measured: **coverage fell from 67/96/64% to 40/32/15%.**

Reason: the hands *overlap* on the grip, only ~12–50px apart. Over such a short baseline the
vector between them is dominated by keypoint noise rather than shaft geometry. The code is
retained (`hand_shaft_dirs`) but unused. The idea is not dead — the same hand data supports a
longer, better-conditioned baseline (**wrist → knuckles**, within one hand), which is the
version worth trying.

### D15c — Greedy tracking replaced by Viterbi DP (the fix that mattered)

**Status:** ACTIVE — the Viterbi DP is the tracker, and is what D23 feeds.
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

**Status:** ACTIVE — torso-only body mask is live.
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
**Status:** ACTIVE

Built `metrics.py`: per-frame series plus a snapshot at each of the 8 events, everything
normalised by the golfer's own pixel height so it is camera-distance independent (doc 03 §5).
Surfaced in the player, keyed to the nearest event.

### D16a — Wrist hinge is forearm vs SHAFT, not forearm vs hand

**Status:** ACTIVE — wrist hinge is measured against the shaft.
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

**Status:** ACTIVE — stance width still returns null in DTL with a note.
Reported 0.59× shoulder width on swing2 against a real-world 1.0–1.4×. Down-the-line looks
*along* the stance line, so both ankles foreshorten onto each other and the ratio is
meaningless. Doc 05 C1 already marks it FO. Now returns null with a note rather than a number
the scoring engine would happily grade.

This is the general trap in Part B and the reason each metric is gated by view: a 2D
projection will always return *a* number, and it takes domain knowledge to know when that
number means nothing.

### D16c — `lead_arm_angle` is projection-sensitive, and that is geometry not noise

**Status:** ACTIVE — unresolved obligation: the scoring engine must gate the lead-arm check on `lead_arm_in_plane`. Scoring is not built, so this is still owed.
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
**Status:** ACTIVE — dense angular profile, smoothed radius, phase-dependent gap tolerance — all live.

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
**Status:** ACTIVE

Stopped tuning tracker costs and looked at the input instead. On swing1 the motion mask
carried **46,000–77,000 white pixels per frame** against a club worth a few hundred: wind
speckled the whole foliage background and every edge of the golfer lit up. The tracker was
choosing among noise, which is why every cost tweak traded one segment against another
instead of fixing anything. Two changes, both suggested by the user:

### D18a — MOG2 background model instead of frame differencing alone

**Status:** ACTIVE — MOG2 background model is live.
The camera is static, so every pixel has a stable distribution across the clip. MOG2 models
each pixel as a *mixture*, which is exactly what handles repetitive motion: leaves
oscillating in wind settle into the background model, whereas three-frame differencing flags
them every frame because they genuinely did move. Trained over the clip then re-read at zero
learning rate so early frames get the same quality as late ones.

### D18b — Fit the swing plane to the HANDS, not the club head

**Status:** ACTIVE — the plane is fitted from the hands.
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

**Status:** ACTIVE — the plane is a hinge gate, not a pull.
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
**Status:** ACTIVE — the motion/shaft-lines phase split is live. D23 adds a third source that is deliberately phase-independent.

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
**Status:** ACTIVE — **this is the top blocker.** The position-error metric still does not exist, so every club change — including D23's `detector_gain` — remains unfalsifiable.

### D20a — The CV tracker beats AI visual estimation (test removed)

**Status:** NEGATIVE RESULT — do not retry: AI visual estimation of the club head. Lost to the tracker in all 8 frames.
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

**Status:** NEGATIVE RESULT — do not retry: low-order path curve. Left behind `use_path_curve=False`; revisit only once a real position-error metric exists.
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
**Status:** ACTIVE — `-fps_mode cfr` still correct, verified on ffmpeg 9.0 (D21). The 8.1.2 version claim is superseded by D21; CLAUDE.md carries the current versions.

Note for future shells: winget's PATH update is not picked up by already-running shells.
ffmpeg 8.1.2 also deprecates `-vsync` in favor of `-fps_mode`; doc 02's Frame Sync section
says `ffmpeg -vsync cfr -r 60` — use **`-fps_mode cfr -r 60`**.

## D21 — Second machine: toolchain drift, a GPU, and one unexplained metric change

**Date:** 2026-08-04
**Status:** ACTIVE

The project moved to a second Windows machine. Full setup from a fresh clone reproduces the
pipeline end to end on swing2 in **90.6s**, with the headline numbers intact — `grip_center`
100% @ 1.000, club coverage 100/100/100%, all key joints 92–100%. But the environment is not
the one the docs describe, and one output moved.

| | machine 1 (docs) | machine 2 (here) |
|---|---|---|
| ffmpeg | 8.1.2 | **9.0** |
| Python | 3.14.6 | **3.13.7** |
| pnpm | 11.9.0 | 10.23.0 |
| GPU | none | **GTX 1080, 8 GB, CUDA 12.6** |
| RTMW pose | ~4–5 fps | **10.4 fps** |

`-fps_mode cfr` still works on ffmpeg 9.0, so D3's guidance stands.

### D21a — swing2 tempo reads 1.76:1, not the documented 1.93:1

**Status:** OPEN — cause unresolved. Now that D25/D26 are written up they are the prime suspects — D25 changed which keypoints exist and D26 changed every confidence value, which together move Stage 3 rejection and therefore event frames. Settling it needs a golden snapshot, which is why this is still open.
Events land at address 34 / top 85 / impact 114, giving 51 backswing frames against 29
downswing — 1.76:1. STATUS.md and CLAUDE.md both record **1.93:1** for this clip.

**Most likely cause: uncommitted pose work already in the tree, not ffmpeg.** The clone carries
substantive uncommitted changes on top of `879a908` — `skeleton.py` (+79) adds a `MEASURED`
keypoint block with `left/right_middle_mcp`, explicitly because "the four-MCP centroid used
before blends roll into the flexion reading", plus `pose_rtm.py` (+70), `postprocess.py` (+37)
and `pose.py` (+16). Changing how the hand is defined moves `grip_center`, which moves hand
speed, which moves the windowed-energy anchor that D11 made event detection depend on — so a
tempo shift is the *expected* consequence of that work, not an anomaly.

The documented 1.93:1 was measured against the committed code. Two smaller candidates remain
if that turns out not to explain it: ffmpeg 9.0 resolving this VFR source (`r_frame_rate` 60/1
but `avg_frame_rate` 58.88) to slightly different frames, or a stale figure. Everything else
about the clip reproduces.

**Do not treat 1.93:1 as the reference number until the in-flight pose work is committed and
re-measured.**

**This is the concrete cost of having no golden snapshots.** Doc 03 §7 makes them the Phase 2
deliverable and they do not exist; a snapshot on this fixture would have named the cause
immediately instead of leaving it open. Treat it as evidence for building them, not as a bug
to chase blind.

### D21b — GPU training is ~7.5× CPU, not the ~75× the plan assumed

**Status:** ACTIVE — GPU timing and the Pascal `amp=False` requirement stand.
STATUS.md §4 estimated "~20 minutes" for the 40-epoch club run on a GPU against ~25 hours on
CPU. Measured from `runs/clubhead/results.csv`: **197 s/epoch**, so 40 epochs is **~2h10m**.
Still decisively worth it, but plan around two hours rather than twenty minutes.

Two settings this card forced:
* **`amp=False`.** Pascal (sm_61) runs FP16 at a fraction of its FP32 rate, so mixed precision
  buys nothing and can cost. VRAM is not the binding constraint (batch 8 @ 640 against 7 GiB
  free), so FP32 is the right trade here. A modern card should re-enable it.
* **CUDA wheel explicitly.** `pip install torch` on Windows gives a CPU-only build that would
  have silently run the 25-hour path. Install from the cu126 index and assert
  `torch.cuda.is_available()` before trusting a "GPU" run.

## D22 — Roboflow dataset survey: two candidates rejected, and a published mAP that measures nothing

**Date:** 2026-08-04
**Affects:** [04-CLUB-TRACKING.md](../instructions/04-CLUB-TRACKING.md) §2, Stage 4b
**Status:** ACTIVE

Two further Roboflow datasets were evaluated as possible replacements for the pose stage or
the club detector. Both rejected. Measured via the Roboflow API (Universe pages 403 on fetch).

| | swingcaddy-ai/golf-swing-keypoints | photofunction/golf-swing-b21yo | **msiuj v9 (in use)** |
|---|---|---|---|
| Images (pool / version) | 422 / 198 | **70 / 28** | **6,077 / 4,399 train** |
| Club labels | **none** — all 16 classes are `golfer_*` | `club` 83, `person` 97 | `clubhead` 5,264, `stick` 5,498 |
| Trained model | none | yes, yolov11n-pose | none |

**Neither is a pose candidate.** RTMW is trained on COCO-WholeBody (~130k images, 21 keypoints
per hand). A 422-image golf set cannot compete, and losing the hand keypoints would regress
`grip_center` — the measurement D15a showed carries the whole club stage (60/4/6% → 100/100/100%
from that change alone).

### D22a — photofunction's advertised "mAP 86.09" is box mAP; its pose head is untrained

**Status:** NEGATIVE RESULT — do not retry: do not adopt photofunction/golf-swing-b21yo, and do not re-survey Roboflow without reading this first.
The interesting candidate was the one with club *keypoints*. Its published metrics:

```
class=all    map50(boxes) 0.861   map50(pose) 0.000
class=club   map50(boxes) 0.727   map50(pose) 0.000
class=person map50(boxes) 0.995   map50(pose) 0.000
pose_loss by epoch: 11.80 -> 11.83 -> 11.87   (rising)
```

Every keypoint metric is exactly zero and the pose loss never descends — the keypoint head
learned nothing, on 23 training images, validated against 3. The headline number is box
detection only.

**This is the STATUS.md §2 lesson arriving from outside the project:** a confident number that
measures something adjacent to what you need is worse than no number, because it survives
casual checking. Same shape as the coverage metric that overstated club quality three times.

### D22b — `msiuj` v9 verified independently, and the naming trap is real

**Status:** ACTIVE — the verification method — measure the polygon bounding box, never fixed columns — applies to any future dataset.
Re-measured from the labels on disk: `clubhead` median extent **0.0137 × 0.0243**, reproducing
STATUS.md's 0.013 × 0.024 exactly, with **0 of 8,506 instances above 10% of frame**. The
dataset is genuinely the head.

Worth recording the near-miss: a first pass read the labels as `cls cx cy w h` and reported
median extent 0.51 × 0.45 — the same signature as the `club-head-tracking` dataset STATUS.md
rejected for containing full-body boxes. The export is **segmentation polygons**
(`cls x1 y1 x2 y2 …`, 9–31 fields), so those were polygon vertices, not extents. Measure the
polygon bounding box, not fixed columns.

Also: Roboflow returns polygons even when the `yolov11` detection format is requested, because
the project is instance-segmentation. Ultralytics converts them to boxes for a detection task
(confirmed: 0 corrupt across 4,399 images, 501 val instances), so `train_club.py`'s
box-detection intent is honoured — but the conversion is Ultralytics', not the exporter's.

## D23 — Stage 4b: the learned detector is EVIDENCE into the existing solver, not a second path

**Date:** 2026-08-04
**Affects:** [04-CLUB-TRACKING.md](../instructions/04-CLUB-TRACKING.md) §2 Layers B–D
**Status:** ACTIVE — Stage 4b is wired and verified no-regression. Judging it needs D20's metric.

Doc 04 §2 forbids a detector-only club path, and the measured history says the same thing from
the other side: D15c established that the Viterbi DP is the component that works, and D14
diagnosed the residual failures as *candidate starvation*, not a tracker flaw.

So `swingsage/club_detect.py` writes into the **same dense angular profile** the two hand-built
detectors already feed (motion profile outside the downswing, oriented shaft lines from Top
through Impact+4, per D19). A detection is converted to `(angle_bin, radius)` about
`grip_center` and added to `support`, with a Gaussian spread of 1.5 bins for the box centre's
own error. Everything downstream — the global DP, the plane hinge gate, per-segment smoothing,
the confidence feeding doc 02's quality gate — is untouched.

Three properties that follow from the choice rather than from tuning:

* **Geometric rejection is free.** A detection is admitted only if its distance from the hands
  falls inside the calibrated club-length bounds. The club is rigid and held at the hands, so
  a box on the ball, on a background object, or on another golfer's club is discarded before
  it can influence the path. Verified: a box at 3× club length is rejected at conf 0.99.
* **The detector supplies the weakest quantity in the profile.** `reach` means "how far along
  this ray did motion continue", which overshoots exactly where the club foreshortens at the
  top (D17). A detection localises the head directly.
* **Degradation is to today's behaviour, not to nothing.** With no detections admitted,
  `inject` returns the original profile object unchanged.

**Verified no-regression:** re-running swing2 with `detector=None` produces an `analysis.json`
whose pose, events, metrics and every pre-existing club field are byte-identical to the
pre-change baseline. The only difference is the added `club.detector` key.

`detector_gain` starts at **0.8**, below the 1.0 that would make a full-confidence detection
worth a fully-supported motion ray. There is deliberately no phase-dependent weighting as in
D19: a learned detector has no reason to fail specifically in the downswing, and asserting a
preference before doc 04 §7's position-error metric exists is precisely the unfalsifiable
tuning D20 warns against. **Tune this against that metric, not against smoothness.**

Also closes STATUS.md §7's "no club-model versioning in `analysis.json`": `club.detector`
records the weights' SHA-256, size, imgsz, conf and class map, so a stored report stays
traceable when the tracker changes underneath it.

### D23a — Trained, measured, and it fixed the finish. Also the cleanest proof yet that smoothness is the wrong metric.

**Date:** 2026-08-04
**Status:** ACTIVE — kept behind `--club-detector` and NOT made default. One clip, one visual pass; promoting it needs D20's metric and more fixtures.

Training: `yolo11s` @ 640, 40 epochs, batch 8, `amp=False`, GTX 1080. 130 min, no early stop
(patience 12 never tripped). Best epoch 39. **The aggregate number is misleading in the same
way D22a warns about:**

| class | instances | P | R | mAP50 | mAP50-95 |
|---|---|---|---|---|---|
| all | 501 | 0.869 | 0.837 | **0.831** | 0.571 |
| `stick` | 258 | 0.938 | 0.934 | **0.976** | 0.840 |
| **`clubhead`** | 243 | 0.800 | 0.740 | **0.686** | **0.303** |

The headline 0.831 is carried by the **shaft**, and `clubhead` — the only class Stage 4b
consumes — is the weak one. Read `clubhead` mAP50-95 0.303 with care: these boxes are ~9x15 px
at 640, so IoU is savagely sensitive and a 2 px offset destroys high-IoU matches, while what we
actually need is *centre distance*. It is suggestive, not damning, and D20's metric is what
would settle it.

**A/B on swing2, both arms on identical code** (`out/ab_base` vs `out/ab_det`). Detector found a
head on 91.5% of frames and contributed to 298/341.

| | classical | detector |
|---|---|---|
| Coverage, all segments | 100% | 100% (saturated; uninformative) |
| accel p95 backswing | 38.2 | **31.0** |
| accel p95 downswing | 70.8 | 70.7 |
| accel p95 followthrough | 65.5 | **77.5 (worse)** |
| accel p95 total | 174.5 | 179.1 (worse) |
| backswing off-plane | 15/46, dev 0.076 | **10/46, dev 0.045** |
| downswing off-plane | 21/63, dev 0.086 | **8/63, dev 0.037** |
| conf at address / finish | 0.684 / 0.655 | **0.763 / 0.772** |
| conf at mid_backswing / top | 0.797 / 0.804 | 0.727 / 0.733 (lower) |

**Verified visually with `checkclub.py`, which is the only check that counts here.** The two
paths disagree by a median of 44 px and by **660-676 px across f143-f150** — half the frame.
At the finish the classical arm draws the club up-left while the real shaft is plainly visible
going down-right behind the golfer's back. **The detector arm draws it down-right, along the
real club.** The detector fixed the one event D15 had recorded as "uncertain" on this clip.
Address improved too; Top and mid-backswing report lower confidence but both overlays are still
correct, so that is reduced certainty, not a regression.

### The finding that matters more than the detector

**The follow-through got measurably less smooth (65.5 -> 77.5) at exactly the segment where it
became visibly more correct.** That is a direct counterexample: on this clip head-path
acceleration *anti-correlates* with correctness. D20 argued the metric could not distinguish
"smooth and correct" from "smooth and wrong"; this is stronger — it actively preferred the
wrong answer. **Any future tuning that optimises accel p95 is liable to undo this fix.**

Two consequences to carry forward:

1. **Off-plane deviation is a better proxy than acceleration.** It is anchored to the hand-fitted
   plane (D18b), i.e. to the most reliable measurement in the pipeline, so it is not
   self-referential the way smoothness is. It moved decisively in the detector's favour
   (21/63 -> 8/63) and agreed with what the eye saw. Still a proxy, still not ground truth.
2. **`stick` is the detector's strong output and Stage 4b ignores it.** `inject` consumes only
   `detector.heads(f)`. But the solver's state is shaft **angle** (D17), and a shaft detection is
   direct evidence about precisely that — the direction from `grip_center` toward the stick box.
   Feeding `stick` as angle evidence would use the model's best output (mAP50 0.976) in the
   solver's native coordinate instead of its worst (0.303) converted into it. **Do not build this
   before D20's metric exists** — it is a plausible-sounding change of exactly the kind that
   burned three rounds of tuning in D17-D19.

---

## D24 — Scrub froze the video: a 250-frame GOP, and seeks that cancel each other

**Date:** 2026-08-04
**Affects:** [02-ARCHITECTURE.md](../instructions/02-ARCHITECTURE.md) §Frame Sync
**Status:** ACTIVE — `-g 10` and the seek fix are live.

Dragging the scrubber moved the skeleton smoothly while the video sat on one frame until the
drag ended. Two independent causes, both of which had to go.

**1. `normalize()` never set `-g`,** so libx264 used its default 250-frame keyint. Measured on
the shipped fixtures: `normalized.mp4` contained **two** keyframes total (0.000s and 4.167s)
for a 396-frame clip. Seeking to frame 200 therefore made the browser decode 200 frames of
1080×1920 from the I-frame at zero. Now `-g 10 -keyint_min 10 -sc_threshold 0` — worst-case
9 frames of decode. `sc_threshold 0` is what makes the interval *exact*; without it x264 still
places I-frames on scene cuts and the guarantee is only an upper bound.

Cost is **~2× the file** (swing1 13 MB → 25 MB). All-intra (`-g 1`) was measured too and is
**5×** (66 MB) — rejected, because doc 02 has the player pulling this file over the LAN to a
phone and 9 frames of decode is already imperceptible. GOP 10 also keeps the frame-sync
contract intact: it changes nothing about CFR, timestamps or frame count, so `frame =
round(currentTime * fps)` and the existing `analysis.json` stay valid. The two fixtures were
re-encoded in place rather than re-run through `burnin.py` — dimensions, fps and frame count
are unchanged, so the analyses did not need regenerating.

**2. `seek()` assigned `currentTime` unconditionally.** Setting it while a seek is in flight
does not queue — it *replaces* the pending target, so a drag firing faster than seeks complete
leaves the element permanently servicing a request that is obsolete before it lands. This is
why the skeleton (pure React state) kept up and the picture did not. `SwingPlayer` now holds
the newest target in a ref when `video.seeking` is true and fires it from the `seeked` handler,
so the video chases the thumb one completed seek behind and always settles on the frame the
drag ended at. The handler skips a seek to the frame already displayed, because assigning the
current `currentTime` fires no `seeked` and would strand the chase.

Keep both. The encode fix alone still stutters on a fast drag; the client fix alone still
crawls, because each individual seek is what was slow. The client fix is also the one that
survives contact with user uploads, whose GOP we do not control until Stage 0 re-encodes them.

---

## D25 — The 133-point model was giving us 21 points; take the ones that measure something

**Date:** 2026-08-04
**Affects:** [03-POSE-TRACKING.md](../instructions/03-POSE-TRACKING.md) §2, [02-ARCHITECTURE.md](../instructions/02-ARCHITECTURE.md) §analysis.json
**Status:** ACTIVE — the measured block is live; append-only ordering is a contract.

RTMW computes 133 keypoints per frame. We mapped 21 and discarded 112 — the entire 68-point
face block, 34 of 42 hand points, and both small toes. Nothing about that was a cost decision;
the mapping was simply written against the body joints MediaPipe already had.

**Verified before mapped.** The 133-array's block boundaries are documented (body 0-16, feet
17-22, face 23-90, hands 91-132) but the ordering *inside* each block is a convention, not a
promise. `scripts/kpdebug.py` draws every sub-index on a real frame and asserts geometric
relations that only hold if the conventional order is the real one. It is the reason this
entry can state indices rather than guess them, and it stays in the repo because the same
question returns every time the model changes. One caution it taught: a "finger runs base to
tip" assertion **fails on a correct mapping** for a golfer, because a closed fist curls the
fingertips back toward the palm. The thumb, extended along the shaft, is the one that passes.

Added, all previously computed and thrown away:

| Point | Index | Why |
|---|---|---|
| `left/right_index`, `_pinky`, `_thumb` | 96/108/93, 117/129/114 | Native slots **already in the contract and permanently zero**. BlazePose calls 17-22 the pinky/index/thumb *knuckles*, which is exactly what these are. |
| `left/right_middle_mcp` | 100, 121 | Third metacarpal — the bone wrist flexion is anatomically defined along |
| `left/right_small_toe` | 18, 21 | Closes the sole triangle; heel+big toe is a line and a line cannot show roll |
| `chin`, `nose_bridge` | 31, 50 | Single observed head anchors (see below) |
| `jaw_left`, `jaw_right` | 23, 39 | Contour endpoints, for head turn only |

**`head_center` was the point worth replacing.** It is the ear midpoint with
`allow_single=True`, and derived joints are computed *after* smoothing (doc 03 §3.6), so a
dropped far ear silently changes the point's definition mid-swing and translates it by half
the ear separation. Smoothing cannot absorb that — it has already run. Measured: on swing1
`head_center` holds 23.7% coverage at mean confidence 0.464 while `nose_bridge` holds **100%
at 1.000** and `chin` 100% at 0.960. `max_head_sway` moves from 0.032 to 0.026 body-heights
between the two anchors, a 19% difference on a scored metric. Both are now reported —
`head_*` off the ear midpoint, `face_*` off the nose bridge — rather than one silently
replacing the other, because only one of them has historical reports behind it.

**Contract.** `KEYPOINT_NAMES` is now native(33) then derived(7) then measured(8) = 48. The
measured block is appended *after* the derived joints specifically so published indices 0-39
keep their meaning. Stage 3 smooths native+measured (`TRACKED_NAMES`) and the derived block is
spliced back in by `add_derived`, which is why `burnin.py` deletes the derived *slice* before
Stage 3 rather than truncating the tail — truncating would silently drop every wholebody point.

Paths that produce none of these (MediaPipe, Halpe26) pad the block with zeros and every
dependent metric reports `null`. Both were re-run as a regression: they complete, and report
`None` for nose-bridge sway, head turn and forearm roll rather than substituting a body point.

**`UNRELIABLE` is now conditional.** Doc 03 §2 rejects the hand landmarks outright, and that
verdict is correct — *about MediaPipe*, which infers them from a body model that cannot see a
closed fist. A wholebody model measures them. `postprocess.gate(trust_hands=True)` keeps them
on that path only.

New metrics riding on these points, all in `metrics.per_frame` / `compute`:
`{side}_forearm_roll` (knuckle-line orientation — supination/pronation, the body-measured half
of the face story, never a face angle in degrees per doc 04 §6), `{side}_heel_lift`,
`{side}_foot_width_ratio` (roll via the sole triangle), `{side}_ankle_lean`, `head_turn` (jaw
asymmetry, a signed -1..1 ratio and deliberately **not** degrees — the map to real yaw needs
camera intrinsics we do not have), and `shoulder/hip_turn_from_address`.

That last one had to be rewritten after first measurement. Rotation from projected width was
originally referenced against the *address* frame, on the assumption address is square to the
camera. That is a face-on assumption: down the line the camera looks along the stance, so the
shoulders start edge-on and *widen* into the backswing, and every DTL swing reported 0 deg of
turn at the top. Now referenced against the widest that line projects anywhere in the clip
(p95, not max, so one bad frame cannot set it). arccos is even, so the result is magnitude
only — a line 30 deg open and 30 deg closed project identically, and one view cannot resolve
which, so the sign is omitted rather than guessed.

---

## D26 — Every RTMW keypoint was reporting confidence 1.00, because we clamped a score that is not a probability

**Date:** 2026-08-04
**Affects:** [03-POSE-TRACKING.md](../instructions/03-POSE-TRACKING.md) §3.1, doc 00 "Confidence on everything"
**Status:** ACTIVE — **invalidates every confidence figure recorded before it** — including those in D4, D9, D15a and STATUS.md's tables. 'Coverage 100% @ 1.00' was the clamp, not the model.

`pose_rtm.estimate` did `min(max(score, 0.0), 1.0)` on the model's output, with a comment
saying RTMPose scores "can exceed 1.0". For Halpe26 that is true and harmless — measured range
0.63-1.07, so the clamp trims a small overshoot. **RTMW is on a completely different scale.**
Measured across both fixtures: p01 2.87, median 5.04, p99 7.84, with ~100% of points above 1.0
on a typical frame.

So on the default path — RTMW wholebody, which is what every swing has been analysed with —
the clamp mapped essentially **every keypoint in every frame to exactly 1.00**. Consequences,
all of which were live:

- The "100% coverage @ 1.00" in the status table was measuring the clamp, not the model.
- The UI's dim/flag-low-confidence behaviour, listed as non-negotiable in doc 00, could never
  fire, because nothing was ever below threshold.
- Stage 3's `conf_ok=0.5` gate passed unconditionally, so `PROVISIONAL` was unreachable and
  D6's "evidence removes a joint, not a threshold" had no low-confidence joints to work on.
- The only sub-1.0 values anywhere in the skeleton were the `allow_single` fallbacks that cap
  at 0.6 and the interpolation marker at 0.45.

Replaced with an affine rescale, `clip((s - 1.45) / (6.17 - 1.45), 0, 1)`. The endpoints are
solved from the measured distribution over the points this pipeline actually consumes, so the
occluded tail lands under gates the rest of the code already uses: p01 to 0.30 (under the club
pipeline's usable gate), p10 to 0.50 (under Stage 3's OK gate), p50 to 0.76.

**This is a monotone rescale of a SimCC peak sharpness, not a calibrated probability**, and it
is only comparable between points from the same model. A first attempt at 1.5/7.0 put the
median at 0.50 and split the swing down the middle; it is recorded here because the temptation
is to pick round numbers rather than measure.

Effect on swing2: overall mean confidence 1.00 to 0.632, and the per-joint table becomes
informative for the first time — `right_ankle` 100% @ 0.926 against `left_foot_index` 45.8% @
0.464, which is the correct answer for the far foot of a down-the-line swing. Downstream, more
points now enter Stage 3 as PROVISIONAL and it does more work (promoted 253, interpolated 149
on swing2); events, club coverage and tempo are unchanged.

Every stored `analysis.json` from before this date has meaningless confidence values and
should be regenerated rather than compared against.

---

## D27 — Back posture: one number is available, a spine profile is not

**Date:** 2026-08-04
**Affects:** [05-SWING-PHASES-AND-SCORING.md](../instructions/05-SWING-PHASES-AND-SCORING.md) Setup & Posture
**Status:** OPEN — recorded as the path, not built. `output_segmentation_masks` is still off.

Asked whether a rounded/rolled back is measurable. It partly is, and the ceiling is worth
recording so nobody tries to score more than the data supports.

`spine_mid` cannot help: it is defined as the midpoint of `neck` and `mid_hip`, so it is
collinear with them **by construction** and can never indicate a curve. It is a render
convenience.

What is available is the sagitta of the hip-shoulders-head chain: the perpendicular offset of
`neck` (a measured shoulder midpoint) from the chord joining `mid_hip` to `head_center`, in
torso lengths. Shipped as `spine_curvature`. It is anchored on `head_center` rather than the
nose or chin deliberately — the ears sit near the skull's rotation centre, so nodding barely
moves them, which is what keeps this a back measurement rather than a head-tilt one.

Three limits, all real:

1. **One number, not a profile.** Four trunk keypoints cannot separate thoracic rounding from
   lumbar flexion. RTMW has no spine chain; nothing in the 133-point set is on the back.
2. **Down-the-line only.** The sagittal plane has to lie in the image.
3. **Only clean at address.** Once the torso rotates, the shoulder midpoint moves relative to
   the chord for reasons unrelated to spine shape. Measured on swing2 it runs 0.009 at address
   to 0.089 at the top, and most of that rise is turn, not rounding. The address value is
   posture; the delta is only readable next to `shoulder_turn_from_address`.

Measured at address: swing1 0.096, swing2 0.009 — an order of magnitude apart between two
golfers, which is the right kind of separation for a setup check but is **not yet validated
against anything real**. Neither fixture has a known-good posture assessment to check it, so
treat the scale as unvalidated until one does.

**The real answer is not keypoints.** A silhouette's back edge in a DTL view *is* the spine's
outline, and MediaPipe already ships segmentation masks — `output_segmentation_masks` is turned
off in `pose._make_options` with a note that doc 04 Layer A wants it. Fitting a curve to the
back contour between shoulder and hip height would give an actual spine profile with real
curvature, and it would work through the swing because it does not depend on a midpoint of two
joints. Not built; recorded as the path.

Also corrected while in the file: `{side}_ankle_roll` was named for a measurement it only makes
in a face-on view. Down the line it is the sagittal plane, so it reads fore/aft pressure, not
pronation. Renamed `{side}_ankle_lean`, with `ankle_lean_plane` stating which it is. Its
baseline is not zero either — the heel keypoint sits behind the ankle joint, so a neutral foot
reads ~40 deg and only the change from address is portable.

---

## D28 — Setup measurements are medians over the address hold, not samples of one frame

**Date:** 2026-08-04
**Affects:** [05-SWING-PHASES-AND-SCORING.md](../instructions/05-SWING-PHASES-AND-SCORING.md) Setup & Posture
**Status:** ACTIVE — `events.address_span` and `metrics.at_address()` are live. Applies to static setup quantities only, deliberately not to sway/lift baselines.

Posture is only assessed at address (D27), which makes it a *static* measurement — and a
static measurement taken from a single frame inherits that frame's keypoint jitter for a
quantity that is not changing.

The event detector already computes what is needed. Address is defined as the end of the
last quasi-static span before the takeaway (doc 05 A), so the frames behind it are the
golfer holding their setup. `events.detect` now exports that run as `address_span`, and
`metrics.at_address()` takes the **median** over it — median rather than mean so one bad
frame is rejected rather than averaged in.

Measured on the fixtures, where the hold is long enough to be worth using:

| | hold | median | single frame | error |
|---|---|---|---|---|
| swing1 | 55f (0.92s) | 0.1000 | 0.0956 | 0.0044 |
| swing2 | 42f (0.70s) | 0.0211 | 0.0086 | **0.0125** |

swing2 is the case that justifies the change: the single address frame read 0.0086 against a
hold median of 0.0211, a 2.5x error on the value itself. For scale, the whole separation
between these two golfers' postures is ~0.08, so single-frame noise was consuming roughly 15%
of the entire signal range — on a number that is meant to distinguish setups.

Applied to `spine_curvature_at_address`, `spine_at_address` and `stance_width_ratio`, all
static setup quantities. **Not** applied to the `base` frame used for sway/lift/roll deltas:
those are displacement baselines rather than measurements, and re-baselining every one of
them is a larger change with its own regression surface. Worth doing separately.

`address_hold_frames` is reported alongside so a short hold is visible as such. A golfer who
walks in and swings has no hold, the span collapses to the address frame, and the number
falls back to the old single-frame behaviour rather than pretending to an average it does not
have.

---

## D29 — One vocabulary: lead/trail metrics, anatomical keypoints, anterior/posterior facing

**Date:** 2026-08-04
**Affects:** [05-SWING-PHASES-AND-SCORING.md](../instructions/05-SWING-PHASES-AND-SCORING.md) Part B, [docs/GLOSSARY.md](GLOSSARY.md)
**Status:** ACTIVE — `metrics.sides`, the single `SIDES` binding and GLOSSARY.md are live. The target-relative lead/trail rule is a **correctness** requirement, not a naming preference: a camera-nearness rule grades a left-handed swing against a right-handed rubric while looking correct on every fixture we own. Untested against a real left-handed clip — see STATUS.md §5 item 3.

Three vocabularies had been coexisting: keypoints in anatomical sides, per-frame metrics in
anatomical sides, and summary keys in lead/trail derived ad hoc from `handedness` at four
separate call sites. Now settled.

**Lead/trail is defined by the target, not the camera.** The request that prompted this
described trail as "nearest the camera" and lead as "closest to the target". Those are two
different rules that happen to agree on our fixtures — right-handed golfer, down the line,
camera behind, so the trail side genuinely is nearer the lens. They diverge for a left-handed
golfer and mean nothing face-on. The target-relative definition is the one encoded, because
anything keyed off camera-nearness would read a left-handed swing against a right-handed
rubric while looking perfectly correct on every fixture we own.

**Layering.** Keypoints stay anatomical (`left_wrist`, `right_heel`) — they are model output
and a published contract. Metrics are lead/trail. `per_frame` binds `SIDES = ((lead, "lead"),
(trail, "trail"))` once, so keypoint lookups stay anatomical while emitted names do not, and
`metrics.sides` restates the resolved mapping so no consumer re-derives it. The four summary
keys that computed `'left' if handedness == 'right' else 'right'` inline are gone.

**Facing (anterior/posterior)** is new and was the other half of the request. A golfer
finishes turned to the target, so the side of the body presented to the lens inverts during
every swing, and the front end needs to know which it is looking at. It is directly
observable: shoulders are an ordered left-right pair, so the sign of
`left_shoulder.x - right_shoulder.x` flips with facing — the same signal Stage 3's side-swap
repair already takes a majority of, so the two agree by construction.

The honest part is `facing_conf`. The ordering is degenerate exactly when the shoulders are
edge-on, which is address and impact. Measured on swing2: 0.46 at address, **1.0** at the
top, **0.05** at impact, 1.0 at the finish. Consumers must treat < 0.5 as "cannot tell"
rather than as fact, and the sign is withheld entirely below that.

The pattern the fixtures produce is the geometrically correct one for a down-the-line camera:
back to the lens at address, chest to the lens near the top, back again at the finish as the
body turns through to the target. It is worth stating because the intuition "finishes facing
the target" suggests the opposite — the target is *away* from a DTL camera.

**This also resolves a limitation recorded in D25.** Rotation from projected width is an
`arccos`, so it was magnitude-only: a body turned 40 deg either way projects identically, and
the entry said one view could not resolve the sign. Facing resolves it.
`shoulder_facing_signed` / `hip_facing_signed` carry the direction and are null wherever
`facing_conf` < 0.5 — which is precisely the edge-on zone, so the sign is absent exactly
where it would have been a coin flip.

**Golf terminology layer.** `metrics.glossary` maps the standard terms a coach uses onto
fields that already existed, so the scorecard, the AI narrative and the UI cannot drift apart:
Address, Spine Angle, Primary Tilt, Secondary Tilt, Stance, C-Posture, S-Posture, Takeaway,
Coil, Transition, Tempo, Early Extension. Nothing is computed twice. Two decisions inside it:

* **Primary and secondary tilt are the same measurement in different views**, so each is null
  in the other rather than both reporting one number — the same rule `stance_width_ratio`
  already follows for DTL.
* **C- vs S-posture is the sign of `spine_curvature`**, which is a direction and not a
  diagnosis: one sagitta cannot separate thoracic rounding from lumbar flexion (D27). The
  neutral band of +/-0.03 is a placeholder carried in `posture_note`, not a rubric, and moves
  to `scoring_config.json` once clips exist with a known verdict.

`early_extension` ships with its sign explicitly unresolved: which image direction is "toward
the ball" depends on which side of the golfer the camera sits, and nothing in the pipeline
records that. The magnitude is usable today; the sign is reported for whoever can
disambiguate it rather than guessed.

---

## D30 — Re-analyze button: doc 02's job protocol against an in-memory row

**Date:** 2026-08-04
**Affects:** [02-ARCHITECTURE.md](../instructions/02-ARCHITECTURE.md) §API surface, §Job orchestration
**Status:** ACTIVE — the route and its start-then-poll contract are doc 02's intended shape and are live. **The storage is deliberately provisional**: the job row is a module-level `Map` in the Next process, so it does not survive a restart and cannot serve more than one process. `lib/jobs.ts` is the single file to replace when the SQLite job table lands; the routes and client stay unchanged.

Prompted by "some changes haven't made their way onto the stick figure". The diagnosis is
worth writing down because it will recur: **editing `swingsage/` does not change a stored
`analysis.json`.** The artifact is the contract (doc 02), the player renders it and nothing
else, so a CV change is invisible until the analyzer re-runs. Nothing was stale in the
serving path — `/api/swings/:id/analysis` sets `no-store`, the page is `force-dynamic`, and
`SwingPlayer` already skips bones whose names are absent from `keypoint_names`, so an old
artifact degrades quietly instead of crashing. The gap was that re-running meant knowing to
invoke `burnin.py` by hand.

`POST /api/swings/:id/reanalyze` starts a run; `GET` polls it. That is doc 02's documented
shape — start, then poll `stage` / `progress_pct` / `message` — and it is the shape kept.
What is provisional is only the storage: the job row lives in a module-level `Map` in the
Next process, because SQLite is not built. When the job table lands, the routes and the
client are unchanged and `lib/jobs.ts` is what gets replaced.

Decisions inside it:

* **The analyzer's input never comes from the request.** This route spawns a process, so the
  clip path is read from the swing's own `analysis.json` (`video.source.path`, recorded since
  the first burn-in), along with its view and handedness. The request supplies only the swing
  id, which `safeId` already constrains. There is no request field that can become an argv
  entry.
* **Progress is parsed from burnin's stdout**, with stage weights taken from measured
  wall-clock rather than spaced evenly — normalize and the two pose passes are most of a
  ~90s run, and a linear bar across them reads as a hang. Per-frame `pose N/M` lines update
  the message without advancing the bar. The ONNX/MediaPipe initialiser warnings are filtered
  or they bury everything.
* **Completion does a full page reload, not `router.refresh()`.** The analyzer rewrites
  `normalized.mp4` as well as `analysis.json`, and the frame count can change between runs —
  so refreshing in place leaves a component holding a buffered video and possibly an
  out-of-range frame index. Against a 90-second analysis a reload costs nothing, and it
  removes a whole class of stale-state bugs rather than arguing about them.
* **A reload mid-run rejoins the job** instead of showing an idle button next to a Python
  process that is still working.

Known limitation of the in-memory row: a Next hot-reload can re-evaluate the module and drop
a running job's record while the child process continues. That loses the *status*, not the
swing — the analyzer still writes its output, and reloading the page once it finishes picks
it up. Not worth solving before the real job table.

Also surfaced in the page header: `pose.model` and the keypoint count. After a re-analysis
the first question is which model produced what is on screen, and 48 vs 40 points is the
fastest way to see whether a run predates the measured block (D25).

---

## D31 — Ten checkpoints over eight events, and the angles measured at each

**Date:** 2026-08-04
**Affects:** [05-SWING-PHASES-AND-SCORING.md](../instructions/05-SWING-PHASES-AND-SCORING.md) Part A/B, [03-POSE-TRACKING.md](../instructions/03-POSE-TRACKING.md) §5
**Status:** ACTIVE — `checkpoints.py`, `metrics.ANGLE_FIELDS` and `metrics.checkpoints` are
live. Reference bands stay documentation until `scoring_config.json` exists.

Doc 05 Part A detects eight events because that is what GolfDB labels. Coaches use ten — the
P-system — and the gap is exactly two positions: **P6**, shaft parallel to the ground coming
down (delivery), and **P9**, trail arm parallel through the follow-through.

**The eight stay untouched.** `analysis.json.events` is keyed to a labelled dataset and
several consumers type against those names; the ten live beside it in
`analysis.json.checkpoints`, referencing the events they share a frame with. Two structures,
one detection.

The symmetry is what makes the two new positions detectable rather than invented: P2/P8 are
the shaft horizontal either side of the ball, P3/P5 the lead arm horizontal either side of
the top, P6/P9 close the pattern. Each has a real geometric criterion, and both new ones use
the same two-tier policy as Stage 5 — real criterion, stated proxy, confidence that says
which answered.

**P6's search window is bounded below by P5, and that bound is load-bearing.** A golfer who
overswings has the shaft horizontal *at the top too*, so a search opened at P4 returns P4 and
collapses two positions onto one frame. At P5 the club still points well above horizontal for
any swing.

**On swing1 the real criterion does not fire, and that is the honest answer.** Between P5
(212) and impact (221) the tracked shaft never comes within 18° of horizontal — the closest
is 74° — so P6 falls back to the hand-height proxy at confidence 0.5. On swing2 it fires at
0.8, and the independent `shaft_from_vertical` metric reads −79° from plumb there, i.e. very
nearly horizontal, which is the criterion confirming itself through a second code path. The
swing1 failure is another instance of **D20**: no club-head position-error metric exists, so
whether the shaft angle is wrong there or the event frames are is not decidable from here.

### The angles

`metrics.ANGLE_FIELDS` is now the single catalogue — field, label, the view it means what its
name says in, whether the delta from address is the usable form, whether it is setup-only.
It is emitted verbatim as `metrics.angle_fields`, and both the burn-in table and the player's
table render from it. Adding an angle in one place adds a row in both, and the two cannot
disagree about what a column means.

New this entry: elbow flex (both arms), hip hinge (the "leg to back" angle), neck angle, head
pitch, shin from vertical, arm hang, the chin/shoulders/hips stack family, and shaft from
plumb. Deltas from address at every checkpoint, which doc 05 Part B asked for and only
`event_snapshots`'s raw values existed for.

Three things the data forced:

* **`shaft_from_vertical` is measured off the downward plumb**, not off "up". Off up, the
  shaft wraps through the ±180 branch cut in the middle of the backswing and the series is
  unreadable exactly where it matters. Off down: 0 = head hanging below the hands, ±180 =
  head above them, and swing2 runs 38 → 86 (P2, horizontal) → −165 (top) → −79 (P6,
  horizontal) → 40 (impact). Monotonic and legible.
* **`*_arm_in_plane` is now published for both arms, not just the lead.** On swing2 the trail
  elbow reads **172° of flex at P3** — anatomically impossible, and precisely where the trail
  arm points down the barrel of a DTL camera. The in-plane figure there is 0.35 against 0.86
  at address. The angle is not wrong so much as it is a projection; without the companion
  field it reads as a measurement.
* **Setup-only fields are blanked away from P1** in both tables. Arm hang at the top reads
  140° — correct arithmetic, meaningless as "hang".

### `ball_direction`: a sign that was previously declared unresolvable

D-era `early_extension` shipped with "sign unresolved — camera side is not recorded; use the
magnitude". It is recorded, just not as configuration: **at address the golfer bends from the
hips and the hands hang out over the ball**, so the sign of the grip-to-hip horizontal offset
is the ball direction. Median over the address hold, DTL only, gated on magnitude.

swing1 +0.212 body heights, swing2 +0.255, both confidence 1.0 — an offset far larger than
keypoint jitter, and consistent across two different golfers. `early_extension` is now signed
(positive = pelvis toward the ball), and the stack angles gain `_signed` variants where 0 =
stacked and positive = toward the toes. Both stay `null` where `ball_direction` is null,
which is every face-on clip — the same rule `shoulder_facing_signed` follows, and for the
same reason: a guessed sign is worse than an absent one.

### What this does NOT establish

The stack angles carry two errors nothing here corrects. The foot reference is the weak link
down the line, where the camera looks along the toe line and heel→toe foreshortens onto a
short noisy segment — both feet are averaged and mid-foot is reported next to ball-of-foot so
a disagreement is visible, but that is mitigation, not a fix. And a plumb line in the image
is only a plumb line in the world for points at the same depth; a camera tilted down at the
feet skews the absolute value, though not the change from address. Reference bands (spine
30–45°, knee flex 15–25°) are documented in GLOSSARY §7 as coaching convention and are read
by no code — doc 05 puts thresholds in a versioned `scoring_config.json` and nowhere else.

---

## D32 — The pipeline was overruling a detector that was already right. Measure first, smooth second.

**Date:** 2026-08-04
**Affects:** [04-CLUB-TRACKING.md](../instructions/04-CLUB-TRACKING.md) Layers B-D, D23/D23a
**Status:** ACTIVE — all four behaviours are flags, off by default, so the variants can be compared. `--club-head-from-model --club-rigid` is the combination the numbers favour, but it is not the default until D20's metric and more fixtures exist.

Prompted by two observations, both correct: the head trace needed to be *measured* better before
being smoothed, and the drawn club changed length frame to frame — visibly, even at address
where the club is not moving.

### The detector was never the problem

`scripts/rawdet.py` renders `club.detector.boxes` — every box the model returned, with no
solver, no smoothing, no confidence gate, no geometric rejection, no `grip_center`, no
`club_px`. On swing2 the raw output is **excellent**: at address and impact the `clubhead` box
sits exactly on the club head, and `stick` (0.95-0.98) wraps the shaft tightly. The model finds
a head on **312/341 frames** at median confidence 0.72.

**But the solved head sat a median 60px away from it, with only 30% of frames within 20px.**
Injecting detections as profile evidence (D23) barely moved that: median 61px, though it did
tighten the tail (p90 273px -> 135px). A gain of 0.8 on a 0-1 support scale cannot outvote the
motion profile, shaft lines, plane prior and quadratic angle-travel cost combined.

An earlier suspicion — that the geometric rejection band was discarding good detections — was
**measured and is false**: it rejects 13 of 312, i.e. 4%. It is a safety net, not the cause.

### Four flags, measured on swing2

| variant | addr-hold jitter | Δlen p95 | median len vs calibrated | dist from model | coverage |
|---|---|---|---|---|---|
| classical | 12.5px | 17.6px | 53% | 40px | 100/100/100 |
| `--club-detector-inject heads` (D23) | 19.6px | 23.3px | 55% | 41px | 100/100/100 |
| `--club-detector-inject none` | 12.5px | 17.6px | 53% | 40px | 100/100/100 |
| `--club-head-from-model` | **1.3px** | 47.3px | 63% | **0px** | 100/100/100 |
| `--club-head-from-model --club-rigid` | **1.3px** | **7.9px** | 65% | 6px | 94/83/56 |

"addr-hold jitter" is the stdev of drawn club length over the 41-frame address hold, where the
club is physically stationary — so any variation there is pure error.

Four things this establishes:

1. **Taking the head from the model cuts the jitter 10x** (12.5px -> 1.3px). Confirmed visually:
   at address and impact the club now draws its full length to the ball, where the classical
   path drew roughly half a club.
2. **"Measure, then smooth" is the right order, and measurably so.** The model head *alone* has
   the worst frame-to-frame length change of any variant (47.3px) because raw detections wobble
   in distance. Adding `rigidify` gives the best of all five (7.9px, beating classical's 17.6).
   `apply_detector_heads` therefore writes `raw_angle`/`length` and lets `rigidify` smooth them,
   rather than smoothing a value that was already a compromise.
3. **`rigidify()` had never been called.** It was written, documented against exactly this
   jitter, and had zero call sites; `_build_club` ran instead and re-derives length every frame.
   Now behind `--club-rigid`.
4. **D23's `inject heads` was a regression** (19.6px vs 12.5px) because it wrote each frame's raw
   detection radius into `reach`, bypassing D17's radius smoothing. `detector_radius` now
   defaults **off** — the head's *angle* is the durable signal, its per-frame distance is not.

### Two things not to misread

**Coverage falling to 94/83/56% under `--club-rigid` is honest, not a regression.** rigidify
marks frames with no measurement as interpolated; the 100/100/100% everywhere else is the same
flattering number that has overstated club quality three separate times (STATUS.md §2). Read the
lower figure as the truthful one.

**The drawn club still reaches only ~65% of the calibrated `club_px`.** Since the model now
places the head directly and the overlay matches the real club, the suspect is `calibrate()`
over-estimating club length by roughly 1.5x. Not harmful while the head is measured — `club_px`
now only sets the rejection band and rigidify's clamp, neither of which binds — but it is an
open bug and it would matter again for any club-length-derived metric.

### The raw view is a product surface now, not just a script

`club.detector.boxes` is published in `analysis.json` (~57KB for 711 boxes) and the player has a
**"Model output only (raw)"** checkbox that draws them and nothing else. This exists because
"the stick figure looks wrong" has the same ambiguity for the club that it has for pose (see the
verification strategy in CLAUDE.md): the model can be wrong, or the pipeline can be wrong about
a model that was right. Until this view existed there was no way to tell those apart, and the
answer turned out to be the second one.

---

## D33 — Angles drawn on the video, and the check that they are the angles measured

**Date:** 2026-08-04
**Affects:** [03-POSE-TRACKING.md](../instructions/03-POSE-TRACKING.md) §6, [02-ARCHITECTURE.md](../instructions/02-ARCHITECTURE.md) §analysis.json
**Status:** ACTIVE — `metrics.angle_fields[].geom`, `apps/web/src/lib/angleOverlay.ts` and
`scripts/checkangles.py` are live. Both fixtures pass at 0 mismatches.

A number in a table is a number; the same number drawn on the golfer is a coaching point. So
each angle is now selectable — click its name in the checkpoint table and it is drawn over
the video as a vertex, two rays, an arc and a live label that follows the scrub.

**The analyzer publishes where each angle lives; the player only strokes it.** `angle_fields[]
.geom` names the keypoints and the reference direction, with lead/trail already resolved to
anatomical names — handedness is decided in one place (D29) and a client re-deriving it is
exactly how a left-handed swing gets drawn on the wrong limb. The label is read from
`metrics.series[frame][field]`, never recomputed, so the arc and the printed value are the
same measurement.

Every overlay is one shape — vertex, two rays, arc, label — and the kinds differ only in what
the second ray is: another bone (`interior`), straight up (`vertical`), straight down
(`plumb`), or +x (`horizontal`, which is what the stack and tilt angles are measured from).
`supplement` marks a `_flex` field, whose arc has to open from the bone's *continuation*
through the joint because the number is departure from straight. `vectors` exists for wrist
hinge alone: forearm and shaft share no endpoint, so no single vertex would be honest.

**Aspect needs no handling on the client, and that is a fact rather than an oversight.** The
analyzer measures in (x·W/H, y); the canvas draws at (x·w, y·h) with w/h = W/H. Those differ
by a uniform factor, and uniform scales preserve angles. Three of the twenty-eight fields have
no geometry at all — the rotation estimates come from projected body widths, not from two
bones — and their rows are disabled rather than drawn wrong.

### The check, and the two things it caught

`geom` and `series` are two independent descriptions of one measurement and nothing forces
them to agree. When they disagree the overlay is *confidently* wrong: a well-drawn arc on the
right joint, labelled with a number that is not the angle shown. `scripts/checkangles.py`
replays the player's own geometry resolution over every frame of a stored analysis and
compares what the geometry subtends against what was published.

1. **`wrist_deviation` was inverted, on all 247 measurable frames.** It reads like a flex but
   keeps a 180-means-straight convention (GLOSSARY §7), so marking it a supplement drew its
   complement — out by 179.97°. Caught on the harness's first run.
2. **Confidence had to be truncated, not rounded, when writing the artifact.** swing2 frame
   102 stored `left_foot_index` at exactly 0.35: below the gate before rounding, on it
   afterwards. Every consumer re-applies the same `MIN_CONF`, so the player put a foot into
   its stack reference that the metric had dropped, moving four stack angles ~2° off their own
   labels. Truncating can only move a value *away* from the gate, never onto it. This is a
   general property of the artifact, not a stack-angle quirk — any published threshold read
   back by a client has it.

The per-frame allowance is a floor plus what 5-decimal coordinate rounding is worth on the
**shorter** ray, because the two are not comparable: swing2's hip line projects to about
**two pixels** down the line, where that rounding is worth half a degree, against a spine line
six hundred pixels long. A fixed tolerance would either miss real errors on long rays or cry
wolf on short ones. The harness is for geometry attached *wrong* — inverted, wrong joint,
wrong reference — which misses by tens or hundreds of degrees, not for certifying hundredths.

### Not verified

The numbers are checked; the **visual layout is not**. Arc radius, label placement and
collision between several selected angles were not viewed in a browser here — only that the
page renders and the controls are present. Look at it before trusting the composition.

## D34 — The swing-path trace: a new palette, a tapered ribbon, and a path that stops at the apex

**Date:** 2026-08-04
**Affects:** [04-CLUB-TRACKING.md](../instructions/04-CLUB-TRACKING.md) §5, [UI-DESIGN-BRIEF.md](UI-DESIGN-BRIEF.md) §palette
**Status:** ACTIVE — `apps/web/src/lib/skeleton.ts` `TRACE_COLOR`, the ribbon renderer in
`SwingStage.tsx` (was `SwingPlayer.tsx` until D35), and `club.clip_at_apex` are live.
Verified on both fixtures.

Doc 04 §5 and the UI brief both specified **red backswing / blue downswing**, and the brief
called the palette locked. It is now bright blue `#2E9BFF` backswing, bright purple `#B44BFF`
downswing, translucent white `rgba(255,255,255,.55)` follow-through.

**The cost is real and was accepted knowingly.** Red-back / blue-down is a golf-instruction
convention, so a coach reading this trace does not get the pairing they expect and may read the
two halves of the swing backwards for a moment. What was bought is separation on *this* footage:
against grass, shadow and a dark shirt, red and blue read as similar mid-tone values, while the
blue→purple→white progression also rises in brightness, so the swing's direction is legible
from value alone rather than only from hue. That helps anyone red/green colourblind, though
**no colourblind simulation was run** — this is an argument, not a measurement.

The follow-through carries its alpha *inside the colour* rather than being stroked at a lower
`globalAlpha`, so it stays translucent no matter how the renderer sets opacity.

### Thickness carries depth, which needs a filled polygon

Canvas `lineWidth` cannot vary within a single stroke, so a tapered line is not a stroke at all —
each segment is a filled polygon built by offsetting along the path normal. Width is
`peak * taper(u)` with `taper(u) = 0.07 + 0.93 · sin(πu)^0.7`; the exponent below 1 broadens the
fat region so the stroke holds its thickness through the middle instead of spiking at one point.

The taper keys to position in the **whole** path, not in the drawn prefix — otherwise a growing
trace would re-thin its own middle every frame as the prefix lengthened. The follow-through is
scaled to `0.45` because it is both the least informative part of the path and, on both fixtures,
where detector coverage is worst; it recedes rather than competing for attention. The glow was
removed outright: on a tapered ribbon the shadow blur filled in the thin ends and destroyed the
depth cue the taper exists to create.

The ghost path was built, then deleted. Its purpose was to show where the club *would* go, but
two overlapping widths of the same colour read as a rendering artifact rather than as the future.
`grow` now controls only how much of the real path is drawn, and it works while **scrubbing**,
not just during playback — progress is a fraction of the segment (`(frame - a) / (b - a)`), so
dragging backwards retracts the path instead of leaving it fully drawn.

### Stopping at the apex

The trace used to keep drawing to the end of the follow-through, past the club going over the
shoulder — the part of the path nobody asked to see and the part the detector is least sure of.
`clip_at_apex` truncates each follow-through at its highest point (`argmin` of y, since y is
down).

Two details are what make it safe:

- **It runs after smoothing, not before.** The apex of the *smoothed* path is the one drawn.
  Clipping first lets the smoother pull points back out past the cut.
- **It refuses when the apex is at either end** (`i < 2 or i >= len-1`). That shape means no
  turn was captured, and truncating there would be inventing a high point rather than finding one.

Coverage is computed **before** clipping, so the doc 02 quality gate still reports the frames
actually measured and a deliberately shortened path cannot read as poor tracking.

Measured on regeneration: swing2's `model_trace_savgol` follow-through went **19 points to 8**,
apex last. All ten variants on both fixtures now terminate at their apex.

### The limitation worth knowing

This is the highest point **in image space**, not the true apex of the swing. On a DTL camera
the club is moving toward and away from the lens through the follow-through, so the pixel maximum
and the anatomical top of the finish are not the same instant, and on a face-on clip they will
diverge differently again. It is the right cut for the stated purpose — stop drawing before the
club goes behind the shoulder — and should not be read as a measurement of finish height.

---

## D35 — The player rebuilt on `template_sample.html`: three tabs, and overlays moved onto the video

**Date:** 2026-08-04
**Affects:** [UI-DESIGN-BRIEF.md](UI-DESIGN-BRIEF.md) §3.2, §7, §8, [02-ARCHITECTURE.md](../instructions/02-ARCHITECTURE.md) §UI
**Status:** ACTIVE — `apps/web/src/app/globals.css` carries the design system;
`SwingWorkspace` / `SwingStage` / `OverlayMenu` / `views/*` / `ui/kiosk.tsx` are live.
`SwingPlayer.tsx` is gone: its drawing code moved verbatim into `SwingStage.tsx` and its
transport into `lib/usePlayer.ts`. D30's job protocol and D33's angle overlays are unchanged.

`instructions/template_sample.html` is now the visual spec for the web app. Its `<style>`
block is reproduced unaltered in `globals.css`, and the `tailwind.config` colours it declared
inline became the `@theme` block, because Tailwind v4 reads theme tokens from CSS rather than
from a JS config. The unlayered CSS after `@import "tailwindcss"` keeps the same precedence the
sample had — its `<style>` tag came after the CDN script — so a component class still beats a
utility on the same element.

### What changed structurally

The 300px rail of six equal-weight panels is gone. It was the UI brief's opening complaint
(§8.1): overlay toggles, sync drift, club caveats, metrics, face and pose coverage all rendered
at the same weight, so a golfer and a developer were served the same screen. In its place:

- **Overview** — measurements a golfer reads: tempo, the documented quality gates, the ten
  checkpoints as a scrollable rail, and one channel of `metrics.series` across the clip.
- **Coach** — the narrative layout, with every button wired to a real loop.
- **Advanced** — everything that used to be in the rail, in full, plus the angle catalogue as
  the sample's metric explorer and the ten-checkpoint table.

**Overlay selection moved onto the video**, as a dropdown hung off a layers icon in the frame's
top bar. That is where the decision is made — you turn the trace on while looking at the swing,
not while reading a settings column — and it takes eight checkboxes out of the same visual
register as the diagnostics.

### The defaults were reversed

`club` and `trace` now ship **on**. The brief called the old off-by-default "almost certainly
wrong" (§4) and made seeing the trace without touching a settings panel its top deliverable
(§10.1). One line in `lib/overlays.ts`; trivially reverted.

### The part that is a deviation, and why

**The sample's numbers were not carried over.** It ships an Ideal Score of 82, an ArcShift of
−12, six graded findings, 54 weighted metrics and a five-swing trend. None of those pipelines
exist — the scoring engine is doc 05 Part C, the narrative is doc 07, and there is no swing
history. Every such slot keeps its exact geometry and is filled with either a real measurement
or a `NotBuilt` marker:

| Sample slot | Now |
|---|---|
| Ideal Score gauge | arc draws, marker absent, reads `—` / SCORING NOT BUILT |
| ArcShift™ −12 | the measured tempo ratio, in the same position |
| 6 graded findings | 4 checks from gates already written down: the 2.5–3.5 tempo band, the 0.5 event-confidence floor, doc 02's 50% club-coverage gate, pose detection coverage |
| 8 scored indicator rings | the ten checkpoints, ring = **detection confidence**, labelled as such |
| 5-swing score trend | one `metrics.series` channel across this clip, click to seek |
| 54 weighted metrics | `metrics.angle_fields`, ranked by peak change from address — no weight column, because nothing weights anything |
| Coach narrative / drill | `NotBuilt`, with the loop buttons still working |

A fabricated swing score is the single thing this product must not render, and it is exactly
the number a golfer would believe. Marking the slot also makes the screen double as a build
status. **When scoring lands, these are the slots to fill** — the card shapes are named and
documented in `components/ui/kiosk.tsx` for that purpose.

### Three places the sample had to give

- **`.video-frame`** was a fixed `height: min(91vh, 930px)` on a hardcoded `aspect-[9/16]` box.
  Real clips are not all 9:16 and "Fit to golfer" changes the aspect per swing, so it is now
  `width: min(100%, aspect × min(91vh, 930px))` with the aspect passed in as `--frame-aspect`.
  Identical geometry for a portrait clip; it stops overflowing the column for everything else.
- **The scrub strip** does two jobs the sample's does not. Its segments are decorative
  (`aria-hidden`) under an invisible full-width range input; ours are the phase buttons —
  click one to loop it — so the input keeps only the keyboard path (`pointer-events: none`) and
  the strip owns the pointer gesture, using 4px of slop to tell a tap from a drag.
- **`shadow-acid`** is declared in `@theme` but unusable as a utility: Tailwind v4 resolves
  `shadow-<name>` against the colour namespace first, and `--color-acid` exists, so the token
  silently becomes a shadow *colour*. Written out longhand where used.

### Not addressed

The UI brief's remaining asks stand: no per-frame chart beyond the one sparkline strip, no
annotation tools, no compare mode, no designed mobile layout beyond the sample's own
breakpoints. `analysis.json` is still passed to the client as props inside the server-rendered
HTML (~810 KB), which the brief already flags as debt.

### Second pass — the transport left the picture, and the sparkline changed meaning

Five changes after seeing it on a real clip:

- **The transport is no longer burned into the frame.** The sample spends ~200px of the bottom
  of a portrait video on a scrim, a scrub bar and three rows of buttons. Only the moment name
  and the frame readout stay over the picture now; the scrub strip and the controls sit in a
  `stage-transport` block below it. Combined with the video column growing from 430/470px to
  540/620px and `.video-surface`'s lit-room gradient coming off the stage, the visible picture
  is materially bigger without the frame getting taller.
- **The frame is top-aligned** in its column rather than vertically centred, and the column has
  no panel behind it — it holds one thing, so a background was a lighter rectangle competing
  with the video.
- **Single-frame step buttons** either side of play. `←`/`→` have always done this; that is no
  use on a phone or to anyone who has not read the hint line.
- **The view/handedness badge came off the video.** It is a property of the clip, not of the
  frame you are on, and it already appears in the Overview chip row.
- **The sparkline is a history chart, not a timeline.** It was one channel of `metrics.series`
  across the clip — genuinely unused data, but a second timeline next to the scrub bar, which
  read as a duplicate of it. It is now `ProgressTrend`: one point per analysed swing oldest to
  newest, the current swing marked, each point a link to that swing, hover for the value, and
  the change from the previous swing at the end. It plots the tempo ratio because that is the
  only number the pipeline produces that compares between swings; `metric`/`unit`/`decimals`
  are props so it becomes the Ideal Score by changing the caller.

### Mobile: the sheet rides over the video

Below the two-column breakpoint the stage is `position: sticky` and the panel scrolls up across
it behind a rounded, opaque top edge. **`#summaryPanel` has to become `display: block` for this
to work at all** — a sticky *grid item* is confined to its own grid area, and in a
single-column grid that area is exactly the item's height, so sticky would have nowhere to
travel and would silently do nothing. The frame goes full-bleed width capped at
`calc(100dvh - 210px)`, which is what keeps the transport above the fold on a phone; `dvh`
because a 9:16 clip plus controls does not survive the browser's collapsing chrome otherwise.

No scroll listener and no observer — it is one `position: sticky` declaration, which the
compositor handles.

### Entrance motion

`opacity` and `transform` only, so every frame is compositor work: no layout, no paint, no
JavaScript, no library. Stagger is a `--i` custom property on the element, so a rail of twelve
cards is one CSS rule and twelve inline integers rather than twelve timers. The whole block
lives inside `prefers-reduced-motion: no-preference`.

`animation-fill-mode: backwards`, not `both`, and this is the part worth remembering: `both`
pins the final keyframe as a permanent override, so a finished entrance whose last frame is
`transform: none` beats `.indicator-card.active`'s lift and every hover transform on the page.
`backwards` holds only the *first* frame, before the animation starts, then gets out of the
way. Cards that carry their own transforms use the opacity-only `.fade` for the same reason.

### Third pass — the scored view, on mock data

**This reverses what the first pass of D35 said**, on the product owner's explicit instruction:
*"Make mock data for the scoring for now when empty. Treat this like a scored view."* The
Overview and Coach tabs now render a full scorecard — overall score, ArcShift, findings,
per-checkpoint ring scores, primary fix, drill, session dose — and none of it is measured.

The reasoning for the reversal is sound: a screen full of `NotBuilt` markers cannot be designed
or reviewed as the product it is going to be. The layout, the density and the hierarchy of a
scored view are only judgeable with plausible numbers in the slots.

`lib/mockScoring.ts` is the whole of it, and it holds three properties that matter:

- **Deterministic per swing.** Seeded from the swing id (FNV-1a → mulberry32). A score that
  changed while you scrubbed, switched tabs or reloaded would read as a bug and would make any
  real UI bug impossible to reproduce.
- **Marked wherever it surfaces.** `SCORING_IS_MOCK` is exported and every consumer renders a
  `DEMO` pill. The Advanced tab states it in full. Flipping that one constant is what a real
  scorecard turns off.
- **Real measurements never pass through it.** Tempo, angles, coverage, confidences, club face
  and sync all still come straight from `analysis.json`, in the components that show them. The
  mock module reads the checkpoint list and nothing else.

**The hard rules are untouched.** Face angle at impact is still never a number from video
(doc 04 §6); nothing here fabricates one. When doc 05 Part C lands, `mockScorecard()` is
replaced by the real scorecard and the `MockScorecard` interface is the contract the UI already
renders against.

### Overview is the golfer's screen now

Pose coverage, event confidences, club-coverage gates, the schema-staleness banner and the
capture chips came off Overview entirely — they were the previous pass's honest substitute for
scores, and they described *the analysis* rather than *the swing*. All of it is still in
Advanced, in full. The staleness banner renders only on that tab for the same reason.

### Smaller things in the same pass

- **The progress chart is gone.** Removed on request; `ProgressTrend.tsx` deleted.
- **Re-analyze moved to a floating debug corner** (`DebugMenu`, sticky bottom-right) with the
  raw-JSON link. A 90-second Python job does not belong at the same weight as "Swing Log".
- **New Swing is green** — the product's own primary action, now that it is the only one in
  that row.
- **The video fills its column.** `.video-frame` is width-first (`width: 100%` + `aspect-ratio`)
  rather than height-first; height-first always left side gaps on some aspect ratio, which read
  as stray padding next to a full-width transport. Columns are 480/560px, and they are what
  bounds the video now.
- **`.hero-panel` lost `overflow: hidden`.** Its corner bloom was a 420px pseudo-element hung
  outside the panel, which forced the clip — and that clip also cut off the gauge's
  `drop-shadow` glow. Same bloom as a background layer, nothing overflows, glow renders whole.
- **The video carries two icons and one word.** The swing id, the overlay summary line
  (`BODY + CLUB + PATH`) and the frame/time/event readout all came off the picture; the
  overlay picker is an unlabelled dark icon matching full-bleed. Only the moment name remains.
- **Loop and the frame steps are 52px circles**, matched to the speed toggles, so the transport
  reads as one band with a single oversized play button.
- Indicator cards lost their sub-labels.

### Fourth pass — the tabs came down onto the right column

The page-wide `workspace-bar` is gone from the player. The brand lockup came off, and the three
folder tabs moved onto the top of the right-hand column as `.panel-tabs`, carrying their own
bottom rule — a folder tab needs a line to sit on, and the bar was the only thing providing one.
The left column now starts at the video and contains nothing but the video and its transport.
Swing-level actions sit alone, right-aligned, above the grid. On mobile the tabs are the first
thing inside the sheet that rides over the sticky video.

Insights are eight, in two rows of four, interleaved fault/strength so no row reads as all-red
or all-green. Vertical rhythm between the hero, the insights and the rail was opened up.

### Why the selected card's glow kept getting clipped

`.indicator-viewport` is `overflow-x: auto`, and **CSS forces the other axis to a non-visible
value when one axis scrolls** — `overflow-y: visible` computes to `auto` there. So the selected
card's shadow could never escape that box no matter what was done to the ancestors, and the
earlier fix to `.hero-panel` was addressing the wrong container. The shadow has to fit *inside*
the scroller's own padding, which means the two have to be designed together:

- glow tightened from `0 18px 45px` to `0 8px 22px` → 14px above, 30px below, 22px each side;
- plus the card's `translateY(-2px)` → 16 above, 28 below;
- the `.active-caret` and its drop-shadow reach ~17px above;
- so `.indicator-viewport` reserves `22px 26px 30px 24px`, with `margin-left: -20px` putting the
  first card back on the panel's own left edge.

Change the blur and the padding has to change with it. That coupling is the reason both numbers
carry comments.

Unselected cards also went from `rgba(255,255,255,.035)` to `.06` with a hover lift, because the
rail is the main way into a moment of the swing and it was reading as a row of read-only tiles.

---

## D36 — `playback_window`: the clip is the swing, not the file

**Date:** 2026-08-04
**Affects:** [05-SWING-PHASES-AND-SCORING.md](../instructions/05-SWING-PHASES-AND-SCORING.md) §A,
[02-ARCHITECTURE.md](../instructions/02-ARCHITECTURE.md) §analysis.json
**Status:** ACTIVE — `events.playback_window()`, schema 5, and `apps/web/src/lib/playbackWindow.ts`.
Verified on both fixtures.

A 6.6s clip was being played end to end when 4.0s of it is the swing. The rest is the golfer
walking in and settling, then lowering the club and walking off — and on a scrub bar that dead
footage is worse than wasted, because it compresses the part you are actually studying.

`playback_window` is a new field: **one second of approach, the swing, one second of the held
finish.** The player treats it as the clip — seeking, frame-stepping, the scrub strip, the
segment bar and the end-of-playback wrap are all bounded by it, and `nFrames` survives only
because the pose and club arrays are indexed against the file.

### It is not `swing_window`, and that is the point

`swing_window` already existed and is useless for this. It is a motion burst thresholded at 10%
of the hand-speed peak, used to gate Stage 3's grip prior — on swing1 it is frames **195–250**,
which starts most of the way *down the downswing*, because the backswing never reaches a tenth
of the downswing's hand speed. Reusing it would have cut the backswing off entirely.

### The two anchors, and why they are different in kind

**Front — the Address event.** Address is the end of the last quasi-static hold at setup height,
so one second before it is the last second of the setup. This only works because Address takes
the *last* hold rather than the longest one; a golfer settles, waggles and re-settles, so the
longest hold is usually an early one and anchoring on it left 0.8s of dead air at the front.

**Back — stillness, not the Finish event.** Finish is defined as the moment motion decays
(doc 05 A.9), which fires as soon as the hands slow — and the hands slow almost to a stop at the
top of the follow-through arc, well before the golfer has arrived at the finish position and
held it. On swing2 the first frame under threshold is f148; the golfer is not actually still
until **f167**, nineteen frames later. `_settle()` requires the speed to stay under threshold
for 0.30s, which a momentary slow point cannot satisfy. The window can only ever be wider than
the Finish event, never narrower.

**Deliberately not clamped to where motion ends.** On both fixtures the last frame above
threshold is near the end of the clip (f395 of 396, f321 of 341), because lowering the club and
walking off is motion. That is precisely what is being trimmed.

Measured: swing1 6.60s → **4.03s** (1.50s off the front, 1.07s off the back); swing2 5.68s →
**3.80s**.

### Why the analyzer and not the browser

Considered and rejected, though the cost argument runs the other way: it is a threshold scan
over a few hundred floats, so it is free in either language. It belongs in the artifact because
it is a property of the swing rather than of the viewer — the burn-in, a future keyframe
extractor and the coach report all need the same answer, and doc 02 has the client rendering a
stored artifact rather than re-deriving one. The detection also needs the per-frame hand-speed
signal, which is not in `analysis.json`; only its consequences are.

`lib/playbackWindow.ts` does carry a fallback for artifacts written before schema 5:
`address − 1s … finish + 1s`. That is arithmetic on published frame numbers, not detection, and
it is a strictly better default than the whole clip. It ends slightly early for the reason
above — it cannot see the settling — which is the one thing re-analysing buys.

## D37 — Tempo as a check on event detection, not just a coaching number

**Date:** 2026-08-04
**Affects:** [05-SWING-PHASES-AND-SCORING.md](../instructions/05-SWING-PHASES-AND-SCORING.md) §B
**Status:** ACTIVE — `tempo.implausible` plus a `notes` line. Both fixtures exercised; swing2
still flags, correctly.

Real golf tempo clusters hard around **3:1**, with a backswing near 0.8s. That makes the ratio
a free, independent check on Address, Top and Impact — the same shape of argument as D33, where
`geom` and `series` are two descriptions of one measurement and nothing forces them to agree.
Here the events and the tempo they imply are the two descriptions.

Bands, published as `tempo.implausible` and echoed into `notes`: backswing 450–1300ms, downswing
150–400ms, ratio 1.8–4.2:1.

**It caught the bug in D36's front anchor.** swing1 read **4.17:1 with a 1600ms backswing** —
not a swing anyone makes. That was Address landing on the longest quasi-static hold instead of
the last one, 48 frames early. After the fix it reads 2.09:1 / 800ms and the flag clears. Nobody
was looking at tempo as a correctness signal; it was sitting in the artifact the whole time
saying the events were wrong.

### It flags and never corrects, and that is the entire point

swing2 reads **1.55:1 with a 483ms downswing** and still flags after the fix. It is not wrong.
Its Impact frame is independently confirmed by the club-head low point — **exactly f115**, with
swing1 agreeing within two frames (219 against a detected 221) — so the events are right and the
swing is genuinely slow, a deliberate rehearsal tempo rather than a full swing.

Auto-nudging toward 3:1 would therefore have moved a *correct* event to satisfy a prior, and
would have done it silently. A flag asks a human to look; a correction fits the data to the
expectation.

### Not verified

The bands come from published golf-instruction norms, **not** from measurement on this fixture
set — two clips cannot calibrate three thresholds, and one of the two legitimately falls outside
them. Expect to widen them as real fixtures land. A flag is a prompt to look, not a defect, and
it should stay out of anything user-facing until the bands are earned.


### Addendum to D35 — the scrub handle, the phase tooltip, and the tabs joining the panel

**The playhead was a marker, not a handle.** The sample draws a 2px line with a 12px dot, which
is right for something you only read. Dragging it is the primary interaction on this screen, so
it is now a 22px knob with three grip bars that grows to 26px while the strip is hovered or
held. The strip carries `cursor: grab`, and `:active` covers the drag itself — the button stays
held for the whole gesture, so that needs no React state. The knob is centred on the same pixel
at both sizes, which is why the grip bars never have to move with it.

The line itself gets **no transition**. It tracks the playhead every frame, and easing there
reads as the overlay lagging the video.

**Phase names on hover.** `data-tip` plus `::after`, not `title`: the native tooltip is slow to
appear, unstyleable, and would open on top of the styled one a second later. The caret is a
separate `::before` pinned to the segment's centre, so the two end segments can edge-align their
bubble without it pointing at the wrong place.

The names come from a new `PHASE_LABEL` map rather than from `EV_SHORT`. The phase bar labels
each segment with the short code of the event it *ends* at, so the span from address to toe-up
reads "TOE" — which the UI brief lists as a genuine confusion (§8.6). That span is the takeaway.

**The tabs are joined to the panel.** `.panel-bar` overlaps the panel's top border by a pixel
(`margin-bottom: -1px`) and sits above it (`z-index: 1`), so the active tab — no bottom border,
near enough the panel's own background — paints over the seam. `.view-panel` squares off its
top-left corner, because a rounded one leaves a notch beside the first tab and the two read as
separate objects. The swing actions moved into that same row and drop their labels below 1536px,
where the column can no longer hold three tabs and four labelled buttons; the tabs keep theirs,
since a tab is a place you are and an action is a thing you recognise by its icon.

The staleness banner moved below the panel. It used to sit between the bar and the panel, which
put a gap in exactly the seam the bar exists to close.

**Rail alignment.** `.indicator-rail-wrap` now bleeds `-20px` on both sides and the viewport
pads 20px back, so the cards line up with every other row in the panel while the scroller still
has room for the selected card's glow. 20px is the panel's smallest padding step (`p-5`), so the
bleed never crosses the panel edge — and the glow blur came down to 20px to fit it.
