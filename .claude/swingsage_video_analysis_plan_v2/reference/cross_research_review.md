# SwingSage Cross-Research Review and Recommended Plan Changes

**Date:** August 26, 2026  
**Purpose:** Validate the second AI research package, compare it with the existing SwingSage research plan, and identify only the changes worth carrying forward. This also reviews the pre-upload trimming flow.

## Bottom line

The second research package is **directionally strong and mostly accurate**. Its main conclusion matches the existing SwingSage plan:

> Preserve every real source frame, but do not run every model on every frame.

Its strongest contribution is additional support for a **CADDIE-style golf-club architecture**: sparse full-frame club localization feeding native-frame, high-resolution club-crop keypoint estimation.

The existing SwingSage plan should remain the base. I would **add a small number of ideas**, not replace it wholesale.

The second report also contains several claims that should **not** be adopted:

- Do not make audio authoritative for exact impact.
- Do not let interpolated body points silently become scored measurements.
- Do not make ByteTrack/BoT-SORT the primary club solution just because they are strong general MOT systems.
- Do not replace honest club gaps with fitted curves unless SwingSage ground truth proves they are better.
- Do not quote the proposed 5x-20x TensorRT speedup or sub-$0.02 240 fps cost as expected production results before benchmarking.
- Do not assume a permanently warm GPU pool is economically optimal.

---

# Very simple proposed change table

| Change | Before | Proposed |
|---|---|---|
| **Pre-upload trim fallback** | Audio-only guess; silence falls near end of clip | **Keep audio fast path. If confidence is low/ambiguous, conditionally run a tiny low-rate visual motion scan to locate/validate the swing window.** |
| **Trim validation** | User can upload a badly selected 5 s window | **Before upload, verify the selected window contains plausible swing motion. Warn only when confidence is poor.** |
| **Trim metadata** | Important capture-rate metadata can be lost during remux | **Upload a small authoritative trim/source manifest beside the video. Do not rely on remuxed tags.** |
| **Client preflight** | Server discovers bad duration/frame-count cases later | **Probe the trimmed output locally before upload and reject obviously invalid duration/frame-rate/slow-mo mappings. Server repeats the guard.** |
| **Club candidates** | Global sequence solver uses candidates | **Explicitly retain useful low-confidence club candidates for sequence-level resolution instead of hard-dropping them early.** |
| **Club blur handling** | Motion-aware tracking is an experiment | **Add blur-aware training augmentation and a blur-quality signal as a measured club experiment.** |
| **Event baseline** | Generic coarse event pass | **Benchmark SwingNet as a baseline, while keeping native-frame local event refinement.** |
| **Frame timing contract** | Stable source IDs and frame/timestamp mapping | **Make source PTS, capture time, and playback PTS explicit first-class fields.** |
| **Cold-start strategy** | Optimize after core pipeline | **Add a measured upload-overlap / `scaledown_window` / buffer-container experiment. Do not default to a permanent warm GPU.** |

These are the only material changes I recommend right now.

---

# 1. Review of the second AI research

## 1.1 CADDIE is real, current, and highly relevant

This is the most important thing the second report found.

CADDIE was published at the CVsports Workshop at CVPR 2026 specifically for golf-club pose estimation. Its published results include:

- 72K annotated frames
- 7 subjects
- 6 locations
- driver, wood, and iron
- a five-keypoint club representation
- 14.3M parameters
- 88.52% PCK@5px
- 69 FPS baseline on RTX 3090
- 185 FPS when the full-frame detector runs every fifth frame, with essentially unchanged reported PCK
- 218 FPS at a detector interval of 10 with only a small reported PCK reduction

Most importantly, CADDIE separates two jobs:

1. **Full-frame detector:** find and maintain a generous club crop.
2. **High-resolution club pose model:** measure grip, shaft, neck/hosel, and club-head geometry inside that crop.

That is better aligned to SwingSage than treating a full-frame YOLO club-head box as the final geometry.

### Finding

The existing SwingSage plan already moved in this direction. CADDIE substantially strengthens that decision.

### Recommendation

Keep the existing plan:

