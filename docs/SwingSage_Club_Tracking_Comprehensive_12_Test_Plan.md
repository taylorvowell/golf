# SwingSage Club-Head Tracking and Swing-Path Tracing
## Comprehensive 12-Test Research, Evaluation, Architecture, and Implementation Plan

**Status:** August 7, 2026  
**Scope:** Offline club-head tracking and DTL/oblique swing-path rendering from uploaded phone video.  
**Architecture:** Computer vision and all derived path geometry remain in `services/analyzer/`. The web player renders analyzer output only.  
**Evaluation set:** Existing nine committed fixtures, plus mirrored handedness tests and additional labeled footage as it becomes available.

---

# 1. Decision summary

The club-head problem should not be implemented as independent per-frame detection followed by cosmetic smoothing.

The production-quality formulation is:

```text
preserve real source timing
-> generate multiple kinds of club-head evidence
-> distinguish observed, blurred, occluded, duplicated, and inferred samples
-> reject impossible/off-path candidates
-> solve one global trajectory over the full backswing + downswing
-> jointly refine address, top, and impact
-> apply a selected analyzer-side trajectory/render fit
-> sample the finished path at the player's exact 60 fps timeline
-> write every point, phase, confidence, and variant to analysis.json
-> frontend only scales and draws
```

The final evaluation should contain **12 individually selectable tests**:

1. Global Candidate Graph
2. Club-Specific Temporal Heatmap
3. Modern Point Tracking
4. Video Object Segmentation
5. Blur + SEA-RAFT + Deblatting
6. Grip-Centered Kinematic Reconstruction
7. Claude Bounded Adjudication
8. Phase-Adaptive Multi-Tracker Fusion
9. Coarse-to-Fine Source-Time Forensic Fusion
10. Physics-Constrained Conic / Factor-Graph Optimization
11. Synthetic Temporal Densification
12. Audio-Visual Impact Anchor + Endpoint Reconstruction

Tests 8 and 9 are deliberate multi-method fusion systems. Tests 10, 11, and 12 are the three additions made after comparing the independent research pass against the original nine-test plan.

The most likely production direction remains **Test 9 or a simplified descendant of Test 8/9**, but the experiment should determine which experts actually contribute measurable value.

---

# 2. Hard product requirements

## 2.1 Trace scope

For DTL and oblique views, the visible club trace contains only:

```text
backswing: address -> top
downswing: top -> impact
```

No visible follow-through trace.

The existing eight GolfDB events must still be published:

```text
address
toe_up
mid_backswing
top
mid_downswing
impact
mid_follow_through
finish
```

Existing metrics, checkpoints, scorecard logic, and playback-window semantics remain compatible.

## 2.2 Phase colors

- Backswing: blue
- Downswing: green

The final `top` event controls the color transition.

## 2.3 Club head only

The product does not need shaft tracking.

A test may use shaft-like geometry internally if useful, but the output and evaluation target is the club head.

## 2.4 Continuity

Default output is one continuous trace.

A two-line output is permitted only if evidence around the top/transition is so weak that bridging it would create an unjustified trajectory.

Allowed exception:

```text
backswing line
gap around top
downswing line
```

No other intentional gaps.

## 2.5 Global smoothing

The path must be completed before playback.

Forbidden behavior:

```text
frame arrives
-> smooth based only on the past
-> draw
```

Required behavior:

```text
analyze entire swing
-> globally fit path
-> generate final per-frame path
-> persist
-> draw
```

## 2.6 Impact reconstruction

If the camera does not directly observe the club head at impact, the system may infer the final downswing point using:

- final reliable downswing observations,
- continuous trajectory,
- velocity/acceleration,
- address club-head region,
- grip geometry,
- blur/streak evidence,
- impact event timing,
- optional audio,
- optional ball departure.

The artifact must mark inferred states as inferred.

## 2.7 Contract

`analysis.json` remains the authoritative analyzer-to-player contract.

All new geometry:

- normalized `[0,1]`,
- x right,
- y down,
- analyzer-computed,
- confidence-bearing,
- append-only.

The player may scale normalized coordinates and render paths. It must not perform CV or invent missing trajectory geometry.

---

# 3. Key research conclusions

## 3.1 The effective frame rate is the source observation rate, not the CFR output rate

Stage 0 converts uploads to CFR 60 fps. A 30 fps upload therefore often produces duplicated frames.

Those duplicates are useful for deterministic player synchronization but do not create new club-head observations.

The tracker must distinguish:

```text
normalized output sample
vs.
genuine camera observation
```

### Required amendment

Preserve original frame timestamps before CFR conversion.

Do not make image-difference duplicate detection the primary source-timing method when the original demux timestamps are available.

Use duplicate detection only as:

- a legacy-file fallback,
- a verification signal,
- or protection against unusual source encodings.

## 3.2 A 90 px/source-frame club head is beyond ordinary small-object detection assumptions

The hardest fixture reportedly moves the head roughly 90 pixels per frame through impact.

At that speed:

- the object moves many times its own apparent width,
- local appearance changes dramatically,
- blur may be longer than the recognizable club head,
- point correspondence can fail,
- a high-confidence box can easily attach to turf, shoe, hand, foliage, or shaft.

Temporal evidence is essential.

## 3.3 TrackNet-style temporal heatmaps fit the problem

Fast sports-object trackers such as the TrackNet family explicitly use consecutive frames so trajectory context becomes part of the feature representation.

Useful transfers to SwingSage include:

- heatmap output instead of box-only output,
- temporal windows,
- motion-aware feature fusion,
- trajectory rectification,
- visibility/occlusion prediction,
- signed motion direction,
- synthetic occlusion training.

TrackNetV5-style direction information and TOTNet-style occlusion training should be incorporated into Test 2's design rather than treating earlier TrackNet versions as the endpoint.

## 3.4 Detection should generate hypotheses, not dictate the path

A standard detector remains valuable, especially when combined with:

- a P2 / stride-4 small-object head,
- keypoint/heatmap output,
- high-resolution ROI inference,
- SAHI-style slicing,
- intentionally low score thresholds,
- temporal candidate association.

The global solver should decide whether a detection belongs to the trajectory.

A low-confidence detection exactly where multiple other experts expect the club head can be useful.

A high-confidence detection far outside the plausible swing corridor can be wrong.

## 3.5 SEA-RAFT is a stronger optical-flow candidate than generic RAFT for this test

SEA-RAFT improves the RAFT formulation and reports strong cross-dataset performance with higher efficiency.

Use it in Test 5 and as the preferred flow expert in Tests 8 and 9, subject to actual compatibility and GTX 1080 benchmarking.

Flow remains supporting evidence, not a standalone truth source.

## 3.6 Motion blur contains trajectory information

A blurred fast-moving object is not necessarily located at one crisp coordinate during a frame exposure.

Deblatting / Fast Moving Object research treats the blur kernel itself as an intra-frame motion trajectory.

For the club head this means:

- a long impact streak should not automatically be labeled "failed detection",
- the streak direction and support can constrain the path,
- a blur frame may be better represented by a short path segment than by a single point.

### Limitation

Deblatting assumptions can fail badly when the club head merges into:

- turf,
- shadow,
- compression artifacts,
- other moving body parts.

Use blur/deblatting as evidence or a specialist expert, not as the only tracker.

## 3.7 Point trackers provide valuable independent evidence but are outside their easiest regime

CoTracker3, TAPIR, LocoTrack, TAPNext++, and related Tracking-Any-Point methods are useful because they solve a different problem from detection.

They are especially promising for:

- address,
- backswing,
- top approach,
- re-detection from multiple seeds,
- bidirectional offline tracking.

They are less trustworthy when:

- the query point becomes a featureless streak,
- displacement is extreme,
- the club head is fully occluded.

Test 3 should benchmark multiple point trackers behind one adapter instead of declaring one framework the permanent winner before measuring the fixtures.

## 3.8 Segmentation is worth testing but is not expected to dominate impact

SAM 2-style video object segmentation can produce:

- centroid,
- shape,
- area,
- mask confidence,
- temporal memory.

The known weakness is exactly the SwingSage hard case: a tiny fine object moving quickly with blur and partial occlusion.

Test 4 should include:

- bidirectional propagation,
- small ROI operation,
- mask-size sanity checks,
- motion-model assistance,
- automatic branch termination when the mask grows into the golfer/background.

## 3.9 Near-impact club-head motion supports a conic/ellipse prior, but only as a soft local prior

Motion-capture research supports near-impact club-head trajectory planarity and successful ellipse fitting.

That does **not** justify forcing the entire backswing and downswing onto one ellipse.

Use the prior primarily in the lower downswing / impact region.

Likewise:

```text
3D club length ~= constant
```

does not imply:

```text
2D projected distance(grip_center, club_head) == constant
```

Perspective and out-of-plane orientation change the projected length.

Therefore:

- grip-to-head radius is a soft prior,
- conic/ellipse shape is a phase-local prior,
- neither should be a hard equality constraint.

## 3.10 Synthetic video interpolation does not create real observations

RIFE and related video-frame interpolation methods can synthesize plausible intermediate imagery.

Those frames can potentially help a downstream tracker form a smoother hypothesis.

They do not recover sensor evidence that was never captured.

