# 06 - Swing Events and Impact Detection

## 1. Events required

At minimum:

- address;
- top of backswing;
- impact;
- finish.

Optional internal phases may include takeaway and intermediate bands.

Every final event has:

```text
source_frame_id
real_time_ms
canonical_playback_frame_id
confidence
evidence breakdown
method/model version
```

## 2. The user's trim mark is ignored

The hand-dragged client marker is only a trim-control value.

The server event pipeline must behave identically whether the user happened to choose:

- exact impact;
- 5 frames early;
- 20 frames late;
- the wrong part of the swing.

As long as the real swing survived the trim, the analyzer must rediscover it.

## 3. Coarse-to-fine event design

### Coarse pass

Use a cheap temporal representation to identify broad event neighborhoods.

Candidate baselines:

- pose/motion heuristics;
- SwingNet/GolfDB-style temporal event model;
- compact temporal network over coarse pose/visual embeddings;
- ensemble only if calibration improves materially.

The GolfDB/SwingNet work is a useful golf-specific baseline, not a precision endpoint.

### Native-frame refinement

For each event, inspect only a local neighborhood at source/native frame resolution.

Example:

```text
coarse top: 1.74 s +/- 120 ms
-> native-frame refine around that interval

coarse impact: 2.48 s +/- 100 ms
-> native-frame multimodal refine
```

This preserves high temporal precision without running high-resolution event logic across the entire clip.

## 4. Address and finish

Temporal models often struggle with relatively static boundary events.

Use complementary signals:

- low body velocity;
- club/body setup stability;
- ball present at address;
- sustained post-swing low motion for finish;
- temporal phase ordering constraints.

## 5. Impact is a multimodal fusion problem

Known current-state evidence includes a visual impact estimate that was wrong by 40 frames and was caught by audio/ball evidence. The new design should make disagreement explicit rather than letting one signal silently win.

For every native candidate frame in the local impact window compute features such as:

```text
audio transient likelihood
club-head / ball proximity
club speed / angular motion
trajectory phase/direction
ball present-before likelihood
ball absent/moving-after likelihood
body downswing prior
visual quality
club confidence
ball confidence
audio quality
```

Fit a calibrated, inspectable fusion model such as:

- logistic regression;
- small gradient-boosted tree model;
- simple probabilistic score fusion if data is initially small.

Avoid a large opaque model until labeled impact data justifies it.

## 6. Audio rules

Audio is valuable evidence but not exact visual ground truth.

Reasons:

- sound reaches the microphone after physical contact;
- delay varies with phone-to-ball distance;
- device A/V synchronization can vary;
- indoor reflections and range noise affect onset;
- imported files can have different timestamp paths.

At roughly 343 m/s sound speed, 3 m of distance produces about 8.7 ms of acoustic delay, which is about 2.1 frames at 240 fps.

Therefore:

- preserve sample-level audio timestamps;
- estimate capture/import path A/V offset where possible;
- use audio to strongly narrow candidate regions;
- calibrate its temporal distribution on ground truth;
- do not globally declare audio authoritative.

## 7. Ball evidence

Detect the ball only where useful:

### setup window

- establish position;
- confidence;
- visibility.

### impact window

- club-head/ball proximity;
- last stable present frame;
- first absent/moving frame;
- optional initial flight streak if visible.

Ball disappearance can be an excellent witness but can also fail due to occlusion/compression. Keep confidence explicit.

## 8. Event ordering constraints

The final sequence must obey physically plausible order:

```text
address < top < impact < finish
```

Use soft duration priors for:

- backswing duration;
- downswing duration;
- impact neighborhood;
- finish timing.

Never force an implausible detection into order just to satisfy a constraint. Lower confidence/abstain instead.

## 9. Output example

```json
{
  "event": "impact",
  "source_frame_id": 612,
  "real_time_ms": 2550.0,
  "playback_frame_id": 612,
  "confidence": 0.93,
  "search_window": [595, 632],
  "evidence": {
    "audio": {"score": 0.88, "quality": 0.90},
    "club_ball": {"score": 0.91, "quality": 0.84},
    "ball_transition": {"score": 0.78, "quality": 0.72},
    "body_phase": {"score": 0.65, "quality": 0.95}
  },
  "method_version": "impact-fusion-2.0.0"
}
```

## 10. Ground truth

For every labeled swing:

- exact human-selected event source-frame IDs;
- impact additionally labeled using synchronized frame inspection + audio waveform;
- store inter-annotator disagreement;
- store milliseconds as well as frames.

Do not define audio waveform time itself as the truth. The label is the physical/visual contact event as best established by synchronized evidence.

## 11. Metrics

Report by FPS and in milliseconds:

- exact-frame rate;
- within +/-1 frame;
- within +/-2 frames;
- within +/-4 frames;
- median absolute error;
- p90/p95 absolute error;
- catastrophic miss rate;
- high-confidence catastrophic miss rate;
- confidence calibration / reliability curve;
- abstention rate.

Averages must not hide 40-frame-class failures.

## 12. Initial gates

Aspirational until enough GT exists:

- impact median <= 1 native frame;
- impact p95 <= 2 to 3 native frames at high FPS, or an equivalent millisecond threshold;
- high-confidence catastrophic impact misses = 0 on frozen golden set;
- all other events beat current baseline without raising catastrophic error.