```text
full frame
    -> sparse high-recall club-region localization
    -> crop propagation/reacquisition
    -> high-resolution five-keypoint club pose at native HFR
    -> multiple observed candidates
    -> sequence-level solver
    -> trace with honest missing evidence
```

Do not assume CADDIE itself is a drop-in production dependency. Its public GitHub repository currently exposes the project site rather than a complete, clearly licensed production model package. SwingSage should treat the paper as architectural evidence and train/validate its own production model.

Sources:

- https://openaccess.thecvf.com/content/CVPR2026W/CVsports/html/Jung_CADDIE_Compact_Adaptive_Detection-Driven_Inference_for_Real-Time_Golf_Club_Pose_CVPRW_2026_paper.html
- https://cjung5.github.io/CADDIE/
- https://github.com/cjung5/CADDIE

---

## 1.2 The RTMW accuracy numbers in the second report contain a factual error

The second report says RTMW-l at 384x288 has **76.1 whole-body AP**.

That is not correct.

The official MMPose table reports for RTMW-l at 384x288:

- Body AP: **76.1**
- Hand AP: **66.3**
- Whole AP: **70.1**
- FLOPs: **17.7G**

RTMW-l at 256x192 reports:

- Whole AP: **66.0**
- FLOPs: **7.9G**

The general conclusion is still valid: smaller input resolution substantially reduces computation.

### Recommendation

Do not automatically switch to 256x192. Benchmark 384x288, 256x192, and potentially alternative models against **SwingSage downstream geometry**, especially:

- wrist/hand localization
- shoulder and hip geometry
- knee/elbow angle MAE
- impact-frame body metrics
- confidence calibration
- wrong-high-confidence scoring decisions

Generic COCO AP is not the product metric.

Primary source:

- https://github.com/open-mmlab/mmpose/blob/main/configs/wholebody_2d_keypoint/rtmpose/cocktail14/rtmw_cocktail14.md

---

## 1.3 RTMPose and RTMO are worth benchmarking, not assuming

The reported high throughput of RTMPose and RTMO is supported by their published work.

However, those benchmarks do not establish that either model preserves SwingSage's 49-point output quality, hand/wrist accuracy, angle accuracy, or golf-specific confidence behavior.

### Recommendation

Add these to the benchmark matrix:

```text
current RTMW
RTMW lower input resolution
RTMPose candidate
RTMO candidate
PyTorch / FP16 / ONNX / TensorRT variants
```

Select on **accepted golf geometry per dollar and latency**, not benchmark FPS.

---

## 1.4 GPU decode and GPU-resident preprocessing are valid

NVIDIA's current tooling supports NVDEC-backed decode into GPU/device memory. That makes this path technically valid:

```text
compressed source
    -> NVDEC
    -> GPU frame
    -> GPU crop/resize
    -> batched inference
    -> compact geometry output
```

This is a credible way to eliminate repeated:

- CPU decode
- CPU resize
- ndarray creation
- host-to-device copies

### Recommendation

No change to the existing plan. Benchmark PyNvVideoCodec/NVDEC against the current FFmpeg/Python path after the workload itself has been reduced.

---

## 1.5 TensorRT and batching are good ideas, but the speed estimate is not a forecast

The second report is right to test:

```text
batch 1 / 4 / 8 / 16 / 32

PyTorch baseline
PyTorch FP16
torch.compile
ONNX Runtime CUDA
TensorRT FP16
```

Its proposed **5x-20x** compound speedup is plausible as a hypothesis, but not sufficiently grounded to become a product estimate.

The speedup will depend on where current wall time actually goes. The original production data already shows that raw pose inference alone does not explain the full 124.6-second job.

### Recommendation

Keep the optimization, remove the expectation.

The acceptance metric should be:

```text
dollars per accepted swing

subject to:
    body accuracy >= gate
    club accuracy >= gate
    event accuracy >= gate
    p95 latency <= SLO
```

---

# 2. Club tracking comparison

## 2.1 Add the ByteTrack idea, but not ByteTrack as the architecture

ByteTrack's useful idea is well supported: **do not automatically discard every low-confidence detection**. Low-confidence observations can contain real objects, especially during occlusion.

That is relevant to a blurred golf club.

However, ByteTrack, BoT-SORT, and OC-SORT are general multi-object tracking approaches. SwingSage has a much more structured problem:

- normally one club
- very fast angular motion
- a reversal around the top
- self-occlusion
- motion blur
- known relationship between hands, grip, shaft, hosel, and head
- known swing-phase direction

### Improvement to the current plan

Retain a small candidate set per frame:

```text
club_candidate:
    keypoints
    model confidence
    per-keypoint confidence
    shaft evidence
    grip-to-hand consistency
    apparent club-length consistency
    visibility / occlusion
    blur severity
```

Then let the existing sequence solver select the path using temporal and geometric evidence.

**Low confidence becomes eligible evidence, not accepted truth.**

Useful supporting source:

- ByteTrack: https://arxiv.org/abs/2110.06864
- OC-SORT: https://arxiv.org/abs/2203.14360

---

## 2.2 Do not adopt curved club-gap reconstruction yet

The second research recommends a physics/arc fit that can fill short gaps with a curved estimate.

I would not adopt that.

The current SwingSage evidence already says that previous spline and physics-informed reconstructions did not beat a straight representation on held-out gaps. More importantly, a visually pleasing curve can imply more measurement certainty than actually exists.

### Keep the distinction

Use trajectory physics and temporal continuity for:

- candidate selection
- impossible-jump rejection
- reacquisition
- confidence

Do **not** automatically turn fitted trajectory into measured geometry.

For genuinely missing club evidence:

```text
source = missing / estimated
confidence = appropriately reduced
UI = dashed uncertainty
scoring = unavailable unless the check explicitly permits estimates
```

---

## 2.3 Add a motion-blur experiment

This is one useful new idea from the second report.

CADDIE itself identifies motion blur as one of the major club-pose challenges. Blur should therefore become a measured dimension in SwingSage's dataset.

### Proposed experiment

Add labels/metadata for:

- no blur
- mild blur
- heavy blur
- shaft streak visible
- head streak visible
- unusable

Then test:

1. directional motion-blur augmentation during training;
2. a blur-quality auxiliary output;
3. optionally an estimated blur/streak axis;
4. using blur severity in club confidence calibration;
5. using blur direction only as sequence-solver evidence.

### Acceptance

Adopt only if it lowers one or more of:

- p95 head-center error
- catastrophic jump rate
- long-gap rate
- impact-window club error

without increasing false positives.

---

# 3. Impact detection

## 3.1 The user-selected "near impact" frame must stay out of server inference

This point is now explicit.

The user is not expected to identify the exact frame. In many cases the preview does not even expose every native HFR frame.

Therefore the hand-dragged mark is:

- **trim input only**
- not ground truth
- not a server-side prior
- not a confidence signal
- not a training label
- not a scoring input

The server independently rediscovers impact from the uploaded clip.

This preserves the current product principle that trim and measurement are separate problems.

---

## 3.2 Do not make audio authoritative

The second report recommends making audio the authoritative impact source.

I would reject that.

Audio is extremely valuable, but exact visual impact and audio arrival are not physically identical times.

At roughly 343 m/s speed of sound:

| Phone distance from ball | Approx. acoustic delay | Equivalent at 240 fps |
|---:|---:|---:|
| 1 m | 2.9 ms | 0.7 frame |
| 2 m | 5.8 ms | 1.4 frames |
| 3 m | 8.7 ms | 2.1 frames |
| 4 m | 11.7 ms | 2.8 frames |
| 5 m | 14.6 ms | 3.5 frames |

That is before:

- device microphone/camera synchronization offsets
- codec timestamps
- indoor reflections
- mat/turf noise
- other golfers
- wind
- differing phone positions

So "audio has millisecond resolution" does **not** mean it directly identifies the visual contact frame to ±1 native frame.

### Recommended impact architecture

Keep impact as calibrated multimodal fusion:

```text
candidate native frames
    -> audio transient likelihood
    -> club-head / ball geometry
    -> club motion / phase
    -> ball present-before evidence
    -> ball absent/moving-after evidence
    -> body downswing prior
    -> signal confidences
    -> calibrated fusion
    -> impact frame + confidence + evidence
```

Audio should become more important than it is today, but not absolute.

---

# 4. Body pose and scoring provenance

The second report's compute strategy is correct:

- body pose does not need native 240 Hz inference everywhere;
- use lower-rate direct inference;
- propagate/interpolate for smooth playback;
- densify when required.

The current SwingSage plan has a stronger evidence rule and should keep it.

### Recommended representation

```text
model
tracked
propagated
derived
manual_correction
missing
```

For example, a smooth 240 fps playback overlay may contain propagated body positions between direct 60 Hz observations.

But when the final impact frame is known:

```text
impact frame = 612
lead knee flex at impact requires direct_only
-> force body inference on frame 612
-> calculate score from direct observation
```

### Recommendation

Extend this rule to every scoring check:

```yaml
geometry_provenance:
  direct_only: true|false
min_geometry_confidence: ...
min_event_confidence: ...
```

This is one of the most important protections against making cheap interpolation look like measurement.

---

# 5. Event detection

The second report's SwingNet reference is accurate.

GolfDB introduced 1,400 labeled golf swing videos and the SwingNet baseline. The paper reports:

- average eight-event PCE: 76.1%
- six of eight events: 91.8%

It is useful because it is golf-specific.

It is not precise enough by itself for SwingSage's exact-event requirements.

### Recommendation

Add SwingNet as a benchmark baseline for the **coarse pass**:

```text
coarse temporal event model
    -> candidate address/top/impact/finish windows
    -> native-fps local refinement
    -> multimodal impact fusion
```

Primary source:

- https://openaccess.thecvf.com/content_CVPRW_2019/html/CVSports/McNally_GolfDB_A_Video_Database_for_Golf_Swing_Sequencing_CVPRW_2019_paper.html

---

# 6. Pre-upload trim flow review

## 6.1 Keep the existing audio-first path

The existing flow has a very good property:

> the common case does not decode video just to find a rough trim center.

That preserves perceived speed.

The audio system already has sensible product behavior:

- transient scoring
- whoosh + click preference
- edge down-weighting
- multiple candidates
- later plausible strike preference
- silence fallback
- real-time-aware slow-motion conversion
- fixed 5-second real-world review window

I would **not replace this with always-on on-device body pose or video CV**.

That would spend time, battery, and implementation complexity on every imported clip even though the seed only needs to be roughly correct.

---

## 6.2 Add a conditional visual trim fallback

The weak case in the current design is when:

- audio is silent;
- range noise creates multiple similar candidates;
- the wrong click/transient wins;
- a practice swing has confusing audio;
- an imported edit has unusual timing;
- the user manually drags to the wrong neighborhood.

Today the no-audio fallback is simply "6 seconds from the end."

### Proposed change

Keep audio first.

Only when audio confidence is poor or ambiguous, run a **very cheap sparse visual scan**.

Initial experiment:

```text
resolution: 160-320 px long side
sampling: 4-8 fps
signal: frame difference / motion energy
optional: coarse optical flow
no body scoring
no club model
no exact impact detection
```

The purpose is not to measure impact.

It answers only:

> "Where in this raw clip is the most plausible swing-motion interval?"

On Android, the platform supports scaled frame retrieval and frame/time metadata APIs. On iOS, AVFoundation can decode video samples, and hardware/native pipelines should be benchmarked.

Android reference:

- https://developer.android.com/reference/android/media/MediaMetadataRetriever

### Candidate fusion

If audio returns candidates A, B, C:

```text
audio candidate score
    +
does ±2.5 s window contain a golf-like motion burst?
    +
edge prior
    =
trim candidate score
```

This is a **trim classifier**, not an impact detector.

### Important UX rule

The high-confidence audio path should not wait for visual validation.

Run visual fallback only when needed.

---

## 6.3 Add a selected-window sanity check before upload

Because a user can manually select the wrong neighborhood, perform a cheap validation of the **window**, not the mark.

Question:

> Does this 5-second window appear to contain a plausible golf swing motion envelope?

If no:

- keep the user on the trim screen;
- say the app may not see a swing in the selected window;
- allow them to move the window anyway;
- never claim the user chose the wrong impact frame.

This protects against the one failure no server algorithm can solve:

> the real swing was trimmed out before upload.

---

## 6.4 Replace "silence = 6 seconds from end" with conditional motion search

The fixed end-of-clip fallback is a reasonable heuristic but should not be the final fallback if low-rate motion scanning proves cheap enough.