The experiment is still worth running, but every coordinate derived primarily from an interpolated frame must be treated as inferred.

Synthetic frames must never increase observation confidence beyond the real frames that bound them.

## 3.11 Audio can be a high-value impact timing cue, but not an unquestioned millisecond truth source

A club-ball strike creates a strong acoustic transient in many recordings.

Audio sampling rates are much higher than video frame rates, so a clean synchronized recording can localize an acoustic onset much more finely than a 30/60 fps image grid.

However, absolute timing can be shifted by:

- A/V mux synchronization,
- codec priming/delay,
- phone processing,
- microphone position,
- speed of sound from the ball to microphone,
- echoes,
- nearby impacts or range noise.

Therefore audio should provide:

```text
impact timing likelihood
```

not an unconditional exact impact timestamp.

Where audio and visual evidence agree, confidence should rise sharply.

Where they disagree, the system should expose the disagreement.

## 3.12 Ball departure is an optional impact cue

If the ball is visible:

- background subtraction,
- local frame differencing,
- optical flow,
- or a tiny ball detector

can sometimes identify the first frame in which the ball has departed.

This is a useful independent cue for Test 12.

It must remain optional because the ball may be:

- too small,
- hidden by the club,
- outside useful contrast,
- or compressed away.

## 3.13 The final problem is a trajectory optimization problem

The system should solve a continuous path:

```text
p(t) = [x(t), y(t)]
```

using an objective conceptually similar to:

```text
measurement residual
+ robust outlier loss
+ temporal acceleration penalty
+ jerk penalty
+ expert-specific uncertainty
+ phase direction consistency
+ soft grip-radius prior
+ phase-local conic prior
+ event consistency
+ impact-region likelihood
```

This is superior to smoothing whatever one detector happened to output.

---

# 4. What is physically recoverable

## Reasonably achievable

From a single DTL/oblique phone video, SwingSage can target:

- accurate 2D image-plane club-head path,
- strong backswing and downswing segmentation,
- robust address/top/impact timing estimates,
- visually professional continuous tracing,
- confidence-aware gap reconstruction,
- false-detection rejection,
- reproducible normalized per-frame output.

Using the original high-resolution source can materially improve some clips.

## Not guaranteed or not physically identifiable

### True metric 3D club path

A monocular view collapses depth.

Multiple 3D paths can project to a similar 2D path.

### Exact world-space angle of attack or club path

These require camera calibration, depth/3D geometry, known scale, or additional sensors/views.

### Exact club-head speed in physical units

Pixel velocity is observable.

Meters/second is not generally recoverable without scale and camera geometry.

### Exact impact time when no synchronized cue captures it

Trajectory and audio can estimate it.

If contact occurs between distinct exposures, the video did not directly record the exact image state at contact.

### Exact recovery through full occlusion or sensor destruction

If the head is completely hidden or represented only by ambiguous compression/blur, the path can only be inferred.

### Perfect rolling-shutter correction

Without camera readout calibration, severe row-time distortion cannot be exactly reversed.

---

# 5. Shared data model

## 5.1 Source observation

```python
@dataclass
class SourceObservation:
    source_frame: int
    source_pts_s: float
    normalized_frames: list[int]
    is_duplicate_group: bool
```

## 5.2 Club observation

```python
@dataclass
class ClubObservation:
    frame: int
    source_time_s: float | None
    x: float
    y: float
    confidence: float
    mode: Literal["observed", "mixed", "inferred"]
    source: str
    visibility: str
    covariance: tuple[float, float, float] | None = None
```

Suggested `source` values:

```text
detector
temporal_heatmap
point_tracker
segmentation
sea_raft
deblatting
kinematic
vfi
audio_event
ball_departure
claude_choice
fused
```

`audio_event` never supplies x/y coordinates. It contributes timing likelihood only.

## 5.3 Club candidate

```python
@dataclass
class ClubCandidate:
    frame: int
    source_time_s: float
    x: float
    y: float
    confidence: float
    source: str
    features: dict[str, float]
```

Useful features:

- detector score,
- heatmap peak score,
- heatmap entropy,
- point-tracker visibility,
- flow magnitude,
- flow direction,
- blur score,
- streak orientation,
- distance from grip,
- projected grip radius,
- distance from predicted path,
- distance from golfer silhouette,
- phase consistency,
- expert agreement,
- source-observation status.

## 5.4 Blur observation

```python
@dataclass
class BlurTrajectoryObservation:
    frame: int
    source_time_s: float
    start_x: float
    start_y: float
    end_x: float
    end_y: float
    confidence: float
```

A blur interval should not be forced into a fake center-point label.

## 5.5 Event likelihood

```python
@dataclass
class EventEvidence:
    event: Literal["address", "top", "impact"]
    time_s: float
    confidence: float
    source: str
```

Sources can include:

```text
pose
club_trajectory
audio
ball_departure
blur
existing_event_model
```

---

# 6. Stage 0 source-time amendment

Before CFR conversion, inspect the original upload with ffprobe/ffmpeg and persist:

- source frame PTS,
- time base,
- nominal frame rate,
- actual frame timestamps,
- audio stream presence,
- audio sample rate,
- duration,
- rotation metadata.

Example analyzer metadata:

```json
{
  "sourceTiming": {
    "nominalFps": 29.97,
    "timeBase": "1/30000",
    "hasAudio": true,
    "audioSampleRate": 48000,
    "observations": [
      {
        "sourceFrame": 91,
        "ptsSeconds": 3.0367,
        "normalizedFrames": [182, 183]
      }
    ]
  }
}
```

Do not require the frontend to consume this.

Tests 9, 11, and 12 use it directly.

For legacy videos without source mapping:

1. calculate duplicate similarity,
2. cluster repeated normalized frames,
3. assign conservative observation confidence.

---

# 7. Ground-truth and evaluation dataset

The existing nine fixture videos are not enough to train a production model, but they are enough to construct the first comparative benchmark.

## 7.1 Manual club annotation

For every genuine source observation inside address-to-impact:

### Visible

```json
{
  "visibility": "visible",
  "point": {"x": 0.712, "y": 0.431},
  "confidence": 1.0
}
```

### Motion streak

```json
{
  "visibility": "blur_streak",
  "trajectory": {
    "start": {"x": 0.701, "y": 0.444},
    "end": {"x": 0.742, "y": 0.407}
  },
  "confidence": 0.8
}
```

### Unobservable

```json
{
  "visibility": "unobservable",
  "confidence": 1.0
}
```

## 7.2 Critical event annotation

Annotate:

- address/takeaway onset,
- top/direction reversal,
- impact.

Allow:

```text
frame interval
or
fractional timestamp
```

when the exact event is not directly observable.

## 7.3 Audio annotation

For clips with audio, label:

- candidate strike transient,
- ambiguity,
- competing range impacts/noise,
- estimated audio-video alignment uncertainty.

## 7.4 Left-handed coverage

Immediately add mirrored hermetic fixtures.

Later add real left-handed footage.

Mirroring is sufficient for coordinate/invariant testing, not for full visual-domain validation.

## 7.5 Future dataset expansion

Prioritize diversity in:

- golfer size,
- club type,
- dark/light club heads,
- camera distance,
- foliage,
- indoor simulator,
- turf,
- sunlight,
- shadows,
- portrait/landscape crops,
- 30/60/120/240 fps sources,
- rolling shutter severity,
- left-handed swings.

---

# 8. Evaluation metrics

Every test must be evaluated on:

```text
raw evidence
common canonical smoother
test Default smoother
```

This prevents a visually aggressive smoother from hiding weak tracking.

## 8.1 Accuracy

- median normalized point error
- P90 point error
- max single-frame error
- backswing error
- downswing error
- impact-region spatial error
- visible-frame recall
- blur-streak corridor intersection accuracy

## 8.2 Reliability

- false-excursion rate
- longest inferred gap
- number of unjustified discontinuities
- observed/mixed/inferred fraction
- expert-disagreement rate
- catastrophic-track failure count

## 8.3 Events

For address, top, impact:

- normalized 60 fps frame error
- milliseconds
- source-observation interval error

Impact receives the highest penalty.

## 8.4 Visual trajectory quality

- integrated squared curvature
- max curvature spike
- acceleration smoothness
- jerk
- tangent discontinuity
- within-phase velocity reversal count
- deviation from high-confidence observations
- bridge confidence at top

## 8.5 Confidence calibration

Bucket final predictions by confidence and compare against actual error.

Track separately:

- observed states,
- mixed states,
- inferred states.

An inferred point must not look as statistically certain as a directly observed crisp head.

## 8.6 Hard failure gates

A solution fails a fixture if any occur:

- obvious off-path spike,
- visible jagged trace,
- trace rendered after impact in DTL mode,
- incorrect blue/green transition,
- large unexplained gap outside the top exception,
- impact endpoint clearly outside plausible impact region,
- normalized coordinate outside `[0,1]`,
- invalid event ordering,
- incorrect handedness mirror behavior.

## 8.7 Suggested aggregate score

| Component | Weight |
|---|---:|
| Downswing tracking accuracy | 25% |
| Impact timing + endpoint accuracy | 20% |
| Backswing tracking accuracy | 15% |
| False-excursion rejection | 15% |
| Visual path quality | 10% |
| Address + top timing | 10% |
| Confidence calibration | 5% |

