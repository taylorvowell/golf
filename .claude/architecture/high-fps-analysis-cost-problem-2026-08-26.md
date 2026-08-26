# Problem brief: swing analysis — what it does, what it costs, and where it is hard

2026-08-26. This document states a problem space for an outside reviewer. It deliberately
contains **no proposed solutions** — only what the product is trying to do, the system as it
exists, the inputs, the processing in detail, the parts that have proved hard, and the measured
numbers. The reviewer is free to weigh all of it together; the latency/cost question (§10) and
the club-tracking question (§7) may or may not have one answer.

---

## 1. What the product is trying to accomplish

SwingSage is a mobile golf-swing analysis app (iPhone and Android). A golfer records or imports
a video of one swing; the system analyzes it and returns an explainable report: a skeleton
overlay, a club-path trace, detected swing events (address, top of backswing, impact, finish),
per-frame body/club angle metrics, and a score with reasons. The golfer then scrubs the video
frame-by-frame with the overlay locked to the picture.

High-speed capture is a core differentiator, not an accessory:

- The capture requirement is **≥ 60 fps, and never silently degraded**. The in-app recorder
  requests 240 fps and falls down a real ladder (240 → 120 → 60) based on what the device
  actually configures. If a device cannot meet a mode, the app says so.
- **Frames are never faked or invented.** If the source is 30 fps, it is analyzed at 30 and the
  true rate is recorded.
- Frame-exact scrubbing is the #1 perceived-quality feature. Overlay drift during scrub has a
  **zero-frame tolerance** (it is exact or it is a bug).
- The product ships once, as a full production launch — no MVP subset. Infrastructure decisions
  target production scale.

A typical practice session is many swings in an hour (the session flow is: swing, review,
swing again). A future differentiator already in the product plan is **dual-phone synchronized
capture** — one swing filmed from two angles. In the data model a swing with two cameras is
**two views and two analysis jobs**, not one job doing half the work.

## 2. Standing constraints any answer must respect

These are recorded decisions, not preferences:

1. **Computer vision runs server-side in Python** (analyzer service). Clients only render. The
   analyzer's only output is JSON + media artifacts.
2. **Deterministic CV first; AI models never produce the geometry.** No raw video is ever sent
   to an LLM.
3. **Analysis must be explainable**, every keypoint/detection/event carries a **confidence**,
   and "cannot be evaluated" is a valid output. The system abstains rather than fabricates. A
   confident wrong number is treated as worse than no number.
4. **The current normalization rule:** clips are normalized to constant frame rate **at the
   capture rate** (240 or 120 for high-speed takes, 60 otherwise). The recorded rationale: a
   high-speed take is never resampled down, because that discards real frames the golfer
   deliberately captured. (This rule predates the cost data below and is part of what is being
   examined; it is stated here as current fact, not as immutable.)
5. Playback/scrub math depends on CFR video: `frame = round(currentTime × fps)` must be exact.
6. The analysis artifact (`analysis.json`) is a versioned, append-only contract consumed by two
   clients (mobile, web). Coordinates normalized 0–1; 49 keypoints in fixed order.
7. An analysis job's state lives in Postgres and is polled by the client; the analyzer is an
   enhancement, never a hard dependency for a swing existing (video-only swings are valid).
8. **Handedness threads through all angle math** (lead = side nearest the target), and several
   checks are **view-gated**: down-the-line and face-on cameras see different geometry, and a
   check that cannot be evaluated from the given angle abstains rather than guessing.
9. **Face angle is never stated in degrees from video** — video supports only checkpoint
   classifications (square/open/closed); degrees would require a launch monitor.

## 3. Services and topology (production, as deployed today)

