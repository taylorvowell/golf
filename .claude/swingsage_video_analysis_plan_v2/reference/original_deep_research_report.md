# Golf Swing Analyzer Video Analysis Research and Implementation Plan

## Executive conclusion

The highest-value redesign is **not simply a faster pose model or a bigger GPU**. It is to change the unit of work from "run every analyzer on every playback frame" to **"preserve every real frame, but spend inference only where each subsystem needs it."**

That distinction solves the core conflict between 240 fps capture quality and processing cost:

> **Playback frame rate, source frame identity, and model inference rate should be independent concepts.**

A genuine 240 fps recording should retain all 240 captured samples per second for frame-exact playback, scrubbing, club analysis, and future re-analysis. But whole-body pose, silhouette segmentation, ball detection, event spotting, and even full-frame club detection do not need to run uniformly on every one of those samples.

The current measurements make this particularly important. At the reported 26.1 ms per pose frame, 500 pose inferences account for about **13.05 seconds** of raw pose computation, while the measured end-to-end job is **124.6 seconds**. That means raw pose inference represents only about 10.5 percent of that measured wall time. At 1,200 frames, pose itself extrapolates to about **31.3 seconds**, which by itself does not explain a projected five-to-twelve-minute HFR analysis. The larger optimization opportunity is architectural: club processing, unnecessary per-frame work, preprocessing/transfers, frame-by-frame execution overhead, rendering/encoding, and the coupling of every subsystem to the full frame count. The current brief also establishes that club accuracy presently lacks positional ground truth and that at least one visual impact estimate was wrong by 40 frames, so optimizing latency without first making these outputs falsifiable would be risky. fileciteturn0file0

My recommended target is a **hierarchical coarse-to-fine analyzer**:

```text
Source video
    |
    v
Frame/timestamp manifest + audio extraction
    |
    v
Fast coarse pass
    |
    +--> golfer ROI
    +--> coarse body pose
    +--> view / quality
    +--> coarse events
    +--> active swing interval
    |
    v
Adaptive refinement planner
    |
    +-------------------+------------------+
    |                   |                  |
    v                   v                  v
Body refinement     Club refinement     Ball windows
30/60 fps           native HFR          address/impact
+ forced frames     sparse detector
                    dense crop pose
    |                   |                  |
    +-------------------+------------------+
                        |
                        v
             Multimodal impact fusion
                        |
                        v
              metrics + scoring
                        |
                        v
                ANALYSIS READY
                        |
                        v
             optional media rendering
```

This architecture is not just theoretical. The most relevant new research I found is **CADDIE**, published at the CVsports Workshop at CVPR 2026 specifically for golf-club pose estimation. It uses a compact two-stage detector plus five-keypoint club-pose model. The authors report 88.52 percent PCK@5px and 69 FPS end-to-end on their RTX 3090 benchmark. More importantly for SwingSage, when they run their global club detector only every fifth frame while continuing crop-based pose processing between detections, reported throughput rises to 185 FPS with essentially unchanged PCK on their dataset. At a detector interval of 10, they report 218 FPS with only a 0.27 percentage-point PCK reduction. citeturn18search0turn18search1

That is unusually strong, golf-specific evidence for the central architecture change I recommend: **sparse expensive global localization, dense cheap local club geometry.**

## Recommended target architecture

The new system should create an immutable **frame manifest** before analysis. Every actual encoded video sample gets a stable source-frame ID, source timestamp, real-capture timestamp when known, and playback-frame mapping. Analysis outputs reference those IDs rather than assuming that "analysis frame N" must have been passed through every model.

This solves several problems at once.

A normal 30 fps video can remain 30 fps instead of duplicating frames into a nominal 60 fps analysis stream. A real 240 fps clip keeps all 240 fps samples. A phone slow-motion recording can distinguish the capture clock from its intentionally slowed presentation clock. A playback transcode can change timestamps without breaking coach corrections or geometry, provided the frame mapping remains one-to-one. Most importantly, the client can remain frame-exact even when, for example, body geometry was directly observed only once every four playback frames.

### The default observation strategy

My recommended starting policies are:

| Subsystem | Proposed default | Reason |
|---|---|---|
| Source frame identity | Every real frame | Required for exact playback and reproducibility |
| Coarse body | About 30 Hz, full clip | Enough to understand ROI, motion and candidate phases |
| Final body | Up to 60 Hz over active swing | Much cheaper than uniform 240 Hz |
| Scoring-critical body frames | Direct inference regardless of cadence | Prevent interpolation from contaminating scoring |
| Club global detector | Approximately every 5 native frames after lock | CADDIE provides directly relevant evidence for this pattern citeturn18search0 |
| Club crop keypoints | Every native HFR frame during active swing | This is where 120/240 fps has the strongest information value |
| Ball detector | Setup window plus impact window | No reason to run throughout a five-second clip |
| Silhouette | Setup/address frame set | Primarily a setup geometry problem |
| Event model | Coarse first, native-fps local refinement | Preserves exact event precision without full uniform compute |
| Burn-in/share rendering | After analysis-ready | Does not improve interactive geometry |

The 30 Hz and 60 Hz body rates are **experiment starting points**, not assumptions that those rates are always sufficient. Their validity must be established against golf-specific body and angle ground truth. The architecture is intentionally able to densify to 120 or 240 fps whenever the measurements prove that a particular joint, phase, or scoring rule benefits from it.

There is supporting research for this general adaptive-compute strategy beyond golf. AdaSpot, published at CVPR 2026, specifically addresses precise sports-event localization by combining low-resolution global video processing with selectively allocated high-resolution processing, rather than processing the entire video uniformly at maximal resolution. citeturn18academia48turn18search12 T-DEED likewise emphasizes high temporal output resolution and multi-scale temporal context for precise sports event spotting. citeturn18search10

### Direct observations versus display interpolation

A crucial contract change is that the system should distinguish:

```text
model
tracked
propagated
derived
manual_correction
missing
```

For example, at 240 fps with 60 Hz body inference:

```text
Playback:       0   1   2   3   4   5   6   7   8
Body source:    M   P   P   P   M   P   P   P   M
Club source:    M   M   M   M   M   M   M   M   M
```

`M` is a direct model observation. `P` is a propagated display point.

That still gives the client an overlay for every scrubbed frame. It does **not** mean the application claims the body was independently measured at all 240 frames per second.

More importantly, the scoring engine can declare `direct_only: true` for sensitive measurements. Once impact is refined to frame 612, frame 612 is forcibly added to the body inference plan. The final knee angle at impact therefore comes from a direct pose observation on frame 612, regardless of whether the normal 60 Hz sampling schedule would have selected that frame.

This is how the system reduces compute **without reducing the evidentiary standard of scored measurements**.

## Club tracking should be rebuilt around club pose

Club tracking is the area where I recommend the largest departure from the existing architecture.

CADDIE's five-point representation is particularly attractive because it directly represents the object SwingSage actually cares about: grip, shaft, neck/hosel, and the club head. The published system uses a high-resolution 360×360 club crop and a heatmap plus subpixel-offset keypoint head, rather than reducing the club to a single object box. CADDIE reports a 14.3 million parameter system and substantially higher PCK on its GolfClub benchmark than the YOLO-pose, HRNet, and ViTPose configurations it evaluated. citeturn18search0turn22search10

### Proposed club pipeline

```text
Full frame
    |
    v
High-recall club-region detector
    |       runs sparsely
    v
Crop position predictor / interpolation
    |
    v
High-resolution club crop
    |
    v
5-keypoint club pose
    |       runs native fps in active window
    v
Multiple candidates + confidence
    |
    v
Sequence-level path solver
    |
    +--> grip
    +--> shaft
    +--> neck
    +--> head geometry
    +--> observed/missing state
    |
    v
Trace
```

This has several advantages over "detect club head, separately find a shaft, then make the head valid only if the two happen to agree."

First, the geometry of the club becomes internally testable. The grip should have a plausible relation to the golfer's hands. Shaft direction and apparent length should evolve coherently. The neck/head relationship provides additional evidence against convincing false positives.

Second, **global full-frame detection becomes a crop-acquisition problem rather than the final geometric measurement**. If the detector is only needed to keep a generous crop centered on the club, its location can be interpolated between detector frames much more safely than the club-head point itself.

Third, the detector can operate adaptively. A reasonable first policy is every five frames while locked, every frame while reacquiring, and perhaps a tighter cadence around impact if internal evaluation proves that helpful. CADDIE's authors report a detector-interval experiment that directly supports this class of optimization, although SwingSage must reproduce the tradeoff on its own devices, golfers, views, and clubs before adopting the exact stride. citeturn18search0

### The trace should be solved globally, not smoothed locally

The trace should not simply choose the highest-confidence point independently in every frame.

Instead, produce multiple plausible candidates and solve the sequence with a Viterbi-like dynamic program or equivalent graph optimization. Its objective can incorporate model confidence, shaft evidence, grip proximity to the hands, apparent club-length consistency, plausible velocity/acceleration, swing-phase direction, and hard rejection of impossible jumps.

Conceptually:

```text
score(path) =
    detector / pose evidence
  + shaft image evidence
  + grip-to-hands consistency
  + club-length consistency
  + velocity continuity
  + angular-motion continuity
  - impossible-jump penalties
```

This is different from visually smoothing a bad track. It asks which **observed candidate sequence** is most consistent with all available evidence.

Missing evidence should remain missing. Dashed uncertainty segments remain a sound UI representation. An interpolated club position should never silently become a measured point.

Fast-sports-object research is also worth testing as an auxiliary source. TrackNetV4 explicitly incorporates motion information to improve tracking of tiny, high-speed objects under blur and partial occlusion, while TrackNetV5 adds signed motion-direction information and spatiotemporal refinement. These are not golf-club solutions, but they make motion-aware crop features a worthwhile controlled experiment for the club head near impact. citeturn17academia26turn17academia24

General point trackers such as TAPIR and CoTracker should be treated as **secondary candidate generators**, especially across short occlusions, rather than immediately made the authoritative tracker. Their outputs should have separate provenance and must earn their place through the internal club ground-truth benchmark.

## Impact, events, and scoring should become confidence-driven

The existing architecture makes impact too dependent on the club trajectory even though the product already has multiple independent signals. The known 40-frame error demonstrates why that is dangerous: impact sets downstream phase boundaries and therefore contaminates tempo and scoring when wrong. fileciteturn0file0

I recommend turning impact into an explicit **multimodal fusion problem**.

For each candidate native frame within a narrow coarse impact window, calculate:

```text
audio transient likelihood
club-head / ball proximity
club speed
club trajectory direction
ball presence before
ball absence / flight evidence after
downswing phase prior
confidence of each source
```

Then fit a small, calibrated and inspectable fusion model such as logistic regression or a compact gradient-boosted classifier.

The result should look conceptually like:

```json
{
  "event": "impact",
  "frame": 612,
  "confidence": 0.94,
  "search_window": [598, 625],
  "evidence": {
    "audio": 0.91,
    "club": 0.87,
    "ball": 0.76,
    "body_phase": 0.64
  }
}
```

Audio should no longer be only a post-hoc witness. It is extremely useful for **narrowing the visual search interval**, although precise use requires measuring audio/video timestamp offset for each capture/import path. The final geometry can still remain video-derived.

Event detection should follow the same coarse-to-fine architecture. A cheap temporal model identifies likely address, takeaway, top, impact, and finish neighborhoods. Only those neighborhoods are re-examined at native frame rate. This is aligned with recent precise-event-spotting research, which explicitly aims to preserve strict temporal localization without spending the highest resolution uniformly across the video. citeturn18search12turn18search10

Scoring then needs one additional rule: **every scoring check declares what provenance it accepts.**

For example:

```yaml
id: lead_knee_flex_at_impact
required_event: impact
geometry:
  direct_only: true
min_keypoint_confidence: 0.75
min_event_confidence: 0.80
```

A propagated body point can make the scrubber look smooth while still being prohibited from determining a user's score. That separation is important.

## Latency, GPU efficiency, and perceived speed

There are several independent opportunities to reduce actual wall time.

### Batch inside each swing

A five-second video is a batch workload even though the product is latency-sensitive. Instead of executing a GPU model once per Python frame, feed batches of frames or crops.

NVIDIA's current TensorRT guidance calls batching a primary throughput optimization but also explicitly recommends testing several batch sizes because the optimum depends on model shape and hardware, including on Ada-generation GPUs. citeturn20search0turn20search2

For each body and club model I would benchmark:

```text
batch = 1, 4, 8, 16, 32
```

**Intra-clip batching** is preferable to waiting for unrelated user requests because it improves GPU utilization without deliberately adding queue latency.

### Keep decoded frames on the GPU

NVIDIA's current PyNvVideoCodec decoder supports returning decoded video in device memory. That makes a pipeline such as the following technically viable: citeturn18search9

```text
NVDEC
 -> GPU frame
 -> GPU crop / resize
 -> batched inference
 -> compact output
```

That should be benchmarked against the current decode/preprocess path. The benefit is not guaranteed, but avoiding repeated CPU decoding, resizing, array creation and host-to-device copies is a credible optimization path.

### Optimize inference only after changing the workload

After adaptive sampling and club redesign, benchmark:

```text
PyTorch baseline
PyTorch FP16
torch.compile
ONNX Runtime CUDA
TensorRT FP16
```

NVIDIA's guidance explicitly treats performance optimization as a measure-first loop and documents an accuracy/performance tradeoff for reduced precision. Therefore, an exported FP16 or quantized engine must pass the same golden-set geometry tests as its PyTorch parent rather than being assumed numerically equivalent. citeturn20search0turn20search2

