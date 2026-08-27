# Analysis Engine & AI

Present tense, current state. Rationale lives in [ARCHIVE-numbered.md](ARCHIVE-numbered.md).
What the pipeline currently emits is [`../CURRENT-STATE.md`](../CURRENT-STATE.md) §3–5 and
[`../METRICS.md`](../METRICS.md).

### Finding the swing inside a long recording is a future-state feature

**Decision:** Automatic swing isolation — rejecting walking in, setup, practice swings and walking
away, and letting the golfer choose when several are detected — is **deferred**. It stays on the
roadmap as its own track, after ground truth exists.
**Gotchas:** This is **not** the existing 8-event detection, which locates events inside a clip
already known to contain exactly one swing — a materially easier problem, and mistaking one for
the other would silently skip real work. Until it ships, `in-app-capture` must provide a **manual
trim/select fallback**; that fallback is required, not optional.
**See:** ARCHIVE D2.

### The AI provider seam is server-side; the model is Anthropic, in three tiers

**Decision:** All model access goes through a server-side provider abstraction, so the model is
swappable without touching callers. Behind that seam the provider is **Anthropic**, reached
through **Vercel AI Gateway with BYOK** (list pricing, zero markup), with the tier chosen per job:

| Job | Model |
|---|---|
| L1 coach narrative — L0 facts rewritten as coach prose | `claude-sonnet-5` |
| L2 coach chat (§17) over the same read model | `claude-sonnet-5` |
| Launch-monitor screenshot → structured stats | `claude-opus-5` |
| Cheap classification — goal tagging, drill self-reports, onboarding fields | `claude-haiku-4-5` |

Model IDs and the tier assignment are **versioned configuration**, and every AI-authored artifact
records the version that produced it, exactly as `scoring_model_version` does for scoring.
**Scope:** AI is for coaching narrative, conversation and parsing images — **never** for producing
geometry. Pose, club, phase and angle maths are deterministic machine vision. AI is an
enhancement, never a hard dependency for a swing reaching a ready state; every call validates
against its schema, retries once, then falls back to template copy, and `AI_PROVIDER=mock` still
reaches `ready`.
**Gotchas:** The gateway is Vercel's because `apps/web` already runs on Vercel — routing model
calls through it adds **zero new data processors**, where a third-party router (OpenRouter) adds
one and inherits the no-training / short-retention obligation below, satisfiable only in a ZDR
mode that shrinks the model pool. **Replicate is a separate vendor with a clean boundary:**
Anthropic writes words, Replicate renders media (TTS, image, video). Replicate is never in the
coaching-text path.
**See:** ARCHIVE D16; `.claude/architecture/production-vendor-stack-2026-08-22.md`.

### What golfer data may reach a model provider

**Decision:**
- **Never sent:** raw video, raw per-frame keypoint arrays, precise location, email, payment data.
- **May be sent:** derived analysis (scores, findings, checkpoint metrics), golfer-supplied
  profile fields, goals, equipment, club, summarised history. **Extracted keyframe images may be
  sent** where a visual is needed.
- **Required of the provider:** no training on submitted data, and zero or short retention. A
  provider that cannot commit to both is not eligible.
- **User-authored free text** — notes, goals, messages — is **untrusted input**, carried as data
  and never as instructions, and never able to alter system behaviour.

**Scope:** Makes the Apple App Privacy and Google Data Safety declarations answerable rather than
guesswork, and constrains `ai-coach`'s prompt construction from the start.
**See:** ARCHIVE D14.

### Scoring is style-aware; seven universal checks never gate

**Decision:** Every scoring row is either universal `[U]` or style-dependent, gated by the
golfer's swing style (STY-01 Rotator / STY-02 Lifter / STY-03 Slider-Bomber / STY-04 Stacker)
with `[REL]`/`[TGT]`/`[SWP]` modifiers per `PROJECT_MAIN.md` §15.4. **A trait the golfer's style
legitimizes is never presented as a fault.** The seven universal rows — face-to-path, strike,
kinematic sequence order, low point, shaft lean, balance, no-flip — never gate and stay
highest-weighted for every style. Classification is descriptive-first from measured markers;
body-type logic is tie-breaker only; output is primary style + confidence + secondary, and
hybrids widen tolerances rather than force a label. The onboarding self-report is a prior, and
a measured disagreement is surfaced, never silently overridden.
**Gotchas:** Style tags are versioned scoring-config data, never code. The style label is
constant across the bag — the club column gates within it, and a driver/iron disagreement
surfaces as an insight, not two labels. Classification Step 1 needs face-on markers that **no
current fixture provides**.
**See:** ARCHIVE D54; `PROJECT_MAIN.md` §15.4.