Recommended behavior:

```text
audio confident
    -> current fast path

audio ambiguous
    -> validate/rank audio windows with sparse motion

audio silent
    -> sparse full-clip motion scan
    -> choose likely swing interval
    -> if still low confidence, use current end-of-clip heuristic
```

This should reduce unnecessary manual corrections without slowing good clips.

---

## 6.5 Add an authoritative trim/source manifest

This is a high-value change.

The current slow-motion incident occurred partly because capture-rate information was lost by the trim/remux path.

Do not make the analyzer depend on the remuxed file preserving device-specific metadata.

Before trimming, create a tiny metadata record from the original asset:

```json
{
  "source": {
    "container_duration_ms": 41600,
    "presentation_fps": 30.0,
    "capture_fps": 240.0,
    "capture_fps_source": "device_metadata",
    "slowmo_factor": 8.0,
    "width": 1920,
    "height": 1080,
    "codec": "h264"
  },
  "trim": {
    "requested_real_start_ms": 12340,
    "requested_real_end_ms": 17540,
    "requested_file_start_pts": "...",
    "requested_file_end_pts": "...",
    "actual_remux_start_pts": "...",
    "actual_remux_end_pts": "..."
  },
  "client_detection": {
    "audio_candidates": [
      {"time_ms": 14930, "score": 0.91},
      {"time_ms": 9180, "score": 0.42}
    ],
    "user_adjusted_trim": false
  }
}
```

The analyzer may use the **capture/timeline metadata**.

It should **not use the user's selected mark as impact evidence**.

This manifest also gives you reproducibility when Android/iOS container tags behave differently.

---

## 6.6 Add a local pre-upload guard

Immediately after the remux, but before R2 upload, probe the actual trimmed file.

Validate:

```text
real-world duration is plausible
file-timeline duration is consistent with slow-mo mapping
capture rate is known or explicitly unknown
frame count is plausible
file size is under guard
width/height are allowed
video stream exists
audio presence is recorded
trim boundaries are valid
```

If the device claims:

```text
real swing duration = ~5.2 s
capture fps = 240
```

but the trim metadata implies thousands of unexpected analysis frames or an impossible duration mapping, fail locally and repair/retrim before uploading.

The server must repeat these checks because the client is not trusted, but local preflight prevents wasting:

- upload time
- R2 operations
- queue work
- GPU cold starts
- user waiting

---

# 7. Can the upload itself be made faster?

Possibly, but I would not change the media format yet.

The current architecture already has a major advantage:

> the trimmed source uploads directly to R2 and never transits the Next.js API.

I would keep that.

## Experiment: overlap upload with analyzer startup

One latency optimization is to hide GPU/container startup under network upload.

Conceptually:

```text
user presses Upload
    |
    +-> direct video upload to R2
    |
    +-> API creates/prepares analysis job
         -> container/model startup begins
             -> waits for "media ready"
```

The potential win is simple:

```text
current:
upload + cold start + analysis

overlapped:
max(upload, cold start) + analysis
```

However, warming a GPU while it waits for media can cost money.

Modal exposes `scaledown_window`, `min_containers`, and `buffer_containers`, all of which trade cold-start latency for extra resource consumption.

### Recommendation

Benchmark, do not assume.

Test:

1. baseline scale-to-zero;
2. longer `scaledown_window` during a user's practice session;
3. `buffer_containers=1` during active load;
4. prepare/warm concurrently with upload;
5. permanent `min_containers=1`.

Measure:

```text
p50/p95 upload-complete -> first GPU inference
p50/p95 user-confirm -> analysis-ready
extra cost per swing
wasted warm starts from canceled uploads
```

For practice sessions, a longer scaledown window or active buffer may be more efficient than a permanent warm L4.

Modal references:

- https://modal.com/docs/guide/cold-start
- https://modal.com/docs/guide/scale

---

# 8. Ground truth additions for the pre-upload system

The trim stage needs its own evaluation data.

Do not evaluate it on whether it guessed the exact impact frame.

That is not its job.

### Label each raw clip with

```text
true swing selected
true impact time
address/start time
finish/end time
all actual ball-strike times if multiple
practice-swing intervals
audio quality
range-noise severity
walking/phone-handling severity
slow-mo mapping
```