I would **not prioritize INT8** for club/body geometry until architecture, batching and FP16 have been exhausted. Subpixel localization is exactly the sort of output where a small numerical degradation could matter to the user.

### Benchmark dollars per accepted swing, not just FPS

Modal currently lists the L4 at **$0.000222 per second**, T4 at $0.000164, A10 at $0.000306 and L40S at $0.000542, with CPU and memory charged separately. citeturn19search0

At today's listed L4 price, the approximate GPU-only cost is:

| GPU runtime | L4 GPU cost |
|---:|---:|
| 30 s | $0.00666 |
| 60 s | $0.01332 |
| 90 s | $0.01998 |
| 120 s | $0.02664 |
| 180 s | $0.03996 |

This suggests that a final 240 fps analysis around 60 to 90 GPU-seconds could plausibly fit in the low-single-cent GPU range before CPU/memory charges. That is an engineering target, not a prediction of the finished implementation.

A T4 might be slower but cheaper. An A10 might finish faster but cost more. An L40S might reduce latency substantially but is currently more than twice the L4's per-second price. The only valid selection test is:

```text
dollars per swing
subject to
  club accuracy >= gate
  body accuracy >= gate
  event accuracy >= gate
  latency <= SLO
```

### Cold starts come later

Modal's current memory-snapshot feature can bypass some initialization and JIT work and the company reports meaningful reductions on initialization-heavy workloads. However, its documentation also warns that GPU memory snapshots do **not necessarily speed up model-weight loading** when storage bandwidth is the bottleneck. citeturn19search1

So cold-start optimization should happen only after measuring its contribution. A six-second cold start is worth improving after a 120-second pipeline becomes a 30-second pipeline. It is not the first problem to attack today.

### Result-ready should not mean rendering-ready

Because the interactive clients already draw overlays, contact sheets and burn-in/share videos should not sit on the geometry critical path.

I recommend distinct states:

```text
uploaded
media_ready
coarse_ready
body_ready
club_refining
analysis_ready
presentation_rendering
complete
```

`analysis_ready` means events, geometry, metrics and scores required for interactive review are final. Presentation encoding can continue afterward.

That improves both actual and perceived speed.

For perceived latency, the system can also publish a coarse preview before club refinement completes. The user could see filming-quality feedback, a provisional skeleton and approximate event markers while the native-rate club solve continues. Provisional results must be visually identified as such and replaced atomically by a final revision.

## Ground truth is the prerequisite for real accuracy work

The largest research conclusion besides adaptive inference is that **the next club-tracking optimization should be an evaluation-system project before it is an algorithm project**.

The external ecosystem reinforces this. CADDIE trained/evaluated with a roughly 72,000-frame golf-club dataset using a five-keypoint representation. citeturn21search3 GolfPose provides golf-specific golfer-plus-club pose models and requires authorization for its dataset. citeturn21search2 CaddieSet contains 1,757 shots across face-on and down-the-line views and is MIT-licensed at the repository level, although its published joint features are automatically extracted rather than manually labeled body ground truth. citeturn21search1 GolfDB remains useful for event-spotting research but its official repository states a CC BY-NC 4.0 license, which means it should not be casually pulled into commercial production training without licensing review. citeturn21search0 ClubheadDB similarly advertises more than 10,000 hand-annotated clubhead frames under CC BY-NC 4.0, making it useful as a research reference but not automatically suitable for commercial training. citeturn22search0

The long-term competitive asset should therefore be a **SwingSage-specific consented labeled corpus**.

I recommend three tiers:

| Dataset | Purpose |
|---|---|
| Frozen golden set | Every commit/model/runtime regression |
| Development set | Training, threshold selection, active learning |
| Untouched shadow holdout | Final pre-release generalization |

The split must be by golfer and source recording, never randomly by adjacent frames.

For club labels, use the same general five-point geometry: grip, shaft midpoint, neck/hosel, head-inner and head-outer, plus visibility, occlusion, blur and out-of-frame states.

The critical metrics should include spatial accuracy rather than coverage:

```text
PCK@2 / 5 / 10 px
median and p95 keypoint error
error normalized by club length
head-center error
shaft angular error
visible-frame precision / recall
false-positive rate
confidence calibration
impact-window error
catastrophic jump rate
reacquisition time
```

Events should report **both frames and milliseconds**, including median, p90/p95, exact-frame rate, ±1, ±2 and ±4 frame rates, plus catastrophic misses. A single 40-frame error must remain visible instead of disappearing into a mean.