### Focus-goal progress is windowed evidence; abstention never moves it

**Decision:** A focus goal (`PROJECT_MAIN.md` §16.3) is bound to measured scoring-config
checks — never a free-text theme — and its progress is **consistency over a rolling window of
evidencing swings** ("clean in X of the last Y swings that could judge it"), never a raw
consecutive streak. A swing whose bound checks abstain (low confidence, wrong view, not
scoreable) is *no evidence* and moves progress in neither direction. At most **3** goals are
active per golfer. Progress lives in the **database**, computed deterministically from stored
analyses under a **versioned `goal_config`**; an achieved goal stores the version it was
achieved under. Achievement lands on the exact swing that completes the window, is celebrated
once, then the goal enters quiet maintenance — a sustained regression re-proposes it with its
history, never silently.
**Gotchas:** Never derive progress state from `analysis.json` fields cached client-side — the
artifact is rewritten wholesale on re-analysis and carries no product state. Consumers
re-apply the same truncated `MIN_CONF` gate as everywhere else. A goal whose checks need a
camera view the golfer does not film must say so at assignment time, not sit at 0%.
**See:** ARCHIVE D55; `PROJECT_MAIN.md` §16.3.

### Guided drills are checked by a pose-only drill analysis mode, never the swing pipeline

**Decision:** A drill (`PROJECT_MAIN.md` §18) is either **plain** (content only) or **guided** —
carrying a versioned per-drill **check spec** (required view + handedness-aware targets;
checkpoint type **hold** — judge the stable window — or **trigger** — judge at a kinematic
event; checks from the existing measured-angle catalogue; per-rep verdicts hit / adjust /
cannot-evaluate). Checking is record → analyze → verdict in seconds — **never a live
client-side mirror**, which would move CV into the client. Verdicts are deterministic
geometry; AI only rewrites the correction into coach prose. Hold drills build first; trigger
drills second. Five placements (accepted 2026-08-17):
1. **A pipeline profile, not a service or fork** — `services/analyzer/swingsage/drills/`
   reuses stages 0/0b/2/3 byte-identical, then rep segmentation → drill metrics (existing
   angle catalogue + `geom`) → verdicts. Never the swing pipeline on non-swing motion; no
   club, no YOLO — the drill profile is CPU-only.
2. **Spec/content split** — check specs are repo-versioned `drill_config/v<N>.json` beside
   `scoring_config/`, engineering-authored and fixture-validated; drill *content* (video,
   cues, mappings, active flag) is admin-managed DB rows carrying a nullable `check_id`.
   Admin never authors geometry.
3. **Sibling artifacts** — `drill_analysis.json` (49-keypoint block conventions, rep-array
   shape from day one) + `drill_report.json` (per-rep verdicts, drawing geometry,
   `drill_spec_version`), both in `packages/schema`, additive. `analysis.json` stays
   swing-only. Verdicts are a pure function of artifact + spec — `redrill.py` re-verdicts
   without re-inference, like `rescore.py`.
4. **Structural quarantine** — rep/verdict data lives in `drill_attempts` (+ per-rep rows),
   never in `swings`; storage keys `u/<userId>/d/<attemptId>/…`; same RLS/`withUser()`
   boundary. Coach roll-ups are deterministic DB aggregates over these rows.
5. **Same job seam, fast lane** — jobs carry `kind: swing | drill`; the worker design gives
   short CPU-only drill jobs a priority class so "verdict in seconds" survives queueing.
**Gotchas:** Confidence and abstention rules apply exactly as in swing scoring — the wrong
camera angle says so at *drill selection time* (`required_view` in drill metadata), never
guesses after recording. No existing fixture can test a drill check (all are full DTL
right-handed swings); drill fixtures are filmed as **pairs — correct AND characteristically
wrong execution** — before any band is trusted, and `scripts/checkdrill.py` is built with the
first check, not after.
**See:** ARCHIVE D59; `PROJECT_MAIN.md` §18;
`.claude/architecture/guided-drills-architecture-2026-08-17.md`.