Hard failures override the weighted score.

---

# 9. Shared test interface

```python
class ClubTrackingTest(Protocol):
    id: str
    label: str
    version: str

    def run(self, ctx: ClubTrackingContext) -> ClubTrackingResult:
        ...
```

Registry:

```python
TESTS = {
    "t1_candidate_graph": CandidateGraphTracker,
    "t2_temporal_heatmap": TemporalHeatmapTracker,
    "t3_point_tracking": PointTrackingTracker,
    "t4_video_segmentation": VideoSegmentationTracker,
    "t5_blur_flow": BlurFlowTracker,
    "t6_grip_kinematic": GripKinematicTracker,
    "t7_claude_adjudicated": ClaudeAdjudicatedTracker,
    "t8_phase_fusion": PhaseAdaptiveFusionTracker,
    "t9_forensic_fusion": ForensicFusionTracker,
    "t10_physics_conic": PhysicsConicTracker,
    "t11_temporal_densification": TemporalDensificationTracker,
    "t12_av_impact": AudioVisualImpactTracker,
}
```

Tests remain isolated modules.

Shared expert adapters are allowed so hybrid tests do not duplicate code.

---

# 10. Test 1: Global Candidate Graph

## Thesis

Generate many plausible club-head candidates and solve the whole swing with dynamic programming / graph optimization instead of taking the top per-frame detector output.

## Mechanism

Candidate generators:

- current/fine-tuned detector,
- P2/stride-4 small-object detector head,
- keypoint detector,
- high-resolution ROI detector,
- SAHI-style crop/slicing candidate generation,
- local high-motion blobs,
- weak grip-relative prediction.

Keep a low detection threshold.

Build candidate-node features:

- appearance confidence,
- local motion,
- grip distance,
- grip angle,
- phase consistency,
- path prediction residual,
- silhouette/background relation.

Create temporal edges across distinct source observations.

Edge costs:

```text
position jump
+ velocity change
+ acceleration change
+ phase-direction violation
+ projected-radius change
+ candidate confidence penalty
```

Allow skip edges through missing observations.

Solve with:

- Viterbi,
- shortest path,
- or beam-search dynamic programming.

Fit the selected sequence globally.

## Goal coverage

| Goal | Coverage |
|---|---|
| 1 | Strong |
| 2 | Strong |
| 3 | Strong |
| 4 | Strong |
| 5 | Strong |
| 6 | Strong |
| 7 | Strong |
| 8 | Moderate/strong |

## Files

```text
club_tracking/candidates.py
club_tracking/graph.py
club_tracking/tests/test1_candidate_graph.py
```

## LLM

None.

## Training

Can begin with existing detector.

Recommended later detector training:

- club-head point/keypoint labels,
- hard negatives,
- P2 output head,
- high-resolution crops.

## Processing

Roughly 1.5 to 4 minutes/swing depending on detector resolution and slicing.

## Effort

5 to 9 engineer-days.

## Reversibility

Remove Test 1 module/registry entry. Shared candidate utilities remain if used elsewhere.

## Main failure mode

The correct club head must appear in the candidate graph frequently enough.

---

# 11. Test 2: Club-Specific Temporal Heatmap

## Thesis

Train specifically for the club-head problem using consecutive distinct observations, heatmaps, motion direction, and visibility/occlusion prediction.

## Mechanism

Input window:

```text
t-2, t-1, t, t+1, t+2
```

or another 3 to 7 distinct-observation sequence.

Do not fill the temporal stack with duplicated CFR frames.

Suggested outputs:

- club-head heatmap,
- visibility probability,
- signed motion vector,
- uncertainty,
- optional auxiliary motion-attention map.

Architecture:

```text
shared image encoder
-> temporal fusion
-> heatmap head
-> residual refinement
-> visibility head
-> motion-direction head
```

Training augmentations:

- 1 to 5 observation occlusion,
- synthetic blur,
- random low contrast,
- foliage/turf hard backgrounds,
- compression,
- frame skip,
- duplicated-frame simulation,
- left/right mirror,
- crop jitter.

Inference keeps probability structure, not only argmax:

- primary peak,
- secondary peaks,
- entropy,
- covariance.

## Goal coverage

| Goal | Coverage |
|---|---|
| 1 | Very strong if trained well |
| 2 | Strong |
| 3 | Strong |
| 4 | Strong |
| 5 | Very strong |
| 6 | Strong |
| 7 | Strong |
| 8 | Strong |

## Files

```text
models/club_temporal/
club_tracking/experts/temporal.py
club_tracking/tests/test2_temporal_heatmap.py
scripts/train_club_temporal.py
```

## LLM

None.

## Training

Initial meaningful experiment:

- several thousand manually checked temporal labels,
- multiple golfers/backgrounds,
- held-out golfers.

Do not train and test only on the nine committed fixtures.

## Processing

1 to 4 minutes/swing.

## Effort

8 to 15 engineer-days plus annotation.

## Reversibility

Remove model, weights, trainer, adapter, registry entry.

## Main failure mode

Domain generalization and insufficient difficult-impact labels.

---

# 12. Test 3: Modern Point Tracking

## Thesis

Track the same physical club-head query through time using pretrained Tracking-Any-Point models rather than redetecting every frame.

## Models to benchmark

Behind one adapter:

- CoTracker3
- LocoTrack
- TAPIR
- TAPNext++ if practical
- BootsTAP optionally

## Mechanism

Seed from multiple reliable frames:

- address,
- mid-backswing,
- near top,
- late downswing if visible.

Track:

- center query,
- several support points around the head.

Run:

- forward,
- backward,
- multi-seed.

Compare tracklets.

When a track loses confidence:

- terminate,
- reinitialize from another reliable observation,
- globally join tracklets.

## Goal coverage

| Goal | Coverage |
|---|---|
| 1 | Strong outside severe blur |
| 2 | Moderate/strong |
| 3 | Strong |
| 4 | Strong |
| 5 | Strong |
| 6 | Strong |
| 7 | Moderate/strong |
| 8 | Moderate |

## Files

```text
club_tracking/point_trackers/
club_tracking/tests/test3_point_tracking.py
```

## LLM

None.

## Training

Zero-shot initial evaluation.

## Processing

2 to 8 minutes/swing depending on model.

## Effort

5 to 10 engineer-days.

## Reversibility

Remove adapters/weights and Test 3 registry entry.

## Main failure mode

The head becomes too small, blurred, or appearance-unstable for point correspondence.

---

# 13. Test 4: Video Object Segmentation

## Thesis

Track a temporally propagated club-head mask, using mask stability rather than only boxes/points.

## Candidate frameworks

- SAM 2 / SAM 2.1
- SAM2Long-style memory management
- DEVA-style decoupled segmentation/propagation

## Mechanism

Initialize on one or more clear frames.

Propagate:

- forward,
- backward,
- multiple hypotheses when needed.

Per-frame evidence:

- mask centroid,
- mask area,
- eccentricity,
- objectness,
- IoU prediction,
- distance from grip,
- motion consistency.

Add a Kalman/trajectory prediction to help reposition the search when motion is fast.

Terminate a propagation branch when the mask:

- explodes in area,
- attaches to the golfer,
- attaches to turf/background,
- becomes inconsistent with the swing corridor.

## Goal coverage

| Goal | Coverage |
|---|---|
| 1 | Moderate |
| 2 | Moderate |
| 3 | Strong on stable masks |
| 4 | Strong |
| 5 | Strong conceptually |
| 6 | Strong |
| 7 | Moderate |
| 8 | Weak/moderate in severe blur |

## Files

```text
club_tracking/video_segmentation/
club_tracking/tests/test4_video_segmentation.py
```

## LLM

None.

## Training

Zero-shot initial test.

## Processing

3 to 10 minutes/swing.

## Effort

5 to 9 engineer-days.

## Reversibility

Remove dependency, weights, module, registry entry.

## Main failure mode

Small blurred club head is below stable mask granularity.

---

# 14. Test 5: Blur + SEA-RAFT + Deblatting

## Thesis

Treat high-speed motion as a motion-estimation problem, not merely a failed detector problem.

## Mechanism

### Detect hard interval

Use:

- coarse club path,
- grip velocity,
- optical-flow magnitude,
- event prior.

### Compensate camera motion

Estimate global background flow outside the golfer silhouette.

Separate camera motion from local club motion.

### SEA-RAFT

Run SEA-RAFT or the strongest compatible flow model on phase-guided ROIs.

Use flow to:

- advect previous head hypotheses,
- gate detector candidates,
- generate motion corridors,
- estimate local direction.

### Blur evidence

Find elongated residual/motion structures consistent with:

- expected downswing direction,
- expected club corridor,
- grip geometry.

### Deblatting

For severe frames, estimate an intra-frame segment/corridor instead of a point.

Use a practical staged implementation:

1. streak candidate extraction,
2. robust line/curve fit,
3. optional fuller deblatting inverse model on only the hardest frames.

### Final fit

Constrain a continuous trajectory with:

- crisp points,
- optical-flow vectors,
- blur segments,
- impact-region likelihood.

## Goal coverage

