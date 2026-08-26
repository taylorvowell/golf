# 00 - Product Requirements and Architecture Decisions

## 1. Product outcome

SwingSage accepts a recorded or imported single golf swing and returns an explainable analysis containing:

- frame-locked body skeleton;
- club geometry and path trace;
- address, top, impact, and finish events;
- body and club metrics;
- confidence and provenance;
- score and reasons;
- optional coaching narrative generated only from the finished deterministic artifact.

## 2. Product guarantees that remain

### High-speed capture

- In-app capture targets 240 fps, then 120, then 60 based on what the device actually configures.
- The app must never silently claim a higher capture rate than actually recorded.
- Frames must not be invented.
- A 30 fps import remains 30 unique captured samples.
- A real 240 fps source retains all 240 real samples per second even if most subsystems do not infer on all of them.

### Frame-exact review

- Exact frame identity is a product requirement.
- Overlay geometry must reference stable source/playback frame IDs.
- No client may infer frame identity by rounding if an explicit mapping exists.
- Coach/manual corrections remain frame-addressed and reproducible.

### Explainability and abstention

- Every event, keypoint, club observation, metric, and score dependency has confidence.
- Every geometry record has provenance.
- "Cannot be evaluated" is valid and preferable to a confident wrong value.
- View-gated metrics abstain when face-on/down-the-line geometry does not support them.
- Handedness is explicit throughout geometry and scoring.
- Face angle from ordinary video remains classification-level only, not launch-monitor-style degrees.

### AI boundary

- Raw video is never sent to an LLM.
- LLMs do not create or alter measured geometry.
- Coaching text is generated from versioned deterministic analysis output.

## 3. Updated decisions

### D1 - The user's trim mark is not analysis evidence

The user is asked to mark roughly where impact occurs only so the app can choose a five-second upload window.

The server must not use this value as:

- exact impact;
- an impact prior;
- confidence evidence;
- a ground-truth label;
- a training label;
- a scoring input.

The server independently rediscovers all swing events.

### D2 - Playback FPS is not inference FPS

A model's observation rate is a per-subsystem policy. A 240 fps playback asset does not imply 240 body-pose inferences per second.

### D3 - Source frame identity is immutable

Create a source-frame/timestamp manifest before analysis. Every output references stable source frame IDs.

### D4 - Display propagation is explicitly different from measurement

Allowed provenance values:

```text
model
tracked
propagated
derived
manual_correction
missing
```

A scoring rule can require `direct_only: true` and force model inference on its exact event frame.

### D5 - Impact is multimodal

Impact combines calibrated evidence from:

- audio transient;
- club/ball geometry;
- club motion/phase;
- ball presence/disappearance/flight;
- body phase;
- signal quality/confidence.

No single witness is globally authoritative.

### D6 - Club tracking becomes club pose plus sequence solving

The target representation is a compact multi-keypoint club model rather than independent head-box and shaft heuristics as the final geometry.

Initial label proposal:

1. grip;
2. shaft midpoint;
3. hosel/neck;
4. club-head inner/reference point;
5. club-head outer/reference point.

The exact label geometry is frozen only after annotation ergonomics and scoring needs are reviewed.

### D7 - Missing club geometry remains missing

Trajectory models may help choose among observed candidates and reject impossible paths. They do not silently manufacture measured points.

### D8 - Interactive analysis readiness is separate from presentation rendering

`analysis_ready` means the interactive geometry, events, metrics, and scores are final. Burn-in/share videos and nonessential contact sheets can finish later.

### D9 - Pre-upload stays audio-first

The existing audio-only seed remains the normal fast path. Sparse visual motion scanning is conditional and runs only when audio confidence is weak, ambiguous, or absent.

### D10 - The media manifest is authoritative, not container tags after remux

Capture FPS, presentation FPS, slow-motion factor, source duration, trim timestamps, and actual remux boundaries are captured before/after trim into a separate manifest. The server does not depend on a fragile device tag surviving a remux.

## 4. Quality hierarchy

When goals conflict, use this order:

1. do not publish confident false geometry;
2. preserve frame identity and reproducibility;
3. preserve scoring validity;
4. reduce latency;
5. reduce cost;
6. improve visual smoothness.

A smoother trace is never allowed to outrank measurement honesty.
