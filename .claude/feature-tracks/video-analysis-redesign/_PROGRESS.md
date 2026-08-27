# video-analysis-redesign — Progress Log

Append-only.

## 06 - Shared Decode & Pipeline Restructure
**Completed:** 2026-08-27 04:05 UTC
**Phase:** Analysis Core
**Summary:** Every CV stage used to open its own `cv2.VideoCapture` over the same
`analysis.mp4` — 16 sequential decodes with variants on, zero sharing, and four of them
materialised the whole clip in RAM first. New `swingsage/frames.py:FrameProvider` owns pixel
access: one sequential decode, the clip held as a single contiguous `(n, h, w)` uint8 gray
array, Sobel gradients computed on demand behind a 6-frame LRU (they were precomputed for the
WHOLE clip even though `club.track` reads them only between Top and Impact+4), and MOG2 run
once per video with masks bit-packed (`detectShadows=False` makes the masks binary, so packing
is exact at 1/8 the residency). `pipeline.run` builds one provider after normalize and passes
it to the pose localiser, RTMPose, the club detector, all thirteen club solves and the face
pass; the first UNBOUNDED `stream_bgr` fills the gray store on its way past, which is what
takes a full run from four decodes to three. `club_detect.run` no longer decodes every BGR
frame into a list before predicting (~2.8 MB/frame; 3.3 GB on a 1,200-frame 240 fps take) — it
streams batches of 16. Model sessions are cached at module level: RTMPose ONNX by
(weights, input size, device), YOLO by resolved weights path, the MediaPipe `.task` BYTES by
path — deliberately not the landmarker, which is single-use per clip because
`detect_for_video` demands monotonic timestamps and has no reset. Residency is now arithmetic
rather than a surprise: `frames.estimate_bytes()` is the one definition, the workload guard
multiplies its estimated frame count through it at the ANALYSIS tier (not the source
resolution) and refuses before the GPU is touched, and the provider asserts the same budget
again at decode time so a caller bypassing the guard still gets a named error instead of an
OOM kill. Every job now reports `decodePasses` and `memHighWaterMb` beside its step-05 spans.
Dead code deleted in passing: `video.crop_scale`, `pose.swing_bbox`, `pose.remap_to_full`,
`club.background_masks`.

**ACCEPTANCE — artifact parity on 13/13 runs (10 fixtures variants ON, 3 variants OFF): every
`analysis.json` BYTE-IDENTICAL** (`compare_analysis.py`, tol 1e-6) against a git worktree
pinned at 5c499c5. Decode passes **3 on every run** (target ≤3; was 16 with variants on, 5
off). Peak frame planes 225–876 MB measured, against the ~12 GB a 1,200-frame 240 fps clip
would have held inside one `club.track` call. Analyzer pytest green (322 passed, 3 xfailed),
goldens unchanged, `python -m groundtruth.goldenset diff` clean.

**Where the time actually went, stated plainly, because the headline number misleads.**
Variants ON: 4,942.7 s → 3,206.0 s across the ten, **1.54x** (1.42x–1.77x per fixture).
Variants OFF — the PRODUCTION shape — barely moved: swing1 100.9 s → 98.6 s, 7wood-1
111.2 s → 108.2 s, perfect 90.8 s → 88.3 s, about **2%**. That is the honest reading: nearly
all of the 1.54x is the twelve redundant decode-and-MOG2 cycles the variants sweep was paying,
and a production job was never spending its wall clock in decode — it spends it in pose. So
this step's value to a real job is NOT speed; it is the ~12 GB latent OOM removed, the
residency made measurable and budgeted, and the single frame-access seam that steps 07
(adaptive planner), 09 (club v2) and 12 (NVDEC/GPU) all need before they can change WHICH
frames get processed at all. Do not quote 1.54x as a production improvement.

**Notes:** The parity harness is `scripts/parity06.py` and the procedure is written up in
RUNBOOK §5 — it is reusable for any later `swingsage/` refactor that claims to be
behaviour-preserving, and the point it exists to make is that a green test suite says the code
still runs, not that the swing came out the same. Two things deliberately NOT done. (1)
`ClubFrame.cands` was on the audit's housekeeping list but is not dead — it is read in four
places in the Viterbi solver (always `None` today, so those branches never fire). Removing it
means changing control flow inside the club solver that step 09 replaces wholesale, which is
the wrong risk to take inside a parity-gated refactor; it goes with 09. (2) `pose` and
`detector` were not fused into a single pass. It would reach 2 decodes, but it collapses two
step-05 spans into one and costs the per-stage attribution that step exists to provide — the
target was ≤3 and it is met without that trade. `pose.retry_gaps` and `render.contact_sheet`
keep direct random-access captures by design; `render.burn_in` reads `normalized.mp4`, a
different resolution tier, and streams it.