### Product metrics

| Metric | Meaning |
|---|---|
| **Impact-in-window rate** | True impact survived the trim |
| **Full-swing-in-window rate** | Required address through finish survived |
| **Auto-seed accept rate** | User did not need to correct |
| **Wrong-swing rate** | System chose practice/wrong strike |
| **Silent-audio recovery rate** | Sparse visual fallback found the swing |
| **Catastrophic trim rate** | Real swing/impact was cut out |
| **Time-to-preview p50/p95** | Perceived speed |
| **Fallback invocation rate** | How often visual work is needed |
| **On-device fallback time** | CPU/decode cost when used |
| **Battery/thermal impact** | Important for repeated practice-session use |

### Initial release gate

The pre-upload system should optimize primarily for:

1. catastrophic trim rate approaching zero;
2. reduced manual-correction rate;
3. no meaningful regression in high-confidence audio time-to-preview.

---

# 9. Final recommendation

The combined plan is stronger than either research package by itself.

The target architecture should be:

```text
ON DEVICE
raw clip
    -> metadata extraction
    -> fast audio candidate pass
    -> conditional low-rate motion fallback only if needed
    -> user reviews rough 5 s window
    -> optional manual correction
    -> window sanity check
    -> lossless/remux trim
    -> local media/slow-mo preflight
    -> trim/source manifest
    -> direct R2 upload

SERVER
immutable frame/timestamp manifest
    -> coarse body/event/quality pass
    -> adaptive refinement planner

        body:
            ~30 Hz coarse
            up to ~60 Hz refinement
            direct inference on scoring-critical frames

        club:
            sparse full-frame region detector
            native-HFR high-resolution five-keypoint crop pose
            multiple candidate retention
            sequence-level solver
            honest gaps

        ball:
            setup + impact neighborhoods

        events:
            coarse temporal detection
            native-frame refinement

        impact:
            calibrated audio + club + ball + body fusion
            independent of user trim mark

    -> metrics/scoring with provenance gates
    -> progressive analysis revisions
    -> analysis_ready
    -> optional presentation rendering later
```

## What I would implement first

1. **Pre-upload trim/source manifest + local preflight**
2. **Server frame manifest with source/playback PTS**
3. **Ground-truth/evaluation harness for club, events, and trim**
4. **Adaptive per-stage frame planner**
5. **CADDIE-style five-keypoint club prototype**
6. **Direct-only scoring provenance**
7. **Native-frame event/impact fusion**
8. **NVDEC + batching + TensorRT benchmark**
9. **Conditional on-device visual trim fallback**
10. **Upload/cold-start overlap experiment**
11. **Blur-aware club experiment**
12. **Progressive result revisions**

The implementation order intentionally makes the data contract and accuracy measurable before spending large engineering effort on low-level optimization.

---

# Primary sources checked

- SwingSage current-system problem brief supplied by the product owner
- Existing SwingSage deep-research implementation plan
- CADDIE, CVPR Workshops 2026: https://openaccess.thecvf.com/content/CVPR2026W/CVsports/html/Jung_CADDIE_Compact_Adaptive_Detection-Driven_Inference_for_Real-Time_Golf_Club_Pose_CVPRW_2026_paper.html
- CADDIE project results: https://cjung5.github.io/CADDIE/
- MMPose RTMW official model table: https://github.com/open-mmlab/mmpose/blob/main/configs/wholebody_2d_keypoint/rtmpose/cocktail14/rtmw_cocktail14.md
- GolfDB / SwingNet, CVPR Workshops 2019: https://openaccess.thecvf.com/content_CVPRW_2019/html/CVSports/McNally_GolfDB_A_Video_Database_for_Golf_Swing_Sequencing_CVPRW_2019_paper.html
- ByteTrack: https://arxiv.org/abs/2110.06864
- OC-SORT: https://arxiv.org/abs/2203.14360
- NVIDIA/Modal runtime guidance and current Modal autoscaling documentation
- Android MediaMetadataRetriever: https://developer.android.com/reference/android/media/MediaMetadataRetriever
- FFmpeg documentation: https://ffmpeg.org/ffmpeg.html