| Goal | Coverage |
|---|---|
| 1 | Strong in fast interval |
| 2 | Strong for impact |
| 3 | Strong |
| 4 | Strong |
| 5 | Very strong |
| 6 | Very strong |
| 7 | Moderate |
| 8 | Very strong |

## Files

```text
club_tracking/experts/sea_raft.py
club_tracking/experts/deblat.py
club_tracking/tests/test5_blur_flow.py
```

## LLM

None.

## Training

Pretrained flow plus deterministic blur logic initially.

## Processing

2 to 8 minutes/swing.

## Effort

8 to 14 engineer-days.

## Reversibility

Remove flow/deblatting Test 5 integration. Expert modules may remain for fusion tests.

## Main failure mode

Turf/shaft/body motion can produce similar streaks.

---

# 15. Test 6: Grip-Centered Kinematic Reconstruction

## Thesis

Use reliable pose/grip motion as a geometric prior when visual club-head evidence disappears.

## Mechanism

For visible head observations:

```text
r(t) = club_head(t) - grip_center(t)
```

Represent the relative state in polar form:

```text
projected_radius(t)
angle(t)
angular_velocity(t)
```

Fit phase-aware dynamics.

Use visual observations as anchors.

Between anchors infer the head from:

- grip path,
- angular motion,
- smooth projected-radius changes,
- phase direction.

### Critical correction

Do not impose a constant 2D grip-to-head radius.

Use:

```text
soft slowly varying projected-radius prior
```

because perspective and club orientation change projected length.

## Goal coverage

| Goal | Coverage |
|---|---|
| 1 | Moderate |
| 2 | Strong for address/top |
| 3 | Very strong continuity |
| 4 | Strong |
| 5 | Strong |
| 6 | Very strong |
| 7 | Strong |
| 8 | Strong fallback |

## Files

```text
club_tracking/experts/kinematic.py
club_tracking/tests/test6_grip_kinematic.py
```

## LLM

None.

## Training

None initially.

Optional later learned pose-to-club-offset model.

## Processing

10 to 30 seconds beyond pose.

## Effort

4 to 7 engineer-days.

## Reversibility

Remove kinematic expert and Test 6 adapter.

## Main failure mode

2D pose cannot uniquely determine an out-of-plane club.

---

# 16. Test 7: Claude Bounded Adjudication

## Thesis

Use Claude only to adjudicate among deterministic candidate solutions when ambiguity is high.

Do not ask Claude to densely localize the club head frame-by-frame.

## Mechanism

Run deterministic candidate methods first.

Trigger AI only if:

- two path hypotheses are close in score,
- top is ambiguous,
- impact hypotheses disagree,
- an apparent excursion cannot be rejected confidently.

Build a compact diagnostic input:

- 5 to 12 selected crops,
- candidate overlays,
- structured candidate metrics,
- known grip points,
- high-confidence anchors.

Prompt goal:

```text
choose candidate A/B/C or none
```

not:

```text
invent precise coordinates
```

## Output schema

```json
{
  "decision": "candidate_b",
  "confidence": 0.82,
  "reasonCode": "motion_consistent",
  "topAdjustmentFrames": 0,
  "impactAdjustmentFrames": 1
}
```

Enums only.

## Provider requirements

Implement:

```text
complete({
  promptId,
  variables,
  images?,
  maxTokens?
}) -> {
  json,
  raw,
  provider,
  ms
}
```

Local:

```text
claude -p --output-format json
```

Requirements:

- versioned prompt,
- JSON Schema,
- temperature 0 where provider permits,
- one validation retry,
- deterministic fallback,
- timeout,
- serialized queue,
- disk cache,
- AI-disabled end-to-end path.

## LLM budget

Target:

- 0 calls on easy swings,
- 1 call on typical ambiguous swings,
- 2 maximum.

Do not depend on a hardcoded image-token estimate. Log real request/usage information available from the provider and keep crops bounded.

## Goal coverage

| Goal | Coverage |
|---|---|
| 1 | Moderate/strong on ambiguity |
| 2 | Strong as adjudicator |
| 3 | Indirect |
| 4 | Strong |
| 5 | Moderate |
| 6 | Strong after deterministic fit |
| 7 | Strong |
| 8 | Moderate/strong |

## Files

```text
ai/providers/base.py
ai/providers/claude_cli.py
ai/cache.py
ai/prompts/club_adjudication_v1.py
club_tracking/tests/test7_claude_adjudicated.py
```

## Training

None.

## Processing

AI call only when triggered.

## Effort

5 to 8 engineer-days.

## Reversibility

Remove provider/prompt/Test 7. Deterministic fallback remains.

## Main failure mode

VLM confidence can exceed visual precision on tiny/blurred objects.

---

# 17. Test 8: Phase-Adaptive Multi-Tracker Fusion

## Thesis

Fuse independent experts and change their reliability weighting by swing phase.

## Experts

- candidate graph / detector
- temporal heatmap
- point tracker
- segmentation where useful
- SEA-RAFT
- deblatting
- grip kinematics

## Phase weighting

### Address / early backswing

High:

- detector/keypoint
- temporal heatmap
- point tracker

Medium:

- kinematics

### Top

High:

- temporal heatmap
- point tracker
- grip kinematics

Use disagreement strongly.

### Downswing

Increase:

- temporal heatmap
- SEA-RAFT
- blur evidence
- kinematics

### Impact

Highest:

- deblatting/streak support
- continuous velocity model
- impact reference region
- grip geometry

Detector confidence receives less authority if blur is severe.

## Fusion objective

```text
sum expert likelihoods
+ calibrated expert reliability
+ robust outlier loss
+ acceleration penalty
+ jerk penalty
+ phase direction
+ soft grip-radius prior
+ local impact conic prior
+ event likelihoods
```

## Expert calibration

Measure every expert's:

```text
reported confidence -> observed error
```

per phase.

Use empirical reliability, not simple arithmetic averaging.

## Goal coverage

All goals: very strong.

## Files

```text
club_tracking/experts/
club_tracking/fusion.py
club_tracking/tests/test8_phase_fusion.py
```

## LLM

None.

## Training

Best version benefits from Test 2 weights but can run with zero-shot experts first.

## Processing

3 to 10 minutes/swing.

## Effort

6 to 10 engineer-days after experts exist.

## Reversibility

Delete fusion orchestrator and Test 8 registry entry. Experts remain independently runnable.

## Main failure mode

Miscalibrated experts can create false consensus.

---

# 18. Test 9: Coarse-to-Fine Source-Time Forensic Fusion

## Thesis

Use the existing analysis pass to locate the problem, then return to original source resolution/timing and solve the club head inside a focused high-resolution corridor.

## Pass 1: Coarse understanding

On current analysis representation:

- pose,
- grip,
- coarse club candidates,
- rough events,
- uncertainty corridor.

## Pass 2: Original source frames

Extract source-quality ROIs around the predicted club corridor.

ROI width expands with uncertainty.

Do not use the 720p whole frame if the source contains materially more useful club-head pixels.

## Pass 3: Specialist experts

Within the ROI run:

- temporal heatmap,
- high-res detector/keypoint,
- point tracker,
- SEA-RAFT,
- deblatting,
- kinematics.

## Pass 4: Solve in source time

Fit:

```text
p(t)
```

to genuine source observations.

Duplicated normalized frames do not receive duplicate evidence weight.

## Pass 5: Sample at 60 fps

After finalization:

```text
p(n / 60)
```

produces the player's exact trajectory samples.

## Goal coverage

All goals: very strong.

## Files

```text
club_tracking/source_timing.py
club_tracking/roi.py
club_tracking/forensic.py
club_tracking/tests/test9_forensic_fusion.py
```

## LLM

None.

## Training

No additional labels beyond shared data. Strongest version uses Test 2.

## Processing

4 to 15 minutes/swing during evaluation.

## Effort

10 to 18 engineer-days after shared components exist.

## Reversibility

Remove forensic orchestrator and source-ROI path. Source timing metadata should remain because it is independently useful.

## Main failure mode

A coarse corridor that is too narrow can crop out the true head. ROI must widen automatically as uncertainty rises.

---

# 19. Test 10: Physics-Constrained Conic / Factor-Graph Optimization

## Why this is a new test

The earlier plan used physics-like constraints inside shared smoothers and fusion systems, but did not isolate them as their own experimental methodology.

This test answers a specific question:

> How much of the problem can be solved by better mathematics over ordinary noisy candidates, without a better visual sensor?

## Thesis

Take a deliberately ordinary candidate source and solve the trajectory with a robust factor graph containing phase-aware physics/geometric priors.

## Sensor input

Use one fixed baseline candidate source so the experiment remains interpretable:

```text
low-threshold detector/keypoint candidates
+ existing pose/grip
```

Do not quietly add the temporal net or point tracker.

## State

At source time `t`:

```text
x(t)
y(t)
vx(t)
vy(t)
ax(t)
ay(t)
```

Optional latent variables:

```text
top time
impact time
local conic parameters near impact
projected grip-radius trend
```

## Factors

### Measurement factor

Confidence-weighted robust residual from observed candidates.

Use Huber, Cauchy, or Tukey-style robust loss.

### Motion factor