---

## 05 - Stage Telemetry & Cost Attribution
**Completed:** 2026-08-27 00:45 UTC
**Phase:** Foundations
**Summary:** Per-stage wall clock stopped being printed and discarded. New
`swingsage/stages.py` is the ONE vocabulary (19 stages: the 16 pipeline stages plus the three
that happen outside it — `download`, `guard`, `upload`), carrying pct, human labels and the
nesting rule; `scripts/build_stage_mirror.py` generates `packages/schema/stages.json` from it,
the web app imports `@swingsage/schema/stages`, and a parity test fails on drift. This kills
the two-disagreeing-lists problem: `jobrun.STAGE_PCT` is now a re-export and `jobs.ts STAGES`
owns only its regexes, where before the same stage produced `pose (localiser)` or
`pose_localiser` depending on which runner ran it (also `pose-post`/`stage3`,
`coach`/`scoring`) — so grouping job rows by stage was wrong and nothing surfaced it. Machine
ids are separated from display wording (`stageLabel`), so the two UI sites that render
`job.stage` raw keep reading properly. Durations are MEASURED at the boundary: `SpanTracker`
emits `stage_done` with its own `elapsed_s` + `depth`, replacing the ~14 ad-hoc `time.time()`
deltas (four stages — probe/checkpoints/silhouette/contract — were never timed at all) and
fixing the nesting bug the old `modal_app.bench` accumulator had, where closing a span when
the next opened charged `club` only the time before `variants` began. jobrun accumulates the
spans, times download/guard/upload itself, and posts a `stageMetrics` record with the terminal
event — on `failed` too, since which stage a job died in is most of the value. Persisted to
`jobs.job_metrics` (migration 0024) in the same write as the outcome; the events route takes
it as an opaque 16 KB-capped document (the worker owns the shape and it is schema-versioned —
strict parsing would only add a way to lose a finished analysis). Reader:
`pnpm --filter web job-stats` — p50/p95 by capture-fps class, per-stage share, cost/view from
a configured $/s rate (`WORKER_GPU_USD_PER_SECOND`, never a literal), cold/warm split.
**ACCEPTANCE: 99.6% attribution** on a real 6iron2 run in production shape (bar 95%), via the
new repeatable oracle `scripts/checkattribution.py`, which exits non-zero below the bar.
**Notes:** The first thing the measurement found: the **localiser pose pass costs MORE than
the real pose pass** (29.4s vs 18.8s of a 120.6s run) and `club` is the single biggest stage
at 27.8% — both are step 06/07/09's problem and both were invisible before today. Full
breakdown: normalize 14.6%, pose_localiser 24.4%, pose 15.6%, detector 5.8%, club 27.8%,
contract 2.1%, render 7.6%; everything else under 1.5%. DEVIATION from the step's sketch:
`download` was added to the vocabulary beyond the specified `guard`+`upload` — on a slow link
it is a double-digit share of wall time, and leaving it unnamed would have guaranteed it
landed in the remainder the step exists to shrink. The event parser moved out of the route
into `lib/jobs/events.ts` so it is testable without a request, token and database. Suites:
analyzer 330 passed + 3 xfailed (14 new stage-metrics + 8 new jobrun telemetry tests), web
284 passed (17 new), tsc + lint clean, mirror drift check green, golden gate still 0/0/0.
NAMED SHORTFALL: the acceptance run is LOCAL (real pipeline, real clip, all 16 pipeline
stages). The step also asks for one queue job on the deployed Modal worker to exercise
download/guard/upload/coldStart end to end — that needs a production deploy, which is
Taylor's call, so it rides the existing hosted-stack HANDOFF row rather than being claimed.

---