### Impact has a second witness, and it is audio

**Decision:** Every analysed swing carries `audio_impact` (schema 10) — the strike as **heard**,
detected from the clip's own audio by `swingsage/audio_impact.py`. It records the heard frame, a
confidence, and `agrees`: whether the video-side Impact event lands within 0.25 s of it. Read off
the **source** clip, since `video.normalize` passes `-an` and the analysis copy has no audio at all.
**It moves no event and never will.** Video wins on precision — a frame is 17 ms and the club-head
low point is a geometric fact — while audio carries the recording pipeline's latency (121–148 ms
measured, never measured on SwingSage's own recorder). What it buys is independence: every other
estimate of Impact is derived from the same pixels and therefore fails on the same clips, and a
microphone is not reading the pixels.
**Gotchas:** `agrees: false` is the valuable output, not an error — it is the first thing in this
contract able to say the video-side Impact is wrong, and on the `7wood-1` fixture it fires because
the stored Impact sits ~40 frames after the ball leaves the mat. Null is a normal answer (no audio
track, nothing heard) and consumers must treat absence as *no evidence*, never as disagreement. The
detector is the same `swish` algorithm the phone runs, with the biquad coefficients derived in the
open on both sides so the two cannot drift into being two detectors under one name.
**Scope:** Rendering and diagnostics. Never a metric, never a scoring input, never an event value.

### Never fabricate a face-angle number from video

**Decision:** Video yields checkpoint **classifications** (square/open/closed) only. Degrees
require a launch monitor, and manually entered launch-monitor data is the only authoritative
source of face-angle degrees anywhere in the system.
**Scope:** Generalises — a check that cannot be evaluated from the available view abstains and is
marked "not scored". Abstaining beats a confident wrong number, and that is a product position
rather than a limitation.

### Thresholds are versioned configuration, never hardcoded

**Decision:** Scoring thresholds live in a versioned `scoring_config.json`. Every report stores
`scoring_model_version` so old reports stay reproducible. Stage 8 is a pure function of
`analysis.json` + the config, so a scoring change re-runs with `rescore.py` rather than a full
re-analysis.
**Gotchas:** `validate_scoring_config.py` proves a field **exists**, never that it **means** what
the band assumes. Nine rotation checks once shipped reading a quantity that decreases as a golfer
turns, and one of them scored 100 and looked healthy. Before trusting a new check, print its raw
value across all fixtures and confirm the number moves the way the band assumes.

### The scorecard has its own route, separate from the artifact

**Decision:** `GET /api/v1/swings/:id/report` serves `coach_report.json` — Stage 8's whole output,
with no AI in it. Clients fetch it **lazily**, only when someone opens the analysis panel, and a
404 means `--no-scoring` rather than a failure.
**Gotchas:** Separate from `/analysis` because the two have different sizes and lifetimes: the
artifact is megabytes of per-frame geometry the overlay needs immediately, the report is a few
kilobytes nothing needs until asked for. A client that only wants to *explain* a swing should not
download every keypoint to do it — and "analysis must be explainable" is a product
non-negotiable, not a screen. `no-store`, because a re-score rewrites the report in place under
the same revision.
**Scope:** Any surface showing the scorecard must print **coverage next to the headline**: `65
from 41 of 58 checks` and `65 from 6 of 58` are different claims about the same number. The two
reasons a check did not score stay apart — *skipped for this swing* is about the clip, *deferred*
is the config refusing to score a metric it does not trust yet, and merging them reports our gap
as the golfer's.

### Stage 0 normalizes to CFR at the capture rate, never a hardcoded 60