Penalize implausible acceleration/jerk.

### Grip-radius factor

Softly penalize rapid unexplained change in:

```text
|club_head - grip_center|
```

Do not enforce constancy.

### Local conic factor

Only in a configured lower-downswing / impact window, softly penalize distance from a fitted ellipse/conic.

Do not force the top/backswing onto the same ellipse.

### Phase-direction factor

Backswing and downswing should have internally coherent time direction.

### Event factor

Tie:

- address to sustained departure,
- top to direction reversal,
- impact to impact-region crossing.

### Missing observation handling

Allow latent trajectory states with no direct measurement.

## Solvers

Prototype both:

1. SciPy least-squares / sparse nonlinear optimization
2. custom RTS/state-space approximation

If useful, later use a dedicated factor-graph library, but avoid adding one before the experiment proves a need.

## Goal coverage

| Goal | Coverage |
|---|---|
| 1 | Strong if candidates contain enough truth |
| 2 | Very strong |
| 3 | Very strong |
| 4 | Strong |
| 5 | Strong |
| 6 | Very strong |
| 7 | Very strong |
| 8 | Very strong |

## Files

```text
club_tracking/physics_fit.py
club_tracking/conic.py
club_tracking/tests/test10_physics_conic.py
```

## LLM

None.

## Data/training

None.

Needs labeled evaluation trajectories/events.

## Processing

Approximately +2 to 10 seconds once baseline candidates exist.

## Effort

4 to 8 engineer-days.

## Reversibility

Delete Test 10 adapter and conic-specific factors. Generic optimizer may remain if used by other tests.

## Main failure modes

- correct candidate never appears,
- overly strong conic prior bends a real 2D projection toward the model,
- projected grip radius varies more than expected.

## Required ablation

Run:

```text
motion only
motion + grip
motion + local conic
motion + grip + local conic
full + event factors
```

This test is valuable only if the contribution of each prior is measurable.

---

# 20. Test 11: Synthetic Temporal Densification

## Why this is a new test

The original nine-test plan intentionally avoided pretending 30->60 CFR duplication created new evidence.

This test asks a separate experimental question:

> Can a video-frame interpolation model generate useful intermediate image hypotheses that improve downstream tracking even though those frames are synthetic?

## Thesis

Interpolate only between genuine source observations, track the densified sequence, and compare against the same tracker on real observations only.

## Candidate interpolators

Start with:

- RIFE

Optionally compare:

- a blur-aware interpolation model such as BIN/related blurry-VFI approach if a usable implementation is available.

Do not add a large generative video model to this first experiment.

## Mechanism

### Step 1

Use Stage 0 source timing to identify genuine neighboring observations.

### Step 2

Generate:

- 2x intermediate frame,
- optionally 4x for a separate ablation.

### Step 3

Run one fixed downstream tracker:

Recommended:

```text
Test 2 temporal heatmap
```

or, if Test 2 is not ready:

```text
Test 1 candidate graph detector
```

### Step 4

Mark all evidence generated from synthetic frames:

```text
mode = inferred
source = vfi
```

### Step 5

Never let synthetic observations increase confidence beyond their bounding real observations.

Suggested upper bound:

```text
synthetic_conf <= min(left_real_conf, right_real_conf)
```

with an additional interpolation-quality penalty.

### Step 6

Fit final trajectory using both real and synthetic evidence.

## Goal coverage

| Goal | Coverage |
|---|---|
| 1 | Experimental/partial |
| 2 | Moderate |
| 3 | Strong potential |
| 4 | Strong |
| 5 | Strong gap-filling potential |
| 6 | Strong |
| 7 | Moderate |
| 8 | Strong potential |

## Files

```text
club_tracking/vfi.py
club_tracking/tests/test11_temporal_densification.py
```

## LLM

None.

## Training

Zero-shot using pretrained VFI.

## Processing

Approximately +45 seconds to +3 minutes/swing depending on factor, resolution, and GPU.

Benchmark actual GTX 1080 behavior.

## Effort

4 to 8 engineer-days.

## Reversibility

Delete VFI module, model weights, registry entry.

## Main failure mode

Interpolation may hallucinate:

- a warped club,
- duplicate heads,
- smeared head placement,
- incorrect occlusion transition.

This is precisely why the test must compare against the identical downstream tracker without VFI.

## Acceptance rule

Keep VFI only if it improves **real-frame trajectory accuracy or event accuracy**.

Do not keep it merely because the interpolated video looks smoother.

---

# 21. Test 12: Audio-Visual Impact Anchor + Endpoint Reconstruction

## Why this is a new test

Impact is one of the highest-priority product events and directly controls:

- downswing endpoint,
- scrub boundary,
- trajectory gap-fill,
- metrics downstream.

The original nine-test plan treated audio as optional shared research. The independent research makes it important enough to isolate and measure.

## Thesis

Estimate a probabilistic impact timestamp from synchronized audio plus visual cues, then constrain the final downswing trajectory to that event.

The test changes the event/trajectory boundary rather than the primary club-head sensor.

## Inputs

### Audio

From original upload or preserved normalized audio:

- waveform,
- sample rate,
- timestamps.

### Visual

- final club-head trajectory candidate,
- address club-head reference region,
- grip path,
- optional ball ROI,
- optical flow / frame difference near the ball.

## Audio detector

Initial non-ML implementation:

1. band-pass or spectral high-frequency emphasis,
2. short-time energy/onset strength,
3. transient peak detection,
4. reject long-duration noise,
5. search only inside a visual downswing impact window.

Later, if needed, train a compact audio-event classifier.

## A/V synchronization handling

Do not assume the acoustic peak equals geometric contact with zero offset.

Model:

```text
observed_audio_time
=
impact_time
+ microphone_propagation_delay
+ mux/device_sync_offset
+ noise
```

For phone recordings where microphone position is near the camera:

- propagation delay is usually small but not zero,
- A/V sync still needs validation.

Estimate a conservative timing uncertainty.

## Visual cues

Combine:

- trajectory crossing the address/impact corridor,
- club-head speed,
- grip motion,
- ball departure,
- blur segment,
- current event model.

## Ball departure

Optional:

- tiny ROI around address ball,
- frame differencing,
- SEA-RAFT/local flow,
- departure confidence.

No ball detection is required for the test to function.

## Fusion

Construct an impact-time likelihood:

```text
P(t_impact)
proportional to
P(audio | t)
* P(trajectory_crossing | t)
* P(ball_departure | t)
* P(existing_event_prior | t)
```

Use log-likelihoods/normalized scores in implementation.

## Endpoint reconstruction

Once final impact time is selected:

1. solve the continuous downswing trajectory,
2. sample at impact time,
3. write the final green endpoint,
4. mark observed/mixed/inferred status,
5. map to the nearest normalized 60 fps frame for legacy event publication,
6. optionally retain fractional impact time in the new extension.

## Goal coverage

| Goal | Coverage |
|---|---|
| 1 | Indirect |
| 2 | Very strong, especially impact |
| 3 | Strong by fixing correct endpoint |
| 4 | Strong |
| 5 | Strong |
| 6 | Strong |
| 7 | Very strong |
| 8 | Very strong |

## Files

```text
club_tracking/audio_impact.py
club_tracking/ball_departure.py
club_tracking/tests/test12_av_impact.py
```

## LLM

None.

## Training

None initially.

Optional small classifier only if deterministic transient detection is unreliable.

## Processing

1 to 5 seconds/swing beyond the underlying visual track.

## Effort

3 to 6 engineer-days.

## Reversibility

Delete audio/ball event modules and Test 12 registry entry.

## Main failure modes

- no audio,
- muted upload,
- poor A/V synchronization,
- nearby golfers striking balls,
- echo,
- no visible ball departure.

## Required fallback

If audio is unavailable or ambiguous:

```text
audio contribution = zero
```

and the visual event estimator remains fully functional.

---

# 22. Smoothing and path-fit registry

All smoothing/path variants must be computed in the analyzer and persisted.

The browser does not run these algorithms.

The Debug Menu switches precomputed variants instantly.

## 22.1 Why the default is not Catmull-Rom

Centripetal Catmull-Rom has excellent geometric behavior and is worth testing.

However, it interpolates its control points.

If those points contain tracking error, the curve faithfully passes through that error.

The default should therefore remain a **confidence-weighted robust approximating fit**, not an interpolating display spline.

Centripetal Catmull-Rom becomes a new explicit option.

## 22.2 Standardized options

Every test exports:

```text
Default
A
B
C
D
E
F
G
H
I
```

### Default — Test-recommended robust global fit

The test's recommended production trajectory.

For most tests this should be:

```text
confidence-weighted robust cubic B-spline
+ outlier rejection
+ curvature/acceleration regularization
+ phase/event constraints
```

For Test 10, the Default may be its factor-graph solution.

For Test 9, the Default operates in source time before 60 fps resampling.

### Smoothing A — Light robust B-spline

Low regularization.

Highest measured-point fidelity among the approximating fits.

Useful to expose whether the tracker itself is accurate.

### Smoothing B — Strong robust B-spline

Higher curvature/second-derivative penalty.

More broadcast-polished.

Higher risk of visually flattening a real local motion feature.

### Smoothing C — Kalman / RTS constant-acceleration smoother