| Piece | Technology | Role |
|---|---|---|
| Mobile app | React Native / Expo (Android dev build today; iOS planned) | Capture (real-time HFR up to 1080p240), trim, upload, playback + overlay rendering |
| API | Next.js on Vercel (serverless/Fluid, Hobby plan today) | Ingest (two-phase: mint rows + signed upload URL → verify + enqueue), job status polling, media routes. **No ffmpeg on this host.** |
| Database | Supabase Postgres (`swingsage-prod`) | Swings, views, jobs (status/stage/progress/log), sessions, users; RLS |
| Object storage | Cloudflare R2 (`swing-source`, `swing-artifacts`, `swing-models`) | Uploaded originals + posters; analyzer artifacts; model weights. Zero egress cost |
| Job dispatch | Upstash QStash | Delivers enqueued jobs over HTTPS to the worker; retries failed deliveries; DLQ |
| Analyzer worker | Modal (serverless GPU, scale-to-zero, per-second billing) | The Python pipeline. **L4 GPU, 8 vCPU, 16 GB RAM, one job per container, `max_containers=4`, hard `timeout=1800 s`, Modal-level retries ×2 on infrastructure death** |
| Worker events | Worker → API callback | Per-stage progress events written to the `jobs` row (stage, percent, "frame N of M" message); client polls 1.2 s → 5 s backoff, gives up listening at 12 min (job continues server-side) |

Model assets on the worker: RTMW whole-body pose model (133 sub-keypoints, reduced to the
published 49-keypoint set) and a trained YOLO club-head detector, loaded from a Modal volume
with hash verification.

## 4. The input files

The clip that reaches the analyzer is a **trimmed single swing**: the client cuts a fixed
window of ~5.2 real seconds (5 s review window + 0.1 s pad each side) around the detected
strike before uploading. The untrimmed take never leaves the phone (recorded path) or is never
uploaded (import path).

| Source | Container shape | Real duration after trim | Frames the analyzer sees after CFR normalization |
|---|---|---|---|
| In-app recording, 240 fps mode | Real-time HFR MP4, 1080p, 240 fps timeline | ~5.2 s | **~1,200–1,250** (normalized at 240) |
| In-app recording, 120 fps | 1080p, 120 fps | ~5.2 s | ~620 |
| In-app recording / import, 60 fps | 1080p or source res, 60 fps | ~5.2 s | ~310 |
| Import, ordinary 30 fps video | source res, 30 fps | ~5.2 s | ~310 (normalized at 60) |
| Import, phone slow-mo (captured 240, **written as a 30 fps timeline**) | The file's timeline runs 8× slower than the world: ~5.2 real seconds occupy ~41.6 file-seconds | ~5.2 s real | **Intended:** ~1,250 at 240 once the capture-rate metadata is carried through. **Today (known defect):** the trim's remux drops the `com.android.capture.fps` tag, the analyzer sees an ordinary 41.6 s / 30 fps clip and normalizes ~2,445 frames at 60 — treating slow-motion footage as real time |

File sizes: a trimmed 1080p240 clip is tens of MB (encoder bitrate constants are deliberately
unvalidated pending a device sweep); a 30 s untrimmed take at 1080p240 is the recorder cap.
Upload travels directly from phone to R2 via signed URL — it never passes through the API host.

Recorded audio rides along and is used only to seed the strike location (client-side trim) and
as a server-side impact witness (§8).

## 5. The pipeline stages, in order

Stage cost class is the important column. "Per-frame GPU" stages dominate everything.

| # | Stage | What it does | Cost class |
|---|---|---|---|
| 1 | Normalize | ffmpeg re-encode to CFR at the target rate; probes container facts | Per-clip, CPU, seconds |
| 2 | Pose | RTMW inference on **every frame** → keypoints with confidence (detail in §6). Measured **26.1 ms/frame** on the L4 (CUDA) | **Per-frame, GPU** |
| 3 | Club | Club-head + shaft detection on **every frame**; trace assembly (detail in §7). A "variants" sub-stage (multiple trace solutions computed and compared) exists but is **disabled in production dispatch** — it alone measured 570 s on Modal vCPUs | **Per-frame, GPU + CPU; the slowest stage** |
| 4 | Events | Address / top of backswing / impact / finish detection; audio-impact cross-check (§8) | Per-clip, cheap |
| 5 | Angles & metrics | Per-frame body/club geometry, handedness-resolved (§6) | Per-frame, CPU, cheap relative to 2–3 |
| 6 | Silhouette | Golfer outline segmentation + reference lines (e.g. the butt line) for setup overlays | Per-frame subset |
| 7 | Render | Overlay burn-in, contact sheet (`contact.jpg`), stills | Per-frame, CPU/encode |
| 8 | Scoring | Pure function of `analysis.json` + versioned scoring config (§6) | Milliseconds |