**Decision:** `video.cfr_target_fps` picks the normalization rate per source — the capture rate
snapped to {240, 120, 60, 30}: the smallest step that keeps every observation (5fps tolerance for
real-world cadences like a healthy take's ~237.6 avg; 50fps snaps UP to 60, never down), capped
at 240, with 60 for a source whose rate cannot be probed at all. A ~30fps import normalizes AT
30 — no duplicated frames, so every public frame id is one camera observation. Both derivatives
(`normalized.mp4`, `analysis.mp4`) use it, and `analysis.json`'s `fps` carries whatever was
chosen, so the player's `frame = round(t × fps)` contract is unchanged. The in-app recorder
writes real sensor frames on a REAL-TIME timeline (240fps timeline, no retime — unlike a phone
camera app's slow-mo export, which retimes to a slow timeline); slow motion is a playback
concern: the player presents the same CFR file slower, and at ¼x or less every sensor frame
reaches the screen.
**Gotchas:** Resampling a real-time 240fps take to CFR 60 silently discards 3 of every 4 sensor
frames — exactly the footage the ≥60fps capture constraint exists to keep, and how a 240fps
recording surfaced in a report saying 60 (2026-08-23). Compute is not an argument for a cap:
takes are short, so 2s at 240 is the same frame count as an 8s fixture at 60. Every stored
artifact analysed before this change keeps its old rate until re-analysed — and a 30fps import
re-analysed after the change halves its frame count, which is exactly the case the corrections
stale flag exists for (see "Frame identity" below).

### Frame identity: the normalized index is THE public frame id, and source_timing maps it back

**Decision:** The normalized native-rate CFR index is the one public frame identity — declared in
the artifact (`video.frame_id_space: "normalized"`) rather than implied. `source_timing.json` (v2,
schema-validated in `packages/schema`, named by `video.source_map`) is the authoritative map from
those ids to genuine camera observations, built on EVERY path including the slow-motion retime by
mapping on the retimed clock (source PTS × the itsscale factor); each observation carries
`real_capture_time_us` on the world clock plus its unscaled container PTS. When the map cannot be
built, `video.source_map` is null and `video.source_map_reason` says why.
**Corrections provenance (C10):** `head_markers` / `swing_stages` rows stamp `{fps,
artifact_revision}` at write time. Staleness is DERIVED at read time (row fps ≠ view fps) — never
stored — and stale rows are served flagged, rendered hidden by both clients, and never merged as
truth; re-placing a correction re-stamps it against the current clock. A re-analysis that changes
the fps flags (never deletes) — those rows are the project's only hand-labelled club truth.
`markViewReady` logs the newly-stale count per view, the telemetry that decides whether a
re-stamp tool is ever worth building.
**Gotchas:** Client seek rules are untouched and stay per-platform (`frame/fps` Android,
`(frame+0.5)/fps` web — D40). `playback_pad`'s freeze-hold now runs on mobile too
(`useFramePlayer` takes `padMs`), so the equal lead-in property side-by-side depends on holds on
both clients.

### The pipeline has one programmatic entry point

**Decision:** The full analysis composition — every stage, the `analysis.json` doc assembly, the
output lock, schema versioning — is `swingsage.pipeline.run(AnalysisRequest, on_event=None)`.
`scripts/burnin.py` is a thin CLI over it; the hosted worker imports it directly instead of
spawning a child process. Failures the pipeline refuses on raise `PipelineError` with a
user-readable reason.
**Gotchas:** **stdout is a protocol** until the worker exists end to end: `apps/web/src/lib/jobs.ts`
regex-parses the printed stage lines for its progress bar, so the `print()` calls inside
`pipeline.run()` may not change shape. The structured `on_event` callback is additive, never a
replacement for those lines. `AnalysisRequest` defaults and the CLI flags are kept identical by
`tests/test_pipeline.py` — add a flag by adding the field first. The club detector still has **no
default weights** in either surface.

### The analyzer environment is pinned to the measured configuration

**Decision:** Runtime deps are exact-pinned in `services/analyzer/requirements.txt` — the
versions the CUDA measurement (D53) and the determinism baseline were taken on. Install is two
commands in order: `pip install -r requirements.txt`, then `pip install --no-deps
rtmlib==0.0.16`. `services/analyzer/Dockerfile` builds the worker image from those pins (code +
deps only; model assets mount as volumes at their repo-relative paths) and the in-container
test suite is the reproducibility oracle. `service/worker.py` is the container entrypoint: a
versioned job-spec JSON → `AnalysisRequest` → `pipeline.run()`, emitting one JSON object per
line — strict validation, unknown fields refuse, club detector never defaulted.
**Gotchas:** rtmlib's metadata hard-requires the CPU-only `onnxruntime` distribution and
`opencv-contrib-python` — installing it *with* deps puts a CPU onnxruntime next to
`onnxruntime-gpu`, recreating the silent-CUDA-fallback incident. The cu126 torch wheels run on
CPU-only hosts too; one faithful image, host-agnostic — a slimmer CPU-only variant is deferred
until the worker-host handoff closes. The club-head weights (`best.pt`) remain a **local-only
asset** with no reproducible fetch path; shipping them to a deployed worker is an open
later-step decision. Upgrading any pin means re-running the fixture fidelity comparison
(`scripts/compare_analysis.py`) before trusting new output.

### Pose runs on CUDA when it is genuinely available

**Decision:** `pose_device()` probes for a usable CUDA provider and returns `cuda` or `cpu`;
`SWINGSAGE_POSE_DEVICE=cpu|cuda` forces it. Measured **2.32x** (70.4 -> 30.4 ms/frame) on a GTX 1080.
**Gotchas:** "Available" is a claim, not a capability — a provider can be listed and still fail to
create, falling back to CPU **without raising**. Always ask a real session `get_providers()`. There
is no CUDA toolkit on this machine: the CUDA 12 + cuDNN 9 DLLs come from **torch's** `torch/lib`, so
importing torch is load-bearing. `onnxruntime-gpu` must match the CUDA major version (**1.22** for
CUDA 12; 1.28 wants CUDA 13). CPU and CUDA agree to **0.94 px** but are **not bit-identical**, so a
golden snapshot is only valid against the device that produced it.
**See:** ARCHIVE D53.

### A focus area is a goal template viewed through measured performance

**Decision:** The Focus page (`PROJECT_MAIN.md` §16.3.7) is the *pull* counterpart to the
AI's *push* proposals — a catalog of `goal_config` templates grouped by swing phase, ranked
by the priority model, each showing an average over recent evidencing swings and a windowed
trend arrow (last N evidencing swings vs the N before; N and the minimum evidencing count in
`goal_config`). "Train this focus" activates the template as a focus goal and enters a focus
training session (§8.4). Templates carry `phase_range`, `overlay_set`, `area_group`, and
`feel_cue`; comparison accepts an optional focus-area scope built on those fields.
**Gotchas:** Never render two raw small-sample averages as a trend — abstention can make
"last 4 swings" a 1-swing average. Below the minimum evidencing count, say "not enough swings
to judge yet". View-gated areas say "needs face-on video", never a score.
**See:** ARCHIVE D56; `PROJECT_MAIN.md` §16.3.7, §8.4.

### Focus-session swings are practice, quarantined from every durable metric

**Decision:** Swings recorded inside a focus training session enter no overall average, no
area stat or trend, no achievement window, no best-swing selection, and no comparison
default. They feed the in-session verdict loop, the session's own record, and the area's
training history only. The §16.3.3 achievement window counts **normal swings only**; the one
exception is the end-of-session "take one real swing" closer — a normal swing by
golfer-stated intent, never inferred by heuristic.
**Gotchas:** The log label records *intent*, the evidence model records *measurement* — a
casual (non-focus) session still evidences every active goal. Do not build a "was that a
real swing?" classifier; stated intent is the only admissible signal.
**See:** ARCHIVE D56; `PROJECT_MAIN.md` §8.4.

### Spoken feedback is a pre-generated Gemini voice bank; the coach speaks, never listens

**Decision:** Focus-mode verdicts are spoken from a **bundled asset bank**: authored lines
(verdict phrasings × moments × per-area feel cues) batch-rendered once with **Gemini 3.1
Flash TTS, called via Replicate** (`replicate.com/google/gemini-3.1-flash-tts`, official
listing — Taylor's existing account; `REPLICATE_API_TOKEN` in the generation script's env),
selected with no-repeat rotation. The bank is rendered **once per persona** — one Gemini voice
each for Mark (`Orus`), Sean (`Charon`) and Julie (`Zephyr`) — so the golfer's coach pick
selects a bank, never a runtime call. A versioned `voice_config` pins the Replicate model ref +
the per-persona voice; a manifest (line → text hash → asset) drives regeneration, and any model change
regenerates the whole bank. The app never calls a TTS vendor at runtime; device TTS is the
offline fallback; settings disclose the AI voice. ElevenLabs is the named fallback vendor
behind a script flag; the bake-off alternates (MiniMax, Chatterbox) also run on Replicate.
No STT, no conversational voice — deferred to the icebox, and any future conversational tier
belongs to the AI-coach provider seam and its cost ceilings.
**Gotchas:** Spoken lines obey the same honesty rules as the screen — abstention is spoken
as abstention, and no line may claim a streak or achievement the evidence model has not
produced. Gemini output carries a SynthID watermark (inaudible; fine).
**See:** ARCHIVE D57; `PROJECT_MAIN.md` §8.5; `.claude/architecture/voice-tts-vendor-2026-08-14.md`.

### The Coach is a persona over deterministic systems, never a system that owns state

**Decision:** All guidance reaches the golfer through a Coach persona the golfer picks — the
Coach surface (active focuses, proposals, the Focus page, chat, summaries) plus contextual
appearances (after-swing verdicts, the spoken D57 voice). The roster is three personas —
**Mark** (Gemini voice `Orus`), **Sean** (`Charon`) and **Julie** (`Zephyr`) — differing in
voice, manner and portrait ONLY; the pick never changes a fact, a score, an abstention or a
priority. The roster lives in `apps/mobile/src/features/coach/coaches.ts`, portraits in
`apps/mobile/assets/coaches/<id>.jpg`, and the choice is a device-local app preference
(`appPrefs.coachId`) until an account-level settings surface exists. It is picked on the **AI
coach preferences** page — reached from My profile, and from a faint semi-transparent gear at
the top of the Coach page — never from general Settings, which holds app behaviour rather than
who the product is. The picker is the design system's `PortraitPicker`: portrait cards where
the face carries the choice, one blurb for whoever is chosen, selection shown by veil + wash +
tick rather than an edge. Underneath: L0
deterministic engines own every fact and all state; L1 narrative AI rewrites L0 facts into coach prose (template fallback);
L2 is §17 chat over the same read-model. Information flows L0 → L1/L2 only. AI writes the
coach's words, never its facts; the only AI-output→state path is a golfer's tap. A versioned
coach persona spec is shared by template copy and AI prompts.
**Gotchas:** An L1/L2 line naming a streak, score, or achievement the evidence model has not
produced is a correctness bug, same class as a fabricated face angle. Two golfers on the same
swing get the same numbers in different words — a persona that changes an assessment is that
same class of bug. The persona renders each guidance object's source (`ai | coach | self`) so human-coach guidance stays visibly
distinct when it arrives (§26.3); the AI coach never presents as human.
**See:** ARCHIVE D58; `PROJECT_MAIN.md` §17; `.claude/architecture/coach-and-focus-2026-08-14.md`.

### Ground-truth labels key on the normalized frame clock, with the corrections' staleness rule

**Decision:** Every hand label (events, club pose, body pose) is keyed on the **normalized frame
id** — the artifact's declared public frame identity — and records the `fps` it was made
against. An evaluator seeing a different artifact fps flags the labels **stale and refuses to
score**; it never renumbers on the fly. This is the same guard `head_markers`/`swing_stages`
carry. Trim labels are the one exception (raw pre-trim clips have no artifact; they use the raw
clip's own ms clock). Label definitions are frozen in
`services/analyzer/groundtruth/ANNOTATION-MANUAL.md`; changing one bumps the label schema
version and invalidates old labels, never silently reinterprets them.
**Scope:** `services/analyzer/groundtruth/` owns the schemas (club/event/trim/body), the
evaluators, and the golden-set CI. Labels live in `fixtures/labels/` (gitignored with the
footage); the tier manifest (`groundtruth/goldenset.json`) and the accepted report
(`groundtruth/reports/accepted.json`) are committed.
**Gotchas:** The annotation tool is replaceable (CVAT today); the schema is not. Detector output
is never pasted into labels — priors for where to look only.

### Dataset tiers are assigned by golfer and recording; hard gates ratchet

**Decision:** `groundtruth/goldenset.json` is the single authority on dataset tiers: **golden**
(release gate, never tuned on), **dev** (tuning/training), **holdout** (untouched, golfer- AND
recording-disjoint). Assignment is by golfer and source recording, never frame- or swing-level.
The golden-set CI (`python -m groundtruth.goldenset report|diff|accept`) evaluates stored
artifacts against labels and produces a byte-stable machine-readable report; `diff` **fails on
any hard-gate count exceeding the accepted baseline** (frame-identity mismatches,
propagated-frames-carrying-direct-confidence, high-confidence catastrophic impact misses —
target zero for all three). Golden evaluation runs locally via `pytest -m goldenset` (footage-
bound; excluded from the default suite).
**Gotchas:** A clip absent from the manifest has no tier and must not be used for anything.
Accepting a worse report is a deliberate act (`accept`), never something a green run implies.

### Head markers carry three honest states: placed, blurry, hidden

**Decision:** A `head_markers` row is one of three statements (migration 0023): **placed** — a
sharp club head at (x,y); **blurred** — (x,y) is the midpoint of a motion streak, an estimate
(always the midpoint, never the streak's end — an end point is systematically late); **hidden**
— a human looked and the head is not visible (no coordinates exist). Hidden and blurred rows
are truth in their own right: the club evaluator scores a confident direct detection on a
hidden frame as a false positive, and streak-estimates land in their own metric pool so they
never pollute the sharp position-error numbers. The markers GET serves hidden rows only on
`?hidden=1` (opt-in) so clients that predate the field never see a marker without coordinates.
**Scope:** editor buttons + `B`/`H` keys in the web player's marker strip;
`groundtruth/import_head_markers.py` maps placed/blurred/hidden →
visible / occluded+head_streak / `head_hidden` label rows.

### One stage vocabulary, owned by Python and mirrored into TypeScript

**Decision:** `services/analyzer/swingsage/stages.py` is the single list of analysis stage
names, their progress percentages, their human labels, and which stages nest inside another.
`scripts/build_stage_mirror.py` generates `packages/schema/stages.json` from it; the web app
imports `@swingsage/schema/stages`; `test_stage_metrics.py` fails if the two drift. Stage ids
are **machine names** (snake_case) and everything a person reads goes through `stageLabel`, so
renaming a screen never moves a telemetry key. `jobrun.STAGE_PCT` is a re-export, and
`jobs.ts STAGES` owns only its stdout regexes, not the names.
**Scope:** the vocabulary also names the three stages that happen outside `pipeline.run` —
`download`, `guard`, `upload` — because an unnamed stage becomes the unattributed remainder.
**Gotchas:** the spawn path's scraper still cannot see six worker stages; that is a limit of
reading stdout, not a second vocabulary, and it dies with the scraper in step 14.

### Stage durations are measured at the boundary, never reconstructed

**Decision:** every `stage_done` event carries its own measured `elapsed_s` and a `depth`.
Consumers accumulate those; they never infer a duration from the gap between consecutive
`stage_started` events. Reconstruction cannot express nesting (`variants` runs inside `club`,
so the earlier `modal_app.bench` accumulator charged `club` only the time before `variants`
began), silently mis-attributes a re-entered stage, and charges inter-stage gaps to whichever
stage happened to run first. A job's telemetry record states its own `unattributedS`
remainder — a record that always looked fully accounted-for could not show attribution
improving, which is the only reason to measure.
**Scope:** `jobs.job_metrics` (migration 0024), posted with the terminal event so an outcome
and its metrics can never be written apart. Read with `pnpm --filter web job-stats`; the GPU
$/s rate is configuration (`WORKER_GPU_USD_PER_SECOND`), never a literal.
**Gotchas:** telemetry is wrapped so a bug in it can never fail a job — a job with no metrics
is a gap in a dashboard, a job that 500s on its own measurement is a lost swing. The events
route accepts the record as an opaque size-capped document for the same reason.

### Pipeline telemetry vs product observability

**Decision:** this analyzer-side telemetry (per-stage spans, job metrics, the attribution
oracle) belongs to the analysis pipeline and is the raw data behind the analysis-latency SLO.
The `observability-and-slos` track owns product analytics, error tracking, alerting and
dashboards at large, and consumes these rows rather than re-deriving them.