Offline forward/backward state-space smoothing.

Strong physical temporal consistency.

Process/measurement noise derives from confidence.

### Smoothing D — Phase-specific cubic Hermite

Fit backswing and downswing separately with derivative/tangent control.

Join continuously at top when bridge confidence is sufficient.

Useful when the two phases need different local geometry.

### Smoothing E — Minimum-jerk trajectory

Minimize integrated jerk subject to high-confidence anchor/corridor constraints.

Very visually stable.

Can sacrifice local measured detail.

### Smoothing F — Schneider-style piecewise cubic Bézier fit

Fit a small number of cubic Bézier segments within an error tolerance.

Designed to test the cleanest TV/broadcast-style geometry.

Do not let low segment count override hard fidelity limits.

### Smoothing G — Centripetal Catmull-Rom, alpha = 0.5 **[NEW]**

Pass through confidence-filtered control points using centripetal parameterization.

Advantages:

- locally controlled,
- visually smooth,
- avoids the cusp/self-intersection behavior possible with other Catmull-Rom parameterizations within a segment,
- excellent when the control points are already clean.

Tradeoff:

- interpolates control points,
- therefore cannot hide a bad retained measurement.

### Smoothing H — Whittaker-Henderson / Penalized B-Spline **[NEW]**

Fit x(t) and y(t) with a weighted penalized least-squares spline.

Objective conceptually:

```text
weighted measurement residual
+ lambda * discrete derivative penalty
```

Select `lambda` automatically using:

- GCV,
- or a constrained validation rule tuned on labeled fixtures.

Advantages:

- handles uneven/noisy measurements,
- confidence weights fit naturally,
- produces a highly controllable smoothness/fidelity continuum.

Tradeoff:

- independently smoothing x/y can slightly distort arc-length behavior if poorly parameterized.

Use source time or arc-length-aware parameterization.

### Smoothing I — Savitzky-Golay Pre-filter + Centripetal Catmull-Rom **[NEW]**

First apply a short-window Savitzky-Golay polynomial filter to the time-series coordinates/velocity on genuine source observations.

Then construct a centripetal Catmull-Rom path through the filtered anchors.

Purpose:

- suppress high-frequency detector jitter,
- preserve local extrema/curvature better than a simple moving average,
- retain the visually attractive local Catmull-Rom path.

Tradeoff:

- window choice matters,
- not suitable across missing intervals without first handling gaps,
- apply separately by phase or by continuous valid segment.

## 22.3 Techniques not promoted to the main menu

### Chordal Catmull-Rom

Not added as a separate main option.

Centripetal Catmull-Rom has the more useful safety properties for this application.

### PCHIP

Not added as a primary 2D swing-path option.

PCHIP is shape-preserving for scalar monotonic interpolation, but a golf swing trajectory is a looping 2D parametric curve where neither x(t) nor y(t) is globally monotonic.

It may remain a debug experiment if desired, but it is not one of the three added production candidates.

---

# 23. Trace-quality gate

Every final variant receives a shared quality assessment.

## Metrics

- max local curvature spike
- integrated squared curvature
- max jerk
- tangent discontinuity
- within-phase velocity reversal count
- distance from high-confidence observations
- maximum inferred bridge
- expert disagreement
- impact-region miss
- top bridge confidence

## Decisions

```json
{
  "trackingConfidence": 0.82,
  "visualQuality": 0.96,
  "publishMode": "continuous"
}
```

or:

```json
{
  "trackingConfidence": 0.58,
  "visualQuality": 0.90,
  "publishMode": "split_at_top"
}
```

or:

```json
{
  "trackingConfidence": 0.29,
  "visualQuality": 0.30,
  "publishMode": "fallback",
  "fallbackVariant": "h"
}
```

A quality gate may:

- select another precomputed smoothing,
- choose top split,
- suppress an obviously invalid candidate.

It must not turn a fundamentally wrong raw track into a "high-confidence" result just because the curve is smooth.

---

# 24. Event refinement

## 24.1 Address / backswing start

Establish a stable pre-swing baseline using:

- grip center,
- club-head candidates,
- body movement.

Start backswing at the first sustained departure.

Require persistence across genuine source observations so:

- waggle,
- one-frame noise,
- handheld shake

does not trigger address departure.

## 24.2 Top / downswing start

Use joint evidence:

- club trajectory derivative,
- grip/hand derivative,
- existing event model,
- point/heatmap confidence.

Top is a direction transition, not merely the highest y-coordinate.

## 24.3 Impact

Create a probability distribution over impact time from available cues.

Core visual cues:

- downswing trajectory crossing impact corridor,
- address-region proximity,
- velocity evolution,
- grip state,
- existing event prior,
- blur path.

Optional:

- audio transient,
- ball departure.

## 24.4 Fractional event time

Add new optional fields:

```json
{
  "impact": {
    "frame": 161,
    "timeSeconds": 2.6833,
    "fractionalFrame": 161.21,
    "confidence": 0.91,
    "mode": "mixed"
  }
}
```

The existing integer GolfDB event remains intact.

The fractional timing is append-only and can improve trajectory reconstruction.

---

# 25. Proposed analysis.json extension

```json
{
  "clubTracking": {
    "schemaVersion": 2,
    "sourceTiming": {
      "nominalFps": 29.97,
      "distinctObservationCount": 94,
      "hasAudio": true
    },
    "experiments": {
      "t8_phase_fusion": {
        "test": {
          "id": "t8_phase_fusion",
          "label": "Phase-Adaptive Evidence Fusion",
          "version": "1.0.0"
        },
        "models": {
          "detector": "club-keypoint-p2-v1",
          "temporal": "club-temporal-v1",
          "point": "cotracker3",
          "flow": "sea-raft"
        },
        "events": {
          "address": {
            "frame": 83,
            "timeSeconds": 1.3833,
            "confidence": 0.95
          },
          "top": {
            "frame": 141,
            "timeSeconds": 2.3500,
            "confidence": 0.88
          },
          "impact": {
            "frame": 161,
            "timeSeconds": 2.6833,
            "fractionalFrame": 161.2,
            "confidence": 0.91,
            "mode": "mixed"
          }
        },
        "trace": {
          "displayMode": "continuous",
          "phaseSpans": {
            "backswing": {
              "startFrame": 83,
              "endFrame": 141,
              "colorRole": "backswing"
            },
            "downswing": {
              "startFrame": 141,
              "endFrame": 161,
              "colorRole": "downswing"
            }
          },
          "variants": {
            "default": {
              "frames": [
                {
                  "frame": 83,
                  "x": 0.612,
                  "y": 0.742,
                  "confidence": 0.94,
                  "mode": "observed"
                }
              ]
            },
            "a": {"frames": []},
            "b": {"frames": []},
            "c": {"frames": []},
            "d": {"frames": []},
            "e": {"frames": []},
            "f": {"frames": []},
            "g": {"frames": []},
            "h": {"frames": []},
            "i": {"frames": []}
          }
        },
        "diagnostics": {
          "expertAgreement": 0.86,
          "maxObservedResidual": 0.012,
          "longestInferredGapMs": 49.8,
          "topBridgeConfidence": 0.77,
          "visualQuality": 0.94
        }
      }
    }
  }
}
```

Do not store giant raw heatmaps in `analysis.json`.

Keep bulky diagnostics in analyzer debug artifacts.

---

# 26. Debug artifacts

For every test:

```text
out/<stem>/debug/club/<test-id>/
  raw_candidates.json
  raw_observations.json
  events.json
  trace_quality.json
  overlay_raw.mp4
  overlay_default.mp4
  impact_window.mp4
```

Hybrid tests additionally:

```text
expert_detector.mp4
expert_temporal.mp4
expert_point.mp4
expert_segmentation.mp4
expert_flow.mp4
expert_deblat.mp4
expert_kinematic.mp4
expert_agreement.json
```

Test 12:

```text
impact_audio.wav
impact_audio_score.json
ball_departure_debug.mp4
impact_likelihood.json
```

Test 11:

```text
vfi_comparison.mp4
synthetic_frame_scores.json
```

---

# 27. Debug Menu

## Test radio group

```text
Tracking Test

( ) Test 1  Candidate Graph
( ) Test 2  Temporal Heatmap
( ) Test 3  Point Tracking
( ) Test 4  Video Segmentation
( ) Test 5  Blur / SEA-RAFT / Deblatting
( ) Test 6  Grip Kinematic
( ) Test 7  Claude Adjudication
( ) Test 8  Phase-Adaptive Fusion
( ) Test 9  Forensic Fusion
( ) Test 10 Physics / Conic
( ) Test 11 Temporal Densification
( ) Test 12 Audio-Visual Impact
```

## Smoothing/path-fit radio group

```text
Path Fit

( ) Default
( ) A  Light robust B-spline
( ) B  Strong robust B-spline
( ) C  RTS
( ) D  Phase Hermite
( ) E  Minimum jerk
( ) F  Bézier
( ) G  Centripetal Catmull-Rom
( ) H  Penalized P-spline
( ) I  SG + Catmull-Rom
```

---

# 28. Instant switching versus re-analysis

## Smoothing

No re-analysis.

Every completed test writes all Default + A-I variants.