Body evaluation should focus on downstream geometry, not generic pose AP alone: shoulder, hip, knee, elbow, wrist and hand error at scored phases, plus angle MAE and p95 angle error.

Scoring itself needs expert-labeled pass/fail/abstain outcomes. The most important product metric is not merely score agreement. It is the rate of **wrong, high-confidence judgments**.

The documents define an experiment matrix across 30/60/120/240 fps, face-on/down-the-line, club type, indoor/outdoor, lighting, blur, device and occlusion severity.

## Implementation sequence and acceptance targets

I recommend implementing in this order:

```text
instrumentation
    ↓
timeline/frame-manifest v2
    ↓
per-subsystem observation planner
    ↓
coarse body/event pass
    ↓
adaptive body refinement
    ↓
club ground truth + evaluator
    ↓
5-keypoint club pose model
    ↓
club temporal sequence solver
    ↓
event local refinement
    ↓
multimodal impact fusion
    ↓
batch/decode/runtime optimization
    ↓
progressive artifacts
    ↓
deferred presentation rendering
```

This ordering deliberately postpones low-level inference optimization until the application is running the **right work**.

Suggested engineering targets are:

| Measure | Initial target |
|---|---:|
| Coarse preview p95 after upload | <20 s |
| Body/events usable p95 | <45 s |
| Final stretch target p95 | <90 s |
| Final hard SLO | <180 s |
| 240 fps GPU cost target | ≤$0.06/view initially |
| Timeline/frame mismatch | 0 |
| Propagated point represented as direct | 0 |
| Deterministic timeout blindly retried | 0 |
| Impact median error | ≤1 native frame aspirational |
| Impact p95 error | ≤2 to 3 native frames aspirational |
| High-confidence catastrophic impact miss on golden set | 0 |

The accuracy targets are intentionally marked as initial engineering gates. They should be revised after enough correctly labeled internal footage exists to establish what is realistic.

## Coder-AI deliverables

I created a complete Markdown research and implementation pack rather than only a narrative recommendation.

**[Download the complete research pack as ZIP](sandbox:/mnt/data/swingsage_analysis_research_pack.zip)**

| Document | Purpose |
|---|---|
| **[README.md](sandbox:/mnt/data/swingsage_analysis_research/README.md)** | Executive decision, architecture summary and file map |
| **[Target architecture](sandbox:/mnt/data/swingsage_analysis_research/01_target_architecture.md)** | End-to-end stage graph, service boundaries, caching, failures and progressive results |
| **[Video timeline and sampling](sandbox:/mnt/data/swingsage_analysis_research/02_video_timeline_and_sampling.md)** | HFR preservation, exact frame identity, slow-motion handling and subsystem sampling policies |
| **[Club tracking](sandbox:/mnt/data/swingsage_analysis_research/03_club_tracking.md)** | Five-keypoint architecture, sparse detector, native-rate crop pose, sequence solver and training plan |
| **[Body, events, impact and scoring](sandbox:/mnt/data/swingsage_analysis_research/04_body_events_impact_scoring.md)** | Adaptive body inference, event refinement, impact fusion and score provenance |
| **[Inference runtime and cost](sandbox:/mnt/data/swingsage_analysis_research/05_inference_runtime_and_cost.md)** | Profiling, batching, GPU decode, FP16/TensorRT, GPU selection and cost model |
| **[Ground truth and evaluation](sandbox:/mnt/data/swingsage_analysis_research/06_ground_truth_and_evaluation.md)** | Annotation schema, datasets, metrics, ablations and release gates |
| **[Implementation plan](sandbox:/mnt/data/swingsage_analysis_research/07_implementation_plan.md)** | Ordered coder-AI work packages, acceptance criteria, feature flags, rollout and rollback |
| **[Analysis contract](sandbox:/mnt/data/swingsage_analysis_research/08_analysis_contract.md)** | Proposed JSON structures for timeline identity, provenance, sparse observations, events and revisions |
| **[Research sources](sandbox:/mnt/data/swingsage_analysis_research/09_research_sources.md)** | Primary research/platform sources plus licensing cautions |

The most important implementation decision in the pack is simple: **keep the 240 fps video, stop treating 240 fps as a command to run everything 240 times per second, and spend the preserved temporal resolution primarily where it is demonstrably valuable, especially on native-rate club pose and native-frame event refinement.** CADDIE's 2026 golf-specific results provide strong external validation for sparse global club detection plus dense local pose, while AdaSpot provides independent support for adaptive high-resolution computation in precision sports analysis. citeturn18search0turn18search12