## 04 - Ground Truth & Evaluation Infrastructure
**Completed:** 2026-08-26 22:20 UTC
**Phase:** Foundations
**Summary:** Accuracy is falsifiable for the first time. New `services/analyzer/groundtruth/`
package: frozen annotation schemas (club 5-pt / events / trim / body, draft-07, semantic checks
in `labels.py`), an annotation manual whose definitions are versioned and binding, evaluators
for the plan's full metric families (`evaluate_events` — exact/±1/±2/±4, ms percentiles,
catastrophic + high-conf-catastrophic, abstention, calibration, per fps; `evaluate_club` — PCK@
2/5/10px, head-center median/p95, club-length-normalized error, shaft angle, visible P/R, FP
rate, gaps, impossible jumps, impact-window, and it scores every `club.variants` entry with the
same core — the ranking metric five modules had TODOs waiting on; `evaluate_body` — per-joint px
error, event-frame error, line-angle MAE, wrong-high-confidence rate), CVAT + head-markers
import paths, and the golden-set CI: committed tier manifest (`goldenset.json`, split by golfer
AND recording), `report|diff|accept` with a byte-stable machine-readable report and three
RATCHETED hard gates (frame-identity mismatch / propagated-as-direct / high-conf catastrophic
impact — accepted baseline all 0). Labels key on the NORMALIZED clock with the corrections'
fps-staleness rule (decision logged in `docs/decisions/analysis-and-ai.md`). **All ten fixtures'
events are hand-labeled** (first pass: 10 parallel vision agents over frame-indexed
`labelstrip.py` contact sheets; ball-departure witnesses recorded; Taylor's verification is a
HANDOFF row). Measured for the first time: impact 80% within ±2 (median 8 ms) with the 7wood-1
miss CONFIRMED at 32 frames late by ball departure; **address catastrophic on 9/10 (8 high-
conf)** — it fires at motion onset, not the settle; finish 0% within ±2; top soft. Frozen test
data + goldens refreshed from schema-10 re-runs of swing1/swing2 (compare_analysis: zero
numeric drift, additive fields only; the single golden diff was ±0.1° pose jitter in 12 metric
leaves); `hand_labeled` filled (test now xfails honestly against the measured detector gap);
the fixture-count xfail tracks the golden manifest. 25 new synthetic-pair unit tests; suite 303
passed + 3 xfailed; `-m goldenset` 2 passed; `pnpm db:backfill` synced the re-analyzed scores.
**Notes:** pro_3 exposed as a speed-ramped, echo-looped social edit — kept golden as a
doctored-import robustness case, top/finish flagged diagnostic-only in the manifest. Two clips'
address is left-censored (clip starts settled) — rule added to the manual mid-pass. The audio
witness's 7wood-1 onset (~5.08s) sits ~8 frames EARLY of the visually unambiguous ball
departure (5.23s) — noted in the label file, audio_truth.json left untouched. Hosel error is a
null slot (current artifact predicts no hosel point; club v2's). Club/body labels are the named
outstanding halves: evaluators built + unit-tested, zero labels — HANDOFF rows carry the
labeling and the holdout footage (face-on / left-handed / outdoor). Reconciliation honored:
`analysis-ground-truth` RECONCILEs against this step instead of duplicating (C12; its native
remainder is the rotation estimate + un-deferring the ten scoring checks).

---

## 03 - Frame Identity & Timeline Correctness
**Completed:** 2026-08-26 19:45 UTC
**Phase:** Foundations
**Summary:** One authoritative frame-identity story, declared instead of implied. The artifact
now says so (`video.frame_id_space: "normalized"`, additive); `source_timing.json` is v2 and IN
the contract (`schemas/source-timing.schema.json`, validated via `contract.write_json`, named by
`video.source_map` / `source_map_reason`) and runs on EVERY path including retime — mapping on
the retimed clock, each observation carrying `real_capture_time_us` (world clock) beside its
unscaled container PTS; `scripts/retiming.py` makes the same retime decision. `cfr_target_fps`
snaps to {240,120,60,30}: a ~30fps import normalizes AT 30 (no duplicated frames — every public
id is one observation), odd rates snap UP (50→60, never drop), unknown stays 60. Corrections
provenance (C10): migration 0022 adds `{fps, artifact_revision}` to `head_markers`/`swing_stages`
(backfilled from each view's current values) + drops dead `swing_views.analysis_version`; write
paths stamp both, staleness is DERIVED at read (row fps ≠ view fps → flagged `stale`, additive),
all three clients (web hooks, mobile `useCorrections`) hide stale rows rather than merge them,
and `markViewReady` logs newly-stale counts (flag-never-delete — these rows are the only
hand-labelled club truth). `fpsDisagrees` wired: `VideoLayer.onReady` dev-warns when container
fps disagrees with declared. `playback_pad` now holds on mobile too: `useFramePlayer(bounds,
padMs)` freezes the shortfall at the wrap (rate-scaled, `playing` stays true, any takeover
cancels), fed by the artifact in `VideoLayer` — the equal lead-in property side-by-side needs.
Timeline fixture suite `test_timeline.py`: ten frozen classes (in-app 60/120/240, 30 import,
VFR, 240/30 slow-mo, non-keyframe remux start, missing capture fps, bad metadata, dual-view
clocks) + both platform seek rules at every snapped rate.
**Notes:** Geometry-drift oracle ran for real: 6iron2 re-analysed with the club detector into a
scratch dir, `compare_analysis.py` vs stored — zero numeric drift; only additive fields,
schema 9→10 (audio_impact), and the stored artifact's old experimental `club.variants.model_*`
(older burnin defaults, club code untouched). Workload-guard tests updated: a 30fps clip's
honest est_frames halved (1248, was 2496). All suites green: analyzer pytest (10 timeline + 3
timing tests new), web tsc+lint+vitest 267, mobile tsc+jest 581 (freeze-hold + stale-row tests
new), schema 153 + 6 contracts, shape-lock re-locked additive-only, migration applied clean to
local Postgres. Matrix #19 honored: seek math untouched. Device pass of the mobile freeze-hold
rides the existing OPEN Swing Report device-pass handoff row.

---

## 02 - Source & Trim Manifest End to End
**Completed:** 2026-08-26 18:00 UTC
**Phase:** Foundations
**Summary:** The authoritative source/trim manifest now travels with every upload, killing the
2,445-frame slow-mo class permanently. Schema `source-manifest` (packages/schema, additive-
locked, validated on both sides); pure client builders + the fixture matrix
(`sourceManifest.ts`/`.test.ts` — 30 import / 60·120·240 in-app / stamped slow-mo / nonsense
stamp / missing metadata / keyframe backstep, zero interpretation mismatches); the native trim
returns the boundaries it actually wrote and the probe/record results carry dims + audio
presence; both save paths (SessionScreen + import) build the manifest from the ORIGINAL's
facts, run the `judgeTrimmedClip` preflight (budgets mirror the worker guard) before any byte
uploads, and thread it through `processing.ts` to a third upload target (`createCapture` →
`source_manifest.json`, local-driver PUT route validating at the door). The DISPATCHER reads +
schema-validates the manifest at enqueue, logs present/absent/invalid onto the job row, and
threads `capture_fps`/`source_fps` through the job spec — the worker's four-URL world
untouched; the worker prefers spec facts over container tags in the guard and the retime,
fails terminally on manifest-vs-probe contradiction, and records
`capture_fps`/`capture_fps_source` provenance into `analysis.json.video.source` (additive
schema fields). `pickImpactSeed` now returns `{seedSec, confidence, candidates}` (versioned
`seed-v1`), and the WP-006 sanity check (`windowActivityConfidence`) warns-never-blocks via a
recenter/save-anyway sheet when the mark was dragged away from everything the take heard.
SWISH parity (C9) is pinned by shared PARAMETER fixtures (`tests/data/swish_parity.json`) +
`test_swish_parity.py` — including the discriminator case (a louder bare transient losing to
a quieter swung click).
**Notes:** All suites green: analyzer pytest (5 new manifest-facts tests + 3 parity tests),
web tsc+lint+vitest 267, mobile tsc+jest 575, schema 153 + 5 contracts in sync, shape-lock
additive both re-locks. NAMED SHORTFALLS: (1) the Kotlin half of the SWISH parity runner —
the expo-module has no gradle test infrastructure; the fixture file is written to be consumed
by it when it lands; (2) the on-device E2E (real Samsung slow-mo gallery clip → trimmed →
analyzes at 240-equivalent) is a HANDOFF row — needs the native dev build (new trim/probe
surface) and Taylor's own gallery; (3) WP-005 (visual trim fallback) deliberately NOT built
per the step's own note — the audio-confidence telemetry this step starts collecting is its
go/no-go input. DEVIATIONS: manifest presence is recorded on the JOB row at enqueue (where
the consumer decides) rather than at `source/complete` — better-placed than the step's
sketch, same fallback semantics; `client_detection.audio_confidence` was added to the schema
beyond the step's field list (the WP-005 telemetry needs it). DEPLOY ORDER: the Modal worker
must deploy before/with the web app — old workers refuse specs carrying the new fields.
Retries from `PendingSwingScreen` upload manifest-less by design (absent-tolerated).

---

## 01 - Production Safety & Correctness Quick Wins
**Completed:** 2026-08-26 17:30 UTC
**Phase:** Foundations
**Summary:** Closed the open incident paths and the audit's live bugs, no architecture moved.
The worker now ffprobes every source pre-GPU and terminally refuses oversized/unreadable work
(`guard_workload` in `service/jobrun.py` — >2,000 est. frames / >15s real / >4320px / unknown
codec, retime-aware, env-overridable, facts logged to the job row); deterministic failures
post `failed` and return normally so neither QStash nor `modal.Retries` can re-run them (the
75-GPU-min 2026-08-26 incident class). `clubVariants()` now defaults **false** (explicit
`JOBS_CLUB_VARIANTS=true` opts in — production shape 124.6s). `startCaptureAnalysis`'s queue
door gained the same guard order as re-analysis (live job returned as-is + shared
`refuseOverActorCap`), so a double `source/complete` mints one job, not two. Imports now run
the resolved detector (`resolveImpactSeeding` — swish by default, debug-menu pick in dev)
instead of Kotlin's silent ATTACK fallback, and a slow-mo import's take keeps the CONTAINER
frame clock (~30) with `slowMoFactor` alongside instead of a lying 240; poster sample times
are real seconds scaled onto the file clock (`posterSampleTimes`).
**Notes:** All suites green: analyzer pytest (11 new guard tests), web tsc+lint+vitest 267
(3 new admission tests over a fake tx driving real `completeCapture`), mobile tsc+jest 554
(new `useImportSwing` hook tests + poster test). `useImportSwing` now imports the camera
module statically — jest's VM cannot execute runtime `import()`, every host already loads the
module through `SwingReview`, and the global jest.setup mock only covers static imports.
Trimmed slow-mo imports currently LOSE their capture-fps stamp in the phone remux, so the
guard refuses them at container length rather than mis-analyzing — named in the decisions
entry; step 02's manifest lifts it. Decisions: variants entry edited in place + new workload-
guard entry + admission clause (docs/decisions/platform-data.md).

---

## 2026-08-26 — Track created; step 00 (Audit & Reconciliation) COMPLETE

- Read the full planning package `.claude/swingsage_video_analysis_plan_v2/` (15 docs +
  reference brief).
- Ran four parallel code audits (mobile pre-upload; server ingest/jobs/worker/artifacts;
  playback/frame-identity/corrections; analyzer internals) against the working tree on
  branch `swing-detection-and-player-rebuild`.
- Persisted: `AUDIT-current-state.md`, `AUDIT-analyzer.md`, `MATRIX-current-vs-target.md`
  (50-row matrix, conflicts C1–C12 with resolutions, migration architecture, removal table).
- Authored steps 00–14. Ordering: safety quick wins (01) → manifest (02) → frame identity +
  corrections provenance (03) → ground truth & evaluation (04) → telemetry (05) → shared
  decode refactor (06) → coarse pass + planner (07) → provenance/direct-only scoring (08) →
  club v2 (09) → events/impact fusion v2 (10) → progressive + deferred render (11) → runtime
  optimization (12) → reliability (13) → legacy removal & docs trueing (14).
- Headline audit findings that reshaped the plan:
  - Much of the plan's pre-upload and infra architecture already exists and is deployed
    (audio-first seed, lossless remux, user-mark isolation, two-phase R2 ingest, Modal L4
    worker, revision-immutable artifacts, retry taxonomy) — marked KEEP, not rebuilt.
  - Live bugs the plan didn't know about, front-loaded into steps 01–03: interpolated
    keypoints scored as measured (conf 0.45 > MIN_CONF 0.35, `st` never read downstream);
    imports run the ATTACK audio detector via a null fallback; slow-mo imports get a lying
    fps; JOBS_CLUB_VARIANTS defaults true in production (676.6 s vs 124.6 s); capture path
    has no admission control; corrections have no fps/revision provenance.
  - `source_timing.json` already builds the plan's frame manifest and has zero consumers —
    step 03 upgrades it rather than adding a second system.
  - `clubpath.viterbi_refine` is already a candidate-sequence DP — step 09 extends it.
  - The green-box head/shaft gate documented in the brief and auto-memory DOES NOT EXIST in
    code — step 09 resolves (implement as solver evidence or retire).
  - 27 club variants (not 13), 18 decode passes/job, ~12 GB residency on a 1,200-frame clip
    vs 16 GB worker — step 06 is the enabling refactor.
- Plan recommendation explicitly REJECTED: manifest-driven client seeking (matrix #19) —
  both platforms measure 100%-exact with current rules.
- Track overlap resolved (C12): step 04 delivers `analysis-ground-truth`'s club/event GT
  scope (that track reconciles); `media-pipeline` keeps transfer durability; `swing-ingest`
  keeps ingest UX.
