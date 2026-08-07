# Research Brief: Club-Head Tracking & Swing Tracing

> **How to use this file:** copy everything below the horizontal rule into your research AI.
> Parts 1–3 are the environment it will be building in. Part 4 is the task. Part 5 is the
> output format.

---

# PART 0 — YOUR ROLE

You are a computer-vision and applied-ML research engineer. You are being asked to design
approaches for club-head tracking and swing-path tracing in an existing golf swing analysis
application, and to say how each one would be built and tested.

You have not seen this codebase before. Parts 1–3 describe the environment: what the product is,
the stack, the data you have to work with, and the constraints any solution has to live inside.
They deliberately do **not** describe how the current tracker works or what has been tried
before — the intent is that you approach this fresh and reason from the problem, not from the
existing implementation.

**Research anything you need to.** Recent literature and practice on small fast object tracking,
motion-blur handling and deblurring, sports ball/club tracking, point tracking and video object
segmentation, learned optical flow, trajectory optimisation and physics-constrained fitting,
curve fitting and smoothing, broadcast-quality path rendering, VLM-assisted vision — whatever is
relevant. Cite what you draw on.

Part 4 is the request in the product owner's own words. Deliver what Part 5 asks for.

---

# PART 1 — THE PRODUCT AND THE STACK

**SwingSage** is an upload-based golf swing analysis app. A golfer uploads a 3–15 second phone
video of a swing. The system analyses it offline — batch processing, never live capture — and
returns a player UI that draws a skeleton overlay, a club-head swing-path trace, a swing event
timeline, metrics and a scorecard over the video.

## Two services

- **`services/analyzer/`** — Python 3.13/3.14 worker. **All computer vision lives here.** This is
  a fixed architectural constraint: the frontend renders, it never computes CV.
  Available: ffmpeg 9, OpenCV 5, MediaPipe 1.0, RTMlib/RTMPose via ONNX Runtime, Ultralytics
  YOLO 8.4, NumPy 2.5, SciPy, PyTorch 2.13 + CUDA 12.6.
- **`apps/web/`** — Next.js 16 App Router, TypeScript, Tailwind v4. The player: a `<video>`
  element with a stack of canvas overlays drawn on top of it. Postgres via Drizzle.

## The contract between them

The analyzer's output is **`analysis.json` per swing** — one artifact, the single contract
between backend and player.

- All coordinates **normalized 0–1** (x right, y down) so the client scales to any canvas size.
- The artifact must be renderable with **no client-side computation beyond coordinate scaling**.
  Anything derived belongs in the analyzer.
- Fields are **append-only**. New fields are fine; existing published fields keep their meaning.
- Every measurement carries a **confidence**.

The player also supports **render-time variants**: the analyzer can write several alternative
solutions into one artifact and the UI switches between them instantly without re-analysing.
This is an existing capability you may use.

## Hardware

Development machines are Windows. One has a **GTX 1080 (8 GB, CUDA 12.6)** — a 40-epoch YOLO
fine-tune at 640px on a few thousand images takes roughly 2 hours there. CPU-only training of the
same is roughly 25 hours. Long per-swing processing times are acceptable for a test.

---

# PART 2 — THE DATA YOU HAVE TO WORK WITH

## Video

Stage 0 normalises every upload with `ffmpeg -fps_mode cfr -r 60`, producing:
- `normalized.mp4` — 1080px short side, the file the player shows.
- `analysis.mp4` — 720px short side, the file CV consumes.

Both are **constant frame rate at 60fps**, so `frame = round(currentTime * fps)` is exact and the
overlay stays frame-accurate during scrubbing.

**A consequence that matters:** most source footage is 30fps, so after normalisation every frame
is duplicated. Two genuinely distinct source frames land 1–3 output frames apart. Some footage is
shot in slow motion at the source, so effective temporal resolution varies clip to clip.

## Pose