Output: `analysis.json` (+ normalized video, overlay media, contact sheet, stills) written to
R2 under a revision-addressed prefix; the swing flips to `ready`; clients re-fetch.

## 6. What the analysis extracts, in detail

**Keypoints.** 49 per frame, in a fixed append-only order: 33 native pose joints, 7 derived
(computed from natives), 8 measured, 1 derived tail (`waist`, a rendering-only point that is
never scored). Every keypoint carries a confidence; confidences are **truncated, not rounded**,
and every consumer re-applies the same minimum-confidence gate, so a point the analyzer dropped
is never resurrected by a client rounding up. Two thresholds exist deliberately: draw at
`conf > 0`, measure at `MIN_CONF` — a low-confidence point may be shown dimmed but never feeds
a number.

**Per-frame metrics** (all handedness-resolved to lead/trail, several view-gated):

- Joint flexion: knee flex (`0° = straight` convention), elbow (read through an in-plane
  projection — every 2D joint angle is projection-sensitive, so elbows are published as
  `lead|trail_arm_in_plane` rather than raw 2D angles).
- Hinge angles (interior-angle convention), spine/from-vertical angles (signed, sign flips with
  camera side), stack angles (90° = stacked).
- Shoulder and hip orientation ("rotation rods") — with explicit **abstention** where the
  camera angle cannot support the read.
- Tempo ratio (backswing : downswing time), derived from the event frames.

**Events.** Address, takeaway/top of backswing, impact, finish — each an exact frame index.
Multiple candidate signals are computed for top-of-backswing; impact is derived as described in
§8. Phase bands (backswing / downswing / follow-through) hang off the events and drive both the
UI's phase coloring and several scoring windows.

**Club.** Per-frame club-head position and shaft line, plus the assembled trace (§7), plus
ball detection at address and the ball's disappearance frame (a witness for impact).

**Silhouette.** The golfer's outline at setup and a reference "butt line" (the line through the
club's grip end at address) used for posture checks and drawn as an overlay.

**Scoring.** A versioned `scoring_config.json` defines checks with numeric bands — club-aware
(driver vs irons bands differ) and view-gated. Every report stores its
`scoring_model_version` so old reports stay reproducible. Quality gates degrade rather than
crash: catastrophically low pose confidence fails the job with a user-readable reason and
filming tips; low club coverage still succeeds but disables the trace and marks club-dependent
checks "not scored". A deferred check that abstains is preferred to a confident wrong number.

**What the AI layer adds (separately, never geometry):** coaching narrative and conversation
are generated from the finished artifact by an LLM; schema-validated with one retry and a
fallback. No model ever produces or edits the measured numbers.

## 7. Club tracking — the part that has proved genuinely hard

This is the stage that has consumed the most R&D time and remains the least settled. The facts:

- **The club head is small, fast, and motion-blurred.** At impact the head moves at
  ~100+ mph; even at 240 fps it travels a large fraction of its own size between frames, and at
  60 fps it can be a smear. Lighting, club color (dark driver heads against dark ground), and
  the shaft crossing the golfer's body all produce dropouts.
- **Two detection paths run together:** a trained YOLO club-head detector (trained on this
  project's own labelled data) and a classical pipeline (motion mask → shaft-line candidate
  extraction → chosen shaft). They disagree; a standing gating rule exists because the
  detector alone produced convincing false positives: **a head detection only counts when it
  falls inside a same-frame shaft box** — head evidence must be corroborated by shaft evidence.
- **The per-frame head and the drawn trace are different products with different failure
  modes.** Every user complaint that sounded like "club tracking is wrong" has, on inspection,
  been the *polyline* (the trace), not the per-frame head. A good per-frame detection sheet
  says nothing about whether the assembled trace looks right.
