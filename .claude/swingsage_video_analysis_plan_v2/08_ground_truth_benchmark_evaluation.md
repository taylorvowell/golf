# 08 - Ground Truth, Benchmarks, Evaluation, and Release Gates

## 1. Why this is a prerequisite

The current club pipeline cannot be tuned responsibly without positional ground truth. Coverage and visual smoothness are insufficient and have previously overstated quality.

Build the evaluation system before large club-algorithm rewrites.

## 2. Dataset tiers

### Frozen golden set

Purpose:

- every model/runtime/code regression;
- release gate;
- never used for training/tuning.

Initial target: enough diversity to expose catastrophic cases, then grow continually. Prefer at least dozens of swings across major strata before trusting any release gate.

### Development/training set

Purpose:

- training;
- threshold selection;
- active learning;
- ablation.

Grow toward hundreds of swings and many thousands of labeled club frames.

### Untouched shadow holdout

Purpose:

- final generalization check before production promotion;
- golfer-disjoint and recording-disjoint.

## 3. Required diversity dimensions

Stratify by:

- 30/60/120/240 fps;
- face-on/down-the-line;
- right/left handed;
- driver/fairway wood/iron/wedge;
- indoor/outdoor;
- turf/mat;
- lighting level and backlight;
- dark/light club head;
- device model;
- shutter/blur severity;
- camera distance/zoom;
- occlusion severity;
- clothing/background complexity;
- practice swing versus actual strike;
- audio quality/noise.

## 4. Club annotation schema

Per native frame in selected labeled intervals:

```text
grip
shaft midpoint
hosel/neck
head reference point A
head reference point B
visibility per point
occluded flag
out-of-frame flag
blur severity
annotator confidence
```

Also derive/check:

- head center;
- shaft axis;
- apparent club length.

### Label cadence

For the golden set, label every native frame through the club-critical active interval.

For training scale, use model pre-annotation plus human correction and active learning.

## 5. Event annotation schema

Per swing:

- address source frame;
- top source frame;
- impact source frame;
- finish source frame;
- optional takeaway;
- audio contact waveform region;
- ball last-present/first-moving frames when visible;
- annotator confidence;
- second-annotator label for a representative subset.

Store both frames and milliseconds.

## 6. Body annotation

Do not hand-label all body joints on all frames initially.

Prioritize:

- exact scoring/event frames;
- shoulders;
- hips;
- knees;
- elbows;
- wrists/hands;
- head/neck/trunk points used in current metrics.

Measure inter-annotator error so model targets are not stricter than human consistency without reason.

## 7. Trim-system labels

Raw pre-trim clips need separate labels:

- all actual ball-strike times;
- practice-swing intervals;
- chosen/desired swing if multiple;
- true address through finish interval;
- audio quality;
- walking/phone-handling intervals;
- slow-motion timing facts.

This lets trim performance be measured independently from exact server impact detection.

## 8. Club metrics

Report:

```text
PCK@2px / 5px / 10px
median / p95 point error
error normalized by club length
head-center median / p95
hosel error
shaft angular error
visible-frame precision / recall
false-positive rate
confidence calibration
catastrophic jump rate
reacquisition time
gap count
gap duration distribution
impact-window error
```

For trace quality, use frame-aligned point errors over visible GT frames. Do not let a generic smoothness score substitute for positional accuracy.

## 9. Event metrics

For each event:

- exact-frame rate;
- +/-1, +/-2, +/-4 frame rates;
- median/p90/p95 ms error;
- catastrophic miss rate;
- high-confidence catastrophic miss rate;
- abstention rate;
- confidence calibration.

Report by FPS because a "frame" means different milliseconds at 30 and 240 fps.

## 10. Body metrics

- keypoint pixel/normalized error;
- event-frame keypoint error;
- shoulder/hip line angle MAE/p95;
- knee/elbow angle MAE/p95;
- spine/stack metric error;
- jitter/acceleration error as a secondary metric;
- scoring outcome agreement;
- wrong-high-confidence scoring rate.

## 11. Scoring benchmark

Create expert-labeled outcomes for representative checks:

```text
pass
needs_improvement
abstain / not-evaluable
```

Most important metric:

> rate of wrong, high-confidence judgments.

This should be a release blocker even if average numeric score correlation looks good.

## 12. Dataset split rule

Never randomly split adjacent frames from the same swing across training and evaluation.

Split by golfer and source recording.

Prefer device/location diversity in holdout.

## 13. Annotation tooling

CVAT or equivalent is appropriate for:

- point/keypoint annotation;
- pre-annotation + correction;
- frame navigation;
- visibility/occlusion attributes.

The exact tool is replaceable. The schema and export format are not.

## 14. Golden-set CI

Every change to:

- model weights;
- runtime;
- precision;
- sampling policy;
- tracking/solver;
- event fusion;
- score thresholds;
- timeline mapping;

runs a deterministic golden benchmark and produces a machine-readable diff.

Promotion fails if any hard gate regresses.

## 15. Suggested initial release gates

Exact values must be calibrated after enough labels exist.

Hard conceptual gates:

- frame identity mismatch = 0;
- propagated represented as direct = 0;
- high-confidence catastrophic impact miss = 0 on golden set;
- high-confidence impossible club jumps below agreed threshold;
- club/body confidence calibration does not materially degrade;
- no statistically meaningful increase in wrong-high-confidence score decisions;
- latency/cost within SLO.