A wholebody pose model runs per frame and is available as an input to any stage that wants it. It
produces 49 published keypoints per frame with per-keypoint confidence, including hand/knuckle
landmarks, and a derived `grip_center` where the hands hold the club. Coverage is high on all
joints across the fixture set. Pose runs before club tracking, so its output is available.

A per-frame silhouette (the golfer's outline) is also produced and stored in a separate artifact.

## Swing events

Eight events are detected and published in `analysis.json`, following the GolfDB convention:

```
address → toe_up → mid_backswing → top → mid_downswing → impact → mid_follow_through → finish
```

Strict ordering is an enforced invariant of the artifact. These eight are consumed by the metrics
stage, the checkpoint stage and the scorecard, so they need to keep being published — but **how
they are determined is open**, and a proposal may replace or refine that.

The player collapses these eight into a smaller set of marks and spans for the scrub bar and for
colouring the trace.

`playback_window` bounds playback to the swing rather than the whole file, pinned to
`address − 1s … finish + 1s` on every clip so that two swings compared side by side have the same
playhead meaning in both panes.

## Fixtures

Nine committed clips in `instructions/swing/`: `swing1`, `swing2`, `perfect`, `pro_2`, `6iron-1`,
`6iron2`, `6iron3`, `7wood-1`, `7wood-2`.

They span a range: a junior against an open range background, an adult against close busy
foliage, a slow-motion reference pro swing, and a fast swing where the club head moves roughly
90px per frame through impact and smears into the turf. All are **down-the-line or oblique, all
right-handed** — there is no face-on and no left-handed clip in the set.

Handedness is threaded through the pipeline and any geometry has to mirror correctly for a
left-handed golfer, even though no such clip exists yet to test against.

## Test suite

40 tests, sub-second, no video or GPU needed. They replay the deterministic stages over frozen
pose and club output committed as compressed JSON, so the suite is hermetic. Golden snapshots
plus contract invariants (keypoint order, normalized coordinates, strict event ordering,
playback window containment).

---

# PART 3 — WHERE THINGS PLUG IN

```
services/analyzer/
  swingsage/
    video.py         Stage 0 — normalize
    pose.py, pose_rtm.py, postprocess.py    Stages 2/3 — pose
    club.py          Stage 4 — the current club tracking stage. A proposal may modify it,
                     sit alongside it, or replace it entirely.
    club_detect.py   Stage 4b — learned-detector inference, feeding Stage 4.
    events.py        Stage 5 — the 8 swing events, tempo, playback window.
    checkpoints.py, metrics.py, scoring.py, silhouette.py
  scripts/
    burnin.py        the CLI that runs the whole pipeline over one clip and writes out/<stem>/
                     ~30 flags today, all analyzer-side.
    <various debug scripts that render CV output back onto real video frames>
    train_club.py, fetch_club_dataset.py     model training entry points
  runs/              trained model weights
  out/<stem>/        analysis.json, normalized.mp4, analysis.mp4, overlay.mp4, contact.jpg

apps/web/src/
  lib/usePlayer.ts       frame sync + transport (requestVideoFrameCallback with rAF fallback)
  lib/traceSmoothing.ts  render-time path construction and smoothing
  lib/swingPhases.ts     the player's phase marks/spans, and the scrub segment boundaries
  lib/skeleton.ts        overlay colours
  lib/jobs.ts            spawns burnin.py as a child process, parses stage progress from stdout,
                         writes job state to Postgres
  components/SwingStage.tsx      video + canvas stack + all drawing
  components/SwingTransport.tsx  the scrub bar and segment buttons
  components/OverlayMenu.tsx     overlay toggles, plus two existing single-choice pickers
  components/DebugMenu.tsx       the debug FAB — currently a re-analyse button and a link to
                                 the raw artifact. No radio group yet.
  app/api/swings/[id]/reanalyze/route.ts
```

## The re-analysis path — and the problem it poses

Today the player can trigger a re-analysis, but **it cannot pass any parameters**. The API route
never reads the request body, and the job spawner constructs exactly four arguments, every one of
them read out of the swing's own stored artifact:

```ts
const args = [ "scripts/burnin.py", src,
               "--out", path.join(MEDIA_ROOT, swingId),
               "--view", analysis.video.view,
               "--handedness", analysis.video.handedness ];
```

This is deliberate — the route spawns a process, so the only values it passes are ones the
analyzer itself wrote, never anything from a request body.

Any test-selection mechanism has to solve this: getting a selected test id and smoothing id from
a radio button, through the job, into the analyzer, and back out into the artifact, without
opening a shell-injection path.

Note also that a re-analysis is slow (roughly 90 seconds today) while a render-time switch is
instant. Some approaches will need one and some the other.

## AI / LLM integration

- **Local development uses the Claude Code CLI, not an Anthropic API key.** The specified pattern
  is to shell out to `claude -p --output-format json`, which authenticates against the
  developer's own subscription. Production later swaps to the API via one env var.
- **This provider layer is specified but not built yet.** There is no `ai/providers/` directory.
  Any approach using an LLM has to build the minimal version of it.
- The specified interface is `complete({promptId, variables, images?, maxTokens?}) →
  {json, raw, provider, ms}`: a versioned prompt template, a JSON Schema for the output,
  temperature 0, validation with one retry that appends the validation error, then a non-AI
  fallback. Images are passed as file paths and read with the CLI's Read tool. Calls are
  serialized through a queue of 1–2 concurrent, with a per-call timeout.
- **Disk caching is part of the spec**: hash of prompt id + variables + image bytes, so
  re-running analysis on the same swing costs zero AI calls.
- Raw video is never sent to an LLM — extracted frames and structured JSON only.
- The pipeline must be able to run start to finish with AI disabled.

---

# PART 4 — THE TASK

> Everything from here is the request, in the product owner's own words.

I still do not think we have nailed the club head tracking and tracing. I want this feature to
be BULLETPROOF. I am listing goals and I want you to develop tests for us to review on swings.

**Goals:**

1. The tracking needs to be more accurate on club head recognition and making sure it doesn't
   record any moments that are clearly outside of the swing path. The most important parts of
   the swing are the backswing and downswing. For DTL, I ONLY want to show the backswing and
   downswing. This is a BIG shift from our original method. I do NOT need to break the downswing
   and backswing into different stages, just two: backswing and downswing.
2. The transition changes need to be accurate (start of backswing, start of downswing, impact).
   The impact is very important as well as the start of the swing.
3. The tracing needs to be smooth and accurate, visibly interesting and look professional like
   tracking on TV. This needs to follow the club head and be very smooth. The swing tracing has
   to be 1 continuous line with no gaps. The line must be smooth even if it's not 100% aligned
   with the club head, however it should try to match the path as much as possible. If it is
   jagged, it should fail my goal criteria.
   - 3.1. IF for some reason the top of the backswing and downswing (near the head, or during the
     transition between the two) has a VERY low confidence, or there are not as many golf head
     tracking points clearly identified, it CAN be removed from the view, making 2 separate
     lines — one for downswing and one for backswing. This is the ONLY reason it should ever be
     two lines and not 1 continuous line. However, this is in extreme scenarios.
4. Colors need to change accurately based on the stage (**backswing blue, downswing green**).
5. I do NOT care to track the shaft of the club. The only thing that matters most to me is the
   club head. If there are gaps and it can't identify the club head, it should either do its best
   guess based on the existing path, or skip that if it's not anywhere close to the path.
6. The tracing should follow the club head accurately frame by frame FOLLOWING the final smoothed
   path, not smoothing as it goes.
7. The detection of the backswing and downswing should change the scrubbing points of each.
8. Look at methods for impact detection. If there are frames that have large gaps due to fast
   swings, your method should have the ability to use the initial club head location on approach
   (right before downswing starts) to add that point for the final frame of the downswing. It
   should guess the frame that this keypoint should be to "fill in" the swing's impact based upon
   detected timing and speed of the swing.

**These are the hard requirements.**

I would like you to think of different ways to accomplish this task, then provide me 7 new
options I can select. These should be completely different and isolated approaches to solving
this problem, even if it requires a complete rethink and build of new functionality to test — new
ways of tracking, etc. I know this task may take some time to do. You come up with the plan, the
ideas, the methods to achieve my goals. Research as needed.

```
Test 1
Test 2
Test 3
Test 4
Test 5
Test 6
Test 7
```

If there are smoothing "options", please provide them like this:

```
Default (the default you chose for the test)
Smoothing A
Smoothing B
Smoothing C
Smoothing D
Smoothing E
Smoothing F
```

**Rule: 4 tests MAX can include any sort of LLM call.** It should leverage Claude Code in order
to make that call, not the API. When making a test with this method, be cautious of the amount of
calls/tokens being leveraged in the test, as this will need to be production eventually — but the
swing tracking is KEY for the AI to analyze the swing correctly.

I understand this may take time for each video to process and analyze, and I am okay with that
since this is a test.

Add this to the "debug menu" as a radio select. Have it then refresh the video to apply the newly
selected test and smoothing.

When doing this, code it in a way that these can easily be "undone" later if we choose a specific
methodology.

First, research this functionality thoroughly, then develop your plan of attack in order to
create these tests.

---

# PART 5 — WHAT TO DELIVER

**A. Research summary.** What you found, and what it implies for this problem. Be specific about
what is and is not achievable from a single 60fps 720p handheld video of a golf swing — where the
sampling rate, the motion blur or the 2D projection makes something impossible, say so plainly
rather than proposing it.

**B. Seven tests, numbered Test 1 … Test 7.** These must be **genuinely different approaches**,
not seven parameter settings of one idea. A different sensing formulation, a different learned
model, a different mathematical treatment of the path, a different place in the pipeline, a
complete rebuild — all fair. For each:

| field | content |
|---|---|
| Name & one-line thesis | what is fundamentally different about this approach |
| Mechanism | the actual algorithm, model and pipeline, in enough detail to implement |
| Which of goals 1–8 it addresses, and which it does not | be honest about partial coverage |
| Where it lives | new Python module / modified analyzer stage / render-time TypeScript / new model to train |
| LLM usage | none, or: calls per swing, rough token counts, prompt shape, output schema, cache key, what happens on failure |
| Data & training needs | labels, datasets, compute, wall-clock estimate |
| Per-swing processing time | rough |
| Implementation effort | rough |
| Reversibility | exactly what has to be deleted to remove it cleanly |

**C. Smoothing options.** For each test that has a smoothing or path-rendering dimension, give a
`Default` plus `Smoothing A–F` in the format requested above, each with a one-line description of
what it does and how it trades fluidity against fidelity to the measured points.

**D. The wiring plan.** Concretely: the shape of the radio-select UI in the debug menu, how the
selection persists, how it travels from the browser to the analyzer without opening a
shell-injection path, how the artifact records which test produced it, and how the player picks
the right trace and colours. Include the two-phase rendering change (backswing blue, downswing
green, DTL showing only these two) and the scrub-segment change from goal 7.

**E. Your plan of attack** for building the seven tests — sequencing, what is shared
infrastructure between them versus what is per-test, and what has to exist before any of them can
run.

## Constraints your proposals must respect

- All CV in Python, in the analyzer. The frontend renders; it does not compute.
- `analysis.json` stays the contract: normalized 0–1 coordinates, renderable with no client-side
  computation beyond scaling, fields append-only.
- The eight GolfDB events stay published, because metrics, checkpoints and the scorecard read
  them — but how they are determined is open to change.
- Handedness must mirror correctly.
- Every test must be individually selectable and cleanly removable.
- At most 4 of the 7 may use an LLM, via the Claude Code CLI rather than the API.

## Tone

Be direct and concrete. Where you are uncertain, say so. Do not pad. If you think fewer than
seven genuinely distinct approaches exist, say that — and then give seven anyway, marking which
are true alternatives and which are variations.