- **Gaps are drawn honestly.** Where tracking drops out, the trace renders a **dashed straight
  chord** across the gap. This is a measured decision: on held-out gaps, no reconstruction
  method tried (splines, physics-informed fits) beat a straight line — so the product shows a
  visibly-uncertain dashed segment rather than a confident invented curve. A sparse trace from
  an approved solve is treated as correct output, not something to prettify.
- **Multiple trace "solutions" exist and the winner is still an open judgment.** The variants
  sub-stage computes alternative trace assemblies for comparison; production runs with it off
  (cost, §9), and a human side-by-side verdict across the ten reference swings is an open
  work item. There is not yet a single agreed-best trace algorithm.
- **Accuracy is currently unfalsifiable.** There is no hand-labelled club-head position ground
  truth, so there is **no position-error metric**; everything tuned so far has been tuned on
  smoothness and visual inspection. Coverage percentages (what fraction of frames have a
  detection) have overstated quality three separate times — the project's own rule is to look
  at the drawn club over real frames before believing any number.

Higher frame rate interacts with this stage in both directions: more frames mean more
per-frame inference cost (§9), but also less motion blur per frame and shorter inter-frame
travel — the club stage is the one place where 240 fps plausibly buys detection quality, not
just smoother playback. No measurement currently quantifies that trade.

## 8. Impact — how the strike frame is derived

Impact matters more than any other event: tempo, phase bands, and several scoring windows are
measured from it, so an impact error poisons everything downstream.

Three independent signals exist:

1. **Client-side audio seed (trim only, never a measurement).** On-device detectors find the
   sharpest strike-like transient in the recorded audio (a strike is a whoosh *with a click*;
   a practice swing is a whoosh without one). The strongest candidate wins unless a later one
   is nearly as strong (two balls hit in one take). This seeds where the clip is trimmed and
   where the review scrubber starts — it is deliberately only "roughly right".
2. **The analyzer's impact frame** — located from the club-head trajectory (the head's low
   point / ball contact geometry), on the normalized frames.
3. **The audio witness, server-side.** The same strike transient is located in the uploaded
   clip's audio track and compared against the visual impact frame; the artifact records
   whether they agree (`audio_impact.agrees`). This witness is the only part of the event
   system with hand-labelled ground truth: five reference takes have human-labelled strike
   times (one golfer, one indoor bay — enough to reject a method, not enough to certify one).
4. Ball detection provides a further witness: the ball is present at address and disappears at
   impact; the disappearance frame is extracted and comparable.

**Known accuracy state, stated plainly:** on one of the ten reference swings the stored visual
impact is wrong by **40 frames** (the ball leaves at 5.08 s; the artifact says 5.75 s) — caught
by the audio witness. Hand-labelled ground truth for *all* event frames does not exist yet; an
earlier claim of "verified ±2 frames" event accuracy was found false (address was 48 frames
early on a fixture). Event-frame ground truth is an accepted prerequisite for trusting or
tuning any of this.

## 9. How the trace and overlay reach the screen

Context for any answer that touches frame rate: the client renders everything, and its budget
is real.

- The overlay (skeleton, trace, markers) is drawn by the mobile app over the video per frame,
  at up to 60 Hz during playback, with a measured **99.2 % frame-lock** using plain view
  primitives (a GPU canvas library was evaluated and rejected on measurement).
- The trace polyline is **simplified before drawing** (Ramer–Douglas–Peucker in screen pixels,
  endpoints kept exact); the number of drawn segments is treated as the cost of a frame and is
  instrumented. Fully-revealed portions of the trace are computed once per artifact and cached;
  only the currently-growing piece is recomputed per frame.
