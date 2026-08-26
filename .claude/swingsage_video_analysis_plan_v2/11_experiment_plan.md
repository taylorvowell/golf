# 11 - Ordered Experiment and Decision Plan

## Principle

Do not implement every optimization simultaneously. Build decision gates that answer one architectural question at a time.

## P0 - Correctness and instrumentation

### E0.1 Source/trim manifest regression

**Question:** Can every supported capture/import path preserve authoritative timing facts through trim?

Fixtures:

- 30 fps import;
- 60/120/240 in-app;
- VFR import;
- 240-capture/30-presentation slow motion;
- remux with non-keyframe start;
- missing/conflicting metadata.

**Pass:** zero frame-count/duration interpretation mismatch.

### E0.2 Stage timing profile

Instrument current pipeline by:

- decode;
- preprocessing;
- body;
- club detector;
- classical shaft;
- trace assembly;
- events;
- silhouette;
- render;
- serialization/storage.

**Pass:** at least 95 percent of wall time and billed worker time attributable to named stages.

## P1 - Pre-upload efficiency

### E1.1 Audio confidence calibration

Measure current audio candidate accuracy and user-adjust rate.

**Decision:** define thresholds for `confident`, `ambiguous`, `none`.

### E1.2 Conditional visual fallback

Compare:

```text
A current end-of-clip fallback
B 4 fps frame-difference motion scan
C 8 fps frame-difference
D low-rate optical flow if needed
```

**Primary metrics:** impact-in-window, full-swing-in-window, manual correction, time-to-preview, device battery/thermal.

**Adopt only if:** it improves weak-audio cases without slowing high-confidence audio path.

## P2 - Body frame-rate policy

### E2.1 Direct cadence ablation

On 240 fps ground-truth/reference clips compare:

```text
240 / 120 / 80 / 60 / 30 Hz direct pose
```

Force identical scoring/event frames direct for fair comparison.

**Metrics:** angle error, score outcome, event error, GPU seconds.

**Decision:** largest stride that stays inside geometry/score gates.

### E2.2 Propagation method

Compare linear, optical-flow-assisted, and other low-cost propagation.

**Decision:** choose display method separately from scoring method.

## P3 - Club architecture

### E3.1 Ground-truth evaluator first

No algorithm comparison until positional evaluator exists.

### E3.2 Current pipeline versus five-keypoint club pose

A/B:

```text
A current YOLO-head + classical shaft + current trace
B sparse full-frame crop detector + 5-keypoint crop pose + sequence solver
```

**Metrics:** head/hosel/shaft error, false positives, gaps, catastrophic jumps, latency/cost.

### E3.3 Global detector stride

Try:

```text
1 / 2 / 5 / 10 native frames while locked
adaptive reacquisition
```

**Decision:** cheapest policy satisfying club accuracy gates.

### E3.4 Candidate solver

Compare:

- highest local confidence;
- Viterbi/dynamic program;
- beam search;
- optional ByteTrack/OC-SORT candidate association.

**Decision:** lower p95 positional error and catastrophic jumps.

### E3.5 Blur-aware model

Compare baseline vs blur augmentation/auxiliary blur feature.

**Adopt:** only on measurable positional/gap improvement.

## P4 - Events and impact

### E4.1 Coarse event baseline

Compare current heuristics, SwingNet-style baseline, and pose-sequence model.

**Goal:** best candidate-window recall at lowest cost, not final exact-frame precision.

### E4.2 Native local refinement

Measure event error with native-frame local reprocessing versus coarse-only.

### E4.3 Impact fusion

Ablations:

```text
club visual only
audio only
club + audio
club + ball
club + audio + ball
all + body phase
```

**Metrics:** exact/+1/+2 frames, ms p95, catastrophic miss, confidence calibration.

**Expected decision:** calibrated multimodal fusion, unless evidence surprisingly shows a simpler subset is superior.

## P5 - Runtime optimization

### E5.1 Batch sweep

Batch 1/4/8/16/32.

### E5.2 Runtime sweep

PyTorch, FP16, compile, ONNX CUDA, TensorRT FP16.

### E5.3 GPU decode

Current decode versus NVDEC/GPU-resident pipeline.

### E5.4 GPU class

At least current L4 plus one cheaper and one faster option.

**Decision metric:** dollars per accepted view under latency/accuracy gates.

## P6 - Progressive UX

Compare user-visible milestone timing:

- video only;
- coarse skeleton;
- body/events;
- club;
- final score.

Measure actual p95 and user review behavior. Do not delay accurate final work merely to manufacture progress events.

## P7 - Warm/session scheduling

Compare:

- scale-to-zero;
- longer scaledown window;
- active buffer;
- upload-overlap preparation;
- permanent warm minimum.

Decision by p95 user-confirm to first inference plus incremental dollars/view.

## Experiment output format

Every experiment writes:

```text
hypothesis
dataset/version
code/model/policy versions
hardware/runtime
independent variable
quality metrics
latency metrics
cost metrics
confidence intervals where meaningful
failure examples
recommendation: adopt / reject / more data
```

No architectural constant is promoted from an experiment without a recorded decision artifact.
