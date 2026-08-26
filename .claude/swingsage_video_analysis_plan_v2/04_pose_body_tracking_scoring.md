# 04 - Pose, Body Tracking, Geometry, and Scoring

## 1. Objective

Reduce body-pose inference cost dramatically without allowing interpolation or smoothing to masquerade as measured scoring geometry.

## 2. Model strategy

Do not immediately replace RTMW just because another model benchmarks faster on generic data.

Benchmark these candidates against SwingSage geometry:

```text
A. current RTMW configuration
B. RTMW at lower input resolution
C. RTMPose-class candidate if the 49-point contract can be satisfied
D. RTMO-class candidate as a fast seed/person solution
E. optional two-model cascade if it wins dollars/accepted-swing
```

Important correction from the comparison research:

Official MMPose RTMW-l 384x288 reporting separates body AP from whole-body AP. Do not use generic table values as product acceptance metrics.

## 3. Person ROI

Avoid repeated expensive full-frame person detection when the golfer is stable in the frame.

Starting approach:

1. detect golfer ROI in coarse pass;
2. expand with safety margin;
3. propagate/track ROI over time;
4. redetect on confidence loss or large motion;
5. crop/resize directly for pose inference.

Because camera is often stationary, this should be easier than general person tracking.

## 4. Direct observation cadence

Starting policy:

| Source | Coarse body | Final body |
|---|---:|---:|
| 30 fps | up to 30 Hz | up to native 30 Hz |
| 60 fps | ~30 Hz | up to 60 Hz active swing |
| 120 fps | ~30 Hz | up to 60 Hz active swing |
| 240 fps | ~30 Hz | up to 60 Hz active swing |

These values must be selected by ablation, not opinion.

## 5. Adaptive densification

The planner may increase body cadence for:

- fast wrist/hand movement;
- low-confidence intervals;
- event neighborhoods;
- checks shown by benchmark to require denser direct observations.

A scoring-critical exact frame is always eligible for forced direct inference.

## 6. Display propagation

Allowed methods to benchmark:

1. linear interpolation;
2. constant-velocity/keypoint tracking;
3. optical-flow-assisted point propagation;
4. short temporal learned propagator only if deterministic/reproducible and validated.

Display output must include provenance and confidence decay.

Example:

```json
{
  "frame": 613,
  "keypoint": "lead_wrist",
  "xy": [0.421, 0.537],
  "confidence": 0.71,
  "provenance": "propagated",
  "from_frames": [612, 616]
}
```

## 7. Filtering and smoothing

Raw pose estimates can jitter. Benchmark One-Euro, Savitzky-Golay on derived angle channels, and other filters only against labeled geometry.

Rules:

- raw direct observation remains stored;
- filtered value has `derived` provenance;
- filter parameters are versioned;
- scoring declares whether it accepts raw-direct only or a validated derived channel;
- a filter must never resurrect a low-confidence or missing point as measured truth.

## 8. Geometry metrics

Prioritize downstream errors, not only pose AP:

- shoulder line angle;
- hip line angle;
- knee flex;
- elbow in-plane flex;
- wrist/hand location;
- spine/from-vertical;
- stack;
- hinge-related geometry;
- event-frame posture values;
- temporal derivatives used by tempo/event logic.

## 9. Scoring provenance contract

Every scoring rule declares:

```yaml
id: lead_knee_flex_at_impact
required_event: impact
required_view: [face_on]
geometry:
  frame: event
  direct_only: true
  accepted_provenance: [model, manual_correction]
min_keypoint_confidence: 0.75
min_event_confidence: 0.80
on_failure: abstain
```

Other low-sensitivity rules may explicitly allow `derived` after validation.

## 10. Confidence handling

Maintain separate concepts:

- model confidence;
- propagation confidence;
- geometry confidence after dependency aggregation;
- event confidence;
- score-check confidence.

Do not map them into one opaque number too early.

## 11. Pose experiments

### E-P1: cadence ablation

For native 240 fps recordings:

```text
pose every frame
pose at 120 Hz
pose at 80 Hz
pose at 60 Hz
pose at 30 Hz
```

Compare all variants to direct-every-frame reference and human labels where available.

Metrics:

- angle MAE/p95;
- keypoint error;
- event error;
- score agreement;
- wrong-high-confidence score rate;
- GPU seconds.

### E-P2: model/runtime matrix

```text
model x input resolution x runtime x precision x batch
```

Measure accepted geometry per dollar and p95 latency.

### E-P3: propagation methods

Measure display point error and visual jitter, but do not let display metrics choose scoring policy.

## 12. Acceptance criteria

- Direct scoring frames are never represented as propagated.
- Pose cadence reduction meets predefined body-angle and score gates on the golden set.
- Runtime changes such as FP16/TensorRT produce no statistically meaningful regression in critical geometry or confidence calibration.
- View-gated/handedness behavior matches current contract.