- Client-side trace smoothing exists as a display concern (unit-tested separately from the
  analyzer's own solve) — the drawn line may be smoothed for legibility, but gaps stay dashed
  (§7) and the underlying measured positions are never altered.
- Frame indexing must stay exact end-to-end: the seek target is platform-specific
  (`frame/fps` on Android, `(frame+0.5)/fps` on web — the two platforms' decoders resolve
  seeks differently, measured), and the overlay's frame math assumes the analysis frames and
  the playback file's frames are the same indices. **The normalized CFR file is currently both
  the analysis input and the playback asset.**
- Hand corrections (a coach dragging a keypoint) are stored in the database and merged onto the
  artifact at render time by frame — the artifact itself is immutable per revision.

## 10. Measured performance and cost

All measured on the production worker class (Modal L4) unless noted.

| Measurement | Value |
|---|---|
| Pose inference | 26.1 ms/frame (CUDA-verified) |
| End-to-end, ~450–500-frame clip (60 fps class), production shape (variants off) | **124.6 s** |
| Same clip, variants on (dev shape) | 676.6 s |
| End-to-end, ~460-frame 240 fps recorded take | ~110 s (one data point) |
| The 2026-08-26 incident: four ~2,445-frame clips (the slow-mo defect, §4) | 30+ min each; the first hit the 1800 s timeout at the render stage and died; ~75 GPU-minutes burned across four jobs before manual stop; Modal's ×2 retry policy would have re-run each timed-out job |
| Estimated correctly-handled 240 fps swing (~1,200 frames), extrapolated — **no direct measurement exists** | roughly 5–12 min |
| Cost, 60 fps class swing | ~$0.03–0.05 (L4 per-second billing) |
| Cost, 240 fps swing (extrapolated) | ~$0.15–0.25 |

Operational guards that exist today: 1800 s job timeout, `max_containers=4` concurrency cap,
variants off in production. Known gaps observed in the incident: nothing refuses an oversized
clip before the GPU stages; a timeout death is retried as if transient; the designed 900 s
heartbeat orphan-sweeper did not settle a silent job in production.

## 11. The problem, stated broadly

**Latency and cost scale linearly with frame count; frame count scales linearly with capture
rate; capture rate is the product's headline feature — and the highest-value use of those extra
frames (club tracking, §7) is also the pipeline's hardest and least-verified stage.**

Concretely:

- The recorded SLO is **p95 < 180 s upload-complete → result-ready** (p99 < 300 s). A 60 fps
  swing meets it (~125 s). A 240 fps swing at ~1,200 frames is projected at 5–12 minutes —
  **3–6× over the SLO** — and the SLO document itself already flags the target as "not known
  to be achievable" for high-frame-count clips.
- A practice session is many swings per hour per golfer; dual-phone capture doubles jobs per
  swing. Whatever the per-swing number is, the session experience multiplies it.
- Per-swing GPU cost rises from a few cents to ~$0.15–0.25 at 240 fps, against a subscription
  business model.
- The golfer-facing experience during the wait: the swing's video is watchable and scrubbable
  immediately (before analysis), with a live staged progress bar (stage, percent, frame
  counter). Only the *analysis* — overlay, trace, events, metrics, score — arrives late.
- The frames analyzed and the frames played back are currently the same thing by construction
  (§2.4, §9): one CFR file serves both, and the overlay's zero-drift guarantee is built on
  their indices being identical.
- Club tracking (§7) is simultaneously the strongest argument *for* high frame rate (less blur,
  shorter inter-frame travel), the dominant per-frame cost, and the stage with no ground-truth
  accuracy metric to measure any trade against.
- Impact (§8) inherits whatever the club stage produces, has one known 40-frame error among ten
  reference swings, and every downstream number keys off it.

The question being put to the reviewer: **given this system, these constraints, these
capabilities, and these measurements, how should high-frame-rate swings be captured, analyzed,
and played back** so that capture quality, analysis quality (especially club tracking and
impact), frame-exact playback, latency, and unit cost are traded deliberately rather than by
accident?

## 12. Adjacent known defects (context, being fixed separately)

- The slow-mo import metadata loss described in §4 (capture-fps tag dropped by the trim remux)
  is a bug with a planned fix (carry the capture rate through ingest); it is *not* the problem
  this document asks about, but it is what exposed the scaling behavior.
- The orphan sweeper and refuse-oversized-clips guards named in §10 are accepted work items.
