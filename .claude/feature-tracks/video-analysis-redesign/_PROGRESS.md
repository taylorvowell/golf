# video-analysis-redesign — Progress Log

Append-only.

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