Switching path fit:

```text
radio change
-> select artifact variant
-> redraw
```

## Test

If the test solution already exists in `analysis.json`:

```text
radio change
-> select experiment
-> redraw
```

If it does not exist:

```text
radio change
-> safe reanalysis request
-> run test
-> atomically merge new experiment result
-> reload artifact
-> select result
```

Do not recompute an already cached test unless the user explicitly presses re-run.

---

# 29. Secure re-analysis transport

The browser must never supply arbitrary command text.

## 29.1 TypeScript enum

```ts
const TRACKING_TEST_IDS = [
  "t1_candidate_graph",
  "t2_temporal_heatmap",
  "t3_point_tracking",
  "t4_video_segmentation",
  "t5_blur_flow",
  "t6_grip_kinematic",
  "t7_claude_adjudicated",
  "t8_phase_fusion",
  "t9_forensic_fusion",
  "t10_physics_conic",
  "t11_temporal_densification",
  "t12_av_impact",
] as const;
```

Request:

```json
{
  "testId": "t10_physics_conic"
}
```

Do not send smoothing. It is precomputed.

## 29.2 Validate

Use a fixed schema/enum.

Unknown values return 400.

## 29.3 Persist job option

Store validated enum in a dedicated typed DB/job field.

Do not place raw request text into a command string.

## 29.4 Server-side mapping

```ts
const TEST_ARGS: Record<TrackingTestId, string> = {
  t1_candidate_graph: "t1_candidate_graph",
  t2_temporal_heatmap: "t2_temporal_heatmap",
  t3_point_tracking: "t3_point_tracking",
  t4_video_segmentation: "t4_video_segmentation",
  t5_blur_flow: "t5_blur_flow",
  t6_grip_kinematic: "t6_grip_kinematic",
  t7_claude_adjudicated: "t7_claude_adjudicated",
  t8_phase_fusion: "t8_phase_fusion",
  t9_forensic_fusion: "t9_forensic_fusion",
  t10_physics_conic: "t10_physics_conic",
  t11_temporal_densification: "t11_temporal_densification",
  t12_av_impact: "t12_av_impact",
};
```

## 29.5 Spawn

Use argument array and `shell: false`.

```ts
spawn(pythonExecutable, [
  "scripts/burnin.py",
  src,
  "--out",
  outputPath,
  "--view",
  validatedStoredView,
  "--handedness",
  validatedStoredHandedness,
  "--club-test",
  TEST_ARGS[testId],
], {
  shell: false,
});
```

## 29.6 Validate again in Python

```python
parser.add_argument(
    "--club-test",
    choices=list(TESTS.keys()),
)
```

Defense in depth.

## 29.7 Concurrency

Only one writer may merge experiment results into one swing artifact at a time.

Use:

- per-swing job lock,
- write temporary JSON,
- fsync/close,
- atomic rename.

Never let two tests partially overwrite the same artifact.

---

# 30. Player rendering changes

## DTL/oblique

Draw only:

```text
address -> top -> impact
```

## Phase color

```text
address -> top    blue
top -> impact     green
```

## Final per-frame marker

Read directly from selected precomputed variant:

```text
experiments[testId]
.trace
.variants[pathFitId]
.frames[currentFrame]
```

No path construction logic should be required beyond converting normalized points to canvas coordinates.

## Split transition

Artifact controls:

```text
displayMode = continuous
```

or:

```text
displayMode = split_at_top
```

Frontend does not infer the split condition.

## Rendering style

Allowed presentation behavior:

- device-pixel-ratio canvas
- round caps
- round joins
- anti-aliasing
- stable CSS-pixel width
- optional opacity/tail styling

Do not use glow/animation to hide geometric error.

If ribbon taper by speed is desired, precompute the per-frame width scalar in the analyzer so the player only scales/render values.

---

# 31. Scrub bar changes

The visible primary segments become:

| Segment | Start | End |
|---|---|---|
| Pre-swing | playback start | address |
| Backswing | address | top |
| Downswing | top | impact |
| Post-impact | impact | playback end |

Primary marks:

```text
address
top
impact
```

Detailed GolfDB events remain published and can remain visible in debug/detail views.

---

# 32. Build sequence

## Phase 0: Ground truth and shared infrastructure

Build first:

1. source-time preservation
2. audio metadata preservation
3. fixture annotation format
4. manual labels
5. mirrored handedness fixtures
6. common observations/candidates
7. common trajectory interface
8. common evaluation metrics
9. common quality gate
10. standardized Default + A-I path-fit registry
11. test registry
12. analysis.json experiment schema
13. debug menu
14. safe reanalysis enum flow
15. analyzer-side precomputed smoothing
16. bypass legacy client-side smoothing for new experiment traces

## Phase 1: Deterministic baselines

Build:

- Test 1
- Test 6
- Test 10
- common event refiner
- impact corridor

This establishes whether strong global math can solve most of the problem before adding large models.

## Phase 2: Zero-shot visual experts

Build:

- Test 3
- Test 4
- Test 5

Benchmark all on nine fixtures.

Use them to assist annotation but manually correct labels.

## Phase 3: Learned temporal model

Build Test 2.

Train on a broader labeled set.

Evaluate held-out golfers/backgrounds.

## Phase 4: Impact-specific A/V experiment

Build Test 12.

It is low-cost and may materially improve one of the most important requirements.

If audio is absent on many real uploads, retain it as optional expert evidence.

## Phase 5: Synthetic densification experiment

Build Test 11.

Run strict ablation:

```text
same tracker without VFI
vs.
2x VFI
vs.
4x VFI
```

Keep only if it improves real-frame ground-truth metrics.

## Phase 6: Claude bounded adjudication

Build Test 7 after deterministic competing hypotheses exist.

Do not spend AI calls before there is a concrete decision for Claude to make.

## Phase 7: Hybrid systems

Build Test 8.

Then build Test 9.

Test 9 depends on the strongest experts discovered earlier.

## Phase 8: Production reduction

For the winning hybrid:

1. remove experts with no measurable contribution,
2. establish confidence thresholds,
3. build cheap-first escalation,
4. freeze model versions,
5. lock regression fixtures,
6. document failure modes.

---

# 33. Mandatory ablations

A hybrid test can look good while containing unnecessary components.

Run ablations.

## Test 8

Compare:

```text
temporal only
+ detector
+ point tracker
+ SEA-RAFT
+ deblatting
+ kinematics
+ local conic prior
```

Measure marginal gain.

## Test 9

Compare:

```text
720p only
source-resolution ROI
source-time weighting
source-resolution + source-time
full forensic fusion
```

## Test 10

Compare:

```text
motion
motion + grip
motion + local conic
motion + events
all
```

## Test 11

Compare:

```text
no VFI
2x VFI
4x VFI
```

on the identical downstream tracker.

## Test 12

Compare:

```text
visual only
visual + audio
visual + ball
visual + audio + ball
```

---

# 34. Suggested pre-test ranking

This is a hypothesis to validate, not a decision.

| Rank | Test | Expected reason |
|---|---|---|
| 1 | Test 9 Forensic Fusion | Best evidence quality + source-time solving + multiple experts |
| 2 | Test 8 Phase-Adaptive Fusion | Strong reliability without source-frame second pass |
| 3 | Test 2 Temporal Heatmap | Highest ceiling among single learned visual trackers |
| 4 | Test 10 Physics/Conic | Low compute, high leverage if candidates are merely noisy rather than absent |
| 5 | Test 5 Blur/SEA-RAFT/Deblatting | Critical specialist for hardest downswing interval |
| 6 | Test 12 A/V Impact | High leverage on impact boundary and endpoint, low compute |
| 7 | Test 1 Candidate Graph | Strong deterministic candidate baseline |
| 8 | Test 6 Grip Kinematic | Strong gap fallback |
| 9 | Test 3 Point Tracking | Valuable independent evidence, vulnerable at impact |
| 10 | Test 11 Temporal Densification | Interesting but synthetic evidence may fail exactly on blur/occlusion |
| 11 | Test 7 Claude Adjudication | Useful exception handler, not preferred core measurement |
| 12 | Test 4 Segmentation | Most likely to lose tiny blurred head at impact |

A low-ranked isolated test can still be a critical expert inside Tests 8/9.

---

# 35. Production escalation architecture

The final production system should not necessarily run every expert on every swing.

Suggested architecture after experiments:

```text
source timing + pose
        |
temporal tracker + small-object detector
        |
confidence high across address->impact?
        | yes
        v
global fit + events + quality gate
        |
       done

no
|
+ point tracker
|
resolved?
| yes
v
fit + quality gate

no
|
+ SEA-RAFT / blur specialist
|
resolved?
| yes
v
fit + quality gate

no
|
+ source-resolution forensic ROI
|
resolved?
| yes
v
fit + quality gate

still ambiguous
|
optional Claude adjudication
```

Audio impact detection can run cheaply in parallel whenever audio exists.

The physics/event optimizer remains shared.

---

# 36. Acceptance criteria

Do not call the tracker production-ready until:

1. No obvious false excursion on committed fixtures.
2. No visibly jagged trace.
3. DTL/oblique trace begins at address and ends at impact.
4. Backswing is blue.
5. Downswing is green.
6. Color transition matches final top event.
7. One continuous path is the normal result.
8. Split-at-top occurs only under explicit low-confidence rule.
9. Inferred points are labeled.
10. Impact event is inside human-accepted interval for resolvable fixtures.
11. Source duplicates are not counted as independent evidence.
12. Left-handed mirrored invariant tests pass.
13. All normalized coordinates remain `[0,1]`.
14. Eight GolfDB events remain strictly ordered.
15. Playback window contains all required events.
16. Existing metrics/checkpoints/scorecard behavior does not break.
17. Same inputs + same model/algorithm versions reproduce the same artifact.
18. Quality metrics and human review agree on every obvious failure.
19. Test 11 is rejected if it improves only visual interpolation but not real-frame tracking accuracy.
20. Test 12 falls back safely when audio is missing/ambiguous.

---

# 37. Research-backed amendments from the independent pass

The independent research adds several concrete improvements to the original nine-test design.

## Adopt

- P2/stride-4 or keypoint small-object detector output.
- High-resolution/SAHI-style candidate generation.
- SEA-RAFT as the preferred optical-flow experiment.
- SAM 2 motion/Kalman assistance.
- Explicit near-impact conic/ellipse soft prior.
- Dedicated physics-only Test 10.
- Dedicated VFI Test 11.
- Dedicated audio-visual impact Test 12.
- Centripetal Catmull-Rom smoothing option.
- Penalized P-spline smoothing option.
- Savitzky-Golay + Catmull-Rom smoothing option.

## Amend rather than adopt literally

### "Duplicate collapse"

Primary method becomes original PTS preservation.

Duplicate-image detection is fallback.

### "Constant club radius"

Use a soft projected-radius prior.

Do not hard constrain 2D length.

### "Ellipse path"

Use local lower-downswing/impact prior.

Do not apply a single ellipse to the whole swing.

### "RIFE creates intermediate positions"

False as a measurement statement.

RIFE creates synthetic hypotheses.

All VFI-derived evidence is inferred and capped in confidence.

### "Audio gives exact ~1 ms impact"

Too strong without synchronization calibration.

Audio gives potentially high-resolution acoustic timing evidence with uncertainty.

### "Client can apply smoothing"

Not for the new tracker contract.

All Default + A-I variants are analyzer-generated so `analysis.json` remains directly renderable with coordinate scaling only.

### "LLM returns club-head coordinates"

Avoid as the primary design.

Claude should choose among deterministic hypotheses.

Precise coordinate localization remains CV's job.

---

# 38. Research references

## Golf swing / trajectory

1. Morrison, McGrath, Wallace. **The relationship between the golf swing plane and ball impact characteristics using trajectory ellipse fitting.** Journal of Sports Sciences.  
   https://doi.org/10.1080/02640414.2017.1303187

2. **Changes in Club Head Trajectory and Planarity Throughout the Golf Swing.** Procedia Engineering, 2014.  
   https://doi.org/10.1016/j.proeng.2014.06.083

3. McNally et al. **GolfDB: A Video Database for Golf Swing Sequencing.** CVPR Workshops 2019.  
   https://openaccess.thecvf.com/content_CVPRW_2019/html/CVSports/McNally_GolfDB_A_Video_Database_for_Golf_Swing_Sequencing_CVPRW_2019_paper.html

## Fast small-object tracking

4. Huang et al. **TrackNet: A Deep Learning Network for Tracking High-speed and Tiny Objects in Sports Applications.**  
   https://arxiv.org/abs/1907.03698

5. **TrackNetV5: Residual-Driven Spatio-Temporal Refinement and Motion Direction Decoupling for Fast Object Tracking.**  
   https://arxiv.org/abs/2512.02789

6. **TOTNet: Occlusion-aware temporal tracking for robust ball detection in sports videos.** Computer Vision and Image Understanding, 2026.  
   https://www.sciencedirect.com/science/article/pii/S107731422600024X

## Point tracking

7. Karaev et al. **CoTracker3: Simpler and Better Point Tracking by Pseudo-Labelling Real Videos.** ICCV 2025.  
   https://openaccess.thecvf.com/content/ICCV2025/html/Karaev_CoTracker3_Simpler_and_Better_Point_Tracking_by_Pseudo-Labelling_Real_Videos_ICCV_2025_paper.html

8. Doersch et al. **TAPIR: Tracking Any Point with Per-Frame Initialization and Temporal Refinement.** ICCV 2023.  
   https://openaccess.thecvf.com/content/ICCV2023/html/Doersch_TAPIR_Tracking_Any_Point_with_Per-Frame_Initialization_and_Temporal_Refinement_ICCV_2023_paper.html

9. Cho et al. **Local All-Pair Correspondence for Point Tracking / LocoTrack.**  
   https://arxiv.org/abs/2407.15420

10. **TAPNext++: What's Next for Tracking Any Point?**  
    https://arxiv.org/abs/2604.10582

## Segmentation

11. Ravi et al. **SAM 2: Segment Anything in Images and Videos.**  
    https://arxiv.org/abs/2408.00714

12. Cheng et al. **Tracking Anything with Decoupled Video Segmentation.** ICCV 2023.  
    https://openaccess.thecvf.com/content/ICCV2023/html/Cheng_Tracking_Anything_with_Decoupled_Video_Segmentation_ICCV_2023_paper.html

## Optical flow / blur

13. Wang, Lipson, Deng. **SEA-RAFT: Simple, Efficient, Accurate RAFT for Optical Flow.** ECCV 2024.  
    https://www.ecva.net/papers/eccv_2024/papers_ECCV/html/1065_ECCV_2024_paper.php

14. Kotera et al. **Intra-Frame Object Tracking by Deblatting.** ICCV Workshops 2019.  
    https://openaccess.thecvf.com/content_ICCVW_2019/html/VOT/Kotera_Intra-Frame_Object_Tracking_by_Deblatting_ICCVW_2019_paper.html

## Detection / small objects

15. Akyon et al. **Slicing Aided Hyper Inference and Fine-tuning for Small Object Detection.**  
    https://arxiv.org/abs/2202.06934

16. Zhang et al. **ByteTrack: Multi-Object Tracking by Associating Every Detection Box.** ECCV 2022.  
    https://www.ecva.net/papers/eccv_2022/papers_ECCV/html/315_ECCV_2022_paper.php

## Video-frame interpolation

17. Huang et al. **Real-Time Intermediate Flow Estimation for Video Frame Interpolation (RIFE).**  
    https://arxiv.org/abs/2011.06294

18. Shen et al. **Blurry Video Frame Interpolation.** CVPR 2020.  
    https://openaccess.thecvf.com/content_CVPR_2020/html/Shen_Blurry_Video_Frame_Interpolation_CVPR_2020_paper.html

## Curve fitting / smoothing

19. Yuksel, Schaefer, Keyser. **Parameterization and Applications of Catmull-Rom Curves.** Computer-Aided Design, 2011.  
    https://www.cemyuksel.com/research/catmullrom_param/

20. Eilers, Marx. **Flexible Smoothing with B-Splines and Penalties.** Statistical Science, 1996.  
    https://doi.org/10.1214/ss/1038425655

21. Wood. **P-splines with derivative based penalties and tensor product smoothing of unevenly distributed data.** Statistics and Computing.  
    https://link.springer.com/article/10.1007/s11222-016-9666-x

## Audio event timing

22. Ebenezer et al. **Detection of Audio-Video Synchronization Errors Via Event Detection.** ICASSP 2021.  
    https://arxiv.org/abs/2104.10116

23. Roberts et al. **Evaluation of impact sound on the 'feel' of a golf shot.** Journal of Sound and Vibration, 2005.  
    https://doi.org/10.1016/j.jsv.2004.11.026

---

# 39. Final implementation recommendation

The experiment should answer whether SwingSage can achieve acceptable reliability with a simplified stack, but the highest-confidence production architecture is currently:

```text
ORIGINAL SOURCE
  |
  +-- preserve true frame timestamps
  +-- preserve audio timing
  |
POSE / GRIP
  |
COARSE CLUB CORRIDOR
  |
HIGH-RES ROI
  |
  +-- temporal club heatmap
  +-- small-object/keypoint detector
  +-- point tracking
  +-- SEA-RAFT
  +-- deblatting on severe blur
  +-- grip kinematic prior
  |
CALIBRATED MULTI-EXPERT FUSION
  |
PHASE-LOCAL PHYSICS
  +-- soft projected-radius prior
  +-- lower-downswing conic prior
  |
EVENT FUSION
  +-- address motion onset
  +-- top direction reversal
  +-- visual impact corridor
  +-- optional audio transient
  +-- optional ball departure
  |
GLOBAL CONTINUOUS-TIME TRAJECTORY
  |
TRACE QUALITY GATE
  |
DEFAULT + A-I ANALYZER-SIDE PATH VARIANTS
  |
60 FPS NORMALIZED SAMPLES
  |
analysis.json
  |
PLAYER SCALE + DRAW ONLY
```

The most important design principle is to preserve the distinction between:

```text
what the camera observed
what a model hypothesized
what the global solver inferred
what the player rendered
```

A bulletproof system should never collapse those four concepts into one unqualified `(x, y)` point.
