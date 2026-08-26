# Current vs Target — Compatibility Matrix, Conflicts, Migration Architecture

**Date:** 2026-08-26. Derived from `AUDIT-current-state.md` + `AUDIT-analyzer.md` against
`.claude/swingsage_video_analysis_plan_v2/`. This file is the reconciliation the step files
implement. Classifications: ALREADY IMPLEMENTED / PARTIALLY IMPLEMENTED / COMPATIBLE AS-IS /
NEEDS REFACTOR / NEEDS REPLACEMENT / NEW CAPABILITY / NO LONGER RECOMMENDED / REQUIRES
MEASUREMENT. Action verbs: KEEP / EXTEND / REFACTOR / MIGRATE / REPLACE / DELETE.

## 1. The matrix

| # | Capability (plan ref) | Current implementation | Classification | Action → step |
|---|---|---|---|---|
| 1 | User mark = trim-only (D1) | Mark discarded on device, never uploaded; analyzer independent | **ALREADY IMPLEMENTED** (stronger than plan) | KEEP. Manifest (02) may carry audio candidates as explicitly non-authoritative metadata; never the user mark as an impact field |
| 2 | Audio-first trim seed (01 §2) | SWISH 9-method detector, warped scrubber, sub-second | **ALREADY IMPLEMENTED** | KEEP; EXTEND with confident/ambiguous/none API (WP-004) → 02 |
| 3 | Lossless keyframe-safe remux (01 §2.12) | MediaMuxer, SEEK_TO_PREVIOUS_SYNC, +0.1 s pad | **ALREADY IMPLEMENTED** | KEEP; EXTEND: record actual remux boundaries into manifest → 02 |
| 4 | Source/trim manifest (D10, WP-001..002) | Nothing uploaded; phone already probes captureFps on import | **NEW CAPABILITY** | BUILD → 02. Kills the 2,445-frame bug class |
| 5 | Local post-remux preflight (WP-003) | None | **NEW CAPABILITY** | BUILD → 02 |
| 6 | Trim window sanity check (WP-006) | None | **NEW CAPABILITY** (small) | BUILD → 02 |
| 7 | Conditional visual trim fallback (D9, WP-005) | None; fallback = duration−6 s heuristic | **REQUIRES MEASUREMENT** | DEFER inside 02: build only if manifest telemetry shows weak-audio rate justifies it; feature-flagged |
| 8 | Two-phase ingest, signed R2, verified complete | Deployed, proven | **ALREADY IMPLEMENTED** | KEEP; EXTEND: accept + validate manifest → 02 |
| 9 | Server workload guard pre-GPU (S0, WP-007) | None — the 75-GPU-min incident path is open | **NEW CAPABILITY** | BUILD → 01 |
| 10 | Retryable vs terminal taxonomy (WP-012) | Transfer layer has it; Modal retries deterministic timeouts; classes not persisted | **PARTIALLY IMPLEMENTED** | EXTEND → 01 (timeout/oversize terminal), 13 (persisted failure_class) |
| 11 | Idempotency (10 §2) | targetRevision pinning + alreadyTerminal + 409s | **PARTIALLY IMPLEMENTED** | EXTEND → 13 (input-fingerprint reuse); capture-path single-flight → 01 |
| 12 | Stage checkpoints/resume (WP-011) | None; only rescore.py partial re-run | **NEW CAPABILITY / REQUIRES MEASUREMENT** | BUILD scoped → 13, sized by post-planner stage costs (checkpoint pose output first; don't build a framework) |
| 13 | Orphan lease/sweeper (10 §10) | Poll-driven reconcile only; silent `.catch()` | **PARTIALLY IMPLEMENTED** | EXTEND → 13 (cron sweep + surfaced write failures) |
| 14 | Stage timing/cost telemetry (WP-013) | Printed, never stored; jobs.log 200 lines; elapsedS only | **PARTIALLY IMPLEMENTED** | EXTEND → 05. Seam with `observability-and-slos` track |
| 15 | Progressive revisions (WP-034/035) | Single terminal artifact; clients poll | **NEW CAPABILITY** | BUILD → 11, as staged writes of the SAME artifact family (see conflict C3) |
| 16 | Deferred presentation render (D8, WP-036) | overlay.mp4 + contact.jpg inside critical path; poster route already gives thumbs | **NEEDS REFACTOR** (cheap, high value) | REFACTOR → 11 |
| 17 | Source-frame manifest (D3, WP-008) | `source_timing.json` builds the map; no consumer; skipped on retime; outside contract | **PARTIALLY IMPLEMENTED** | REFACTOR/EXTEND that module into the authoritative manifest → 03. Never a second system (C1) |
| 18 | Canonical playback mapping (WP-009) | One CFR file = analysis + playback; 1:1 for in-app takes; retime handles slow-mo | **COMPATIBLE AS-IS**, one violation | KEEP shape; REFACTOR: stop 30→60 frame duplication (native-rate CFR incl. 30) → 03 |
| 19 | Manifest-driven client seeking (03 §8) | Measured 100%-exact platform rules (f/fps Android, (f+0.5)/fps web) | **NO LONGER RECOMMENDED** | KEEP current rules. Adopting manifest-resolved seeks is churn against a measured-perfect mechanism. Manifest matters for imports/VFR edge cases only |
| 20 | Corrections frame provenance (09 §11) | head_markers/swing_stages keyed on raw frame, no fps/revision; re-analysis at new rate silently relocates them | **NEEDS REFACTOR** (correctness hole) | REFACTOR → 03 (columns + guard + migration) |
| 21 | Timeline test fixtures (03 §10) | test_retime (4 tests) only | **NEW CAPABILITY** | BUILD → 03 |
| 22 | Pose cadence policy (D2, WP-014/015) | Every frame, batch 1, both models | **NEW + REQUIRES MEASUREMENT** | BUILD planner → 07; cadence set by E2.1 ablation, never opinion |
| 23 | Provenance vocabulary (D4, WP-016) | `st` codes exist per keypoint; chain severed (INTERP conf 0.45 > MIN_CONF 0.35; metrics/scoring never read st) | **PARTIALLY IMPLEMENTED + live correctness bug** | FIX the severed chain → 08; map st → plan vocab additively |
| 24 | direct_only scoring gates + forced frames (WP-017, 04 §9) | None; scoring sees no provenance | **NEW CAPABILITY** | BUILD → 08 |
| 25 | Display propagation w/ provenance (04 §6) | Interp/smoothing exists, marked st=INTERP | **PARTIALLY IMPLEMENTED** | EXTEND → 07/08 (propagation between sparse direct frames, confidence decay) |
| 26 | Person ROI reuse (04 §3) | MediaPipe full-frame every frame IS the localizer; RTMW already crops via its boxes | **NEEDS REFACTOR / REQUIRES MEASUREMENT** | Coarse pass may replace every-frame MediaPipe → 07 experiment |
| 27 | Pose model/runtime alternatives (04 §2) | RTMW only | **REQUIRES MEASUREMENT** | Benchmark → 12 (P8-class; only after gates exist) |
| 28 | Intra-clip batching + session reuse (07 §3) | Batch 1; RTMPose session rebuilt per job | **NEEDS REFACTOR** | Session reuse + batch sweep → 06 (reuse) / 12 (sweep) |
| 29 | Shared decode / GPU decode (07 §4) | 18 decode passes, zero sharing, OpenCV sequential | **NEEDS REFACTOR** (blocker for 240 fps regardless of plan) | Frame-provider refactor → 06; NVDEC benchmark → 12 |
| 30 | 5-keypoint club pose (D6, WP-022/023) | YOLO head+stick boxes + classical shaft profile | **NEW CAPABILITY** | BUILD → 09, gated on GT (E3.1 first) |
| 31 | Club candidate retention + sequence solver (WP-024/025) | `model_viterbi` IS a candidate-sequence DP; raw boxes all stored | **PARTIALLY IMPLEMENTED** | EXTEND viterbi into the v2 solver → 09 |
| 32 | Sparse full-frame detector + crop propagation (05 §4) | YOLO every frame full-frame 640 | **NEW CAPABILITY** | BUILD → 09 (stride experiments E3.3) |
| 33 | Honest gap policy (D7, WP-026) | Dashed chords, missing stays missing, trace_enabled honored | **ALREADY IMPLEMENTED** | KEEP (plan explicitly affirms) |
| 34 | Club ground truth + metrics (WP-020/021) | head_markers rows only; no position-error metric ever | **NEW CAPABILITY** | BUILD → 04 (absorbs `analysis-ground-truth` club scope) |
| 35 | Green-box head/shaft corroboration | **Does not exist in code** (memory + brief claim it does) | conflict | RESOLVE → 09 (implement as solver evidence or formally retire the rule) |
| 36 | Blur-aware club model (05 §10) | `blurred` flag stored per frame | **REQUIRES MEASUREMENT** | Experiment → 09 (E3.5), adopt only on positional win |
| 37 | Coarse-to-fine events (06 §3) | events.detect (cheap, per-clip) + club.refine_events IS coarse-to-fine | **PARTIALLY IMPLEMENTED** | EXTEND: native-window refinement under planner → 10 |
| 38 | Impact multimodal fusion (D5, WP-032) | Independent witnesses exist (club low-point, audio agree-flag, ball disappearance, body phase); no fusion, no evidence breakdown; one known 40-frame miss | **PARTIALLY IMPLEMENTED** | BUILD calibrated fusion → 10, gated on event GT |
| 39 | Event ground truth (08 §5) | audio_truth.json (5 clips, audio only); hand event labels null | **NEW CAPABILITY** | BUILD → 04 (absorbs `analysis-ground-truth` event scope) |
| 40 | Server audio features + A/V offset (WP-031) | audio_impact.py + measured 121–148 ms record-path latency | **PARTIALLY IMPLEMENTED** | EXTEND → 10 (offset per path, sample timestamps) |
| 41 | Metrics/scoring dependency engine (WP-033) | Conf/view/club gates + abstention exist; no provenance/confidence deps per metric | **PARTIALLY IMPLEMENTED** | EXTEND scoring config schema (versioned) → 08 |
| 42 | Golden-set CI (WP-042) | Golden snapshots (stale), compare_analysis.py, hermetic frozen inputs (2 clips, stale) | **PARTIALLY IMPLEMENTED** | EXTEND → 04 (GT-backed gates, machine diff), refresh frozen data |
| 43 | Shadow-mode dual-run (WP-043) | None | **NEW CAPABILITY** | BUILD minimal → 09/10 use it; framework only when 2nd consumer exists |
| 44 | Runtime opt: FP16/TensorRT/INT8/GPU class/warm (WP-037..041) | None; scale-to-zero + 300 s scaledown exist | **REQUIRES MEASUREMENT** | Experiments → 12, golden-parity gated, one at a time |
| 45 | Dollars/accepted-view cost model (07 §7) | elapsedS only | **NEW CAPABILITY** | BUILD → 05 (fields) + 12 (model) |
| 46 | Ball windows only (S5) | find_ball/anchor_ball off by default; disappearance witness exists; no full-clip ball stage exists today | **COMPATIBLE AS-IS** | KEEP; formalize windows in planner → 07/10 |
| 47 | Silhouette setup-frames-only (S8) | Silhouette rides MediaPipe every frame at +2 s cost; payload full-clip | **COMPATIBLE AS-IS (cheap)** | KEEP while it rides the pose pass; revisit only if coarse pass replaces MediaPipe (07) |
| 48 | 49-keypoint contract via adapter (12 §3) | packages/schema + shape-lock + producer validation | **ALREADY IMPLEMENTED** | KEEP; all artifact changes additive |
| 49 | Progress = real milestones (10 §7) | Verbatim pct, monotonic stages, no fake % | **ALREADY IMPLEMENTED** | KEEP; unify the two stage vocabularies → 05/14 |
| 50 | Variants machinery (27/job) | Default ON in production (676.6 s vs 124.6 s) | **NO LONGER RECOMMENDED as default** | Flip default OFF → 01; DELETE machinery when Taylor's club-trace verdict lands (open HANDOFF row) → 14 |

## 2. Architecture conflicts and their resolutions (STEP 4 of the brief)

- **C1 — Two frame-identity systems.** Plan's `source_frame_id` vs today's normalized-CFR
  index (used by artifacts, both players, corrections, head_markers). RESOLUTION: the
  normalized frame index at native capture rate REMAINS the one public frame identity — for
  in-app takes it is already 1:1 with source frames. `source_timing` is upgraded (03) to the
  authoritative source↔public mapping for imports/VFR/slow-mo, inside the contract. No second
  ID namespace is ever introduced; the plan's schemas are satisfied by declaring
  `source_frame_id ≡ normalized index` plus the manifest for the exceptional mappings.
- **C2 — Two timestamp systems.** Retimed clips currently skip source_timing entirely.
  RESOLUTION: 03 makes the manifest mandatory on every path (retime included) or the artifact
  says why not; capture-clock facts come from the 02 manifest, not container tags.
- **C3 — Two artifact formats.** Plan's `rev-0001-coarse.json …` family vs `analysis.json`.
  RESOLUTION: progressive revisions (11) are earlier partial writes of the SAME schema
  (additive `partial`/`complete_stages` fields + revisioned keys under the existing `r<n>`
  prefix), not a parallel format. Old clients keep reading final `analysis.json` unchanged.
- **C4 — Two job orchestration systems.** RESOLUTION: none is added. jobs table + QStash +
  Modal stay. The spawn driver's stdout-regex scraping is the legacy path: 05 unifies stage
  vocabulary on structured events; 14 deletes the scraper (removal condition: spawn driver
  consumes events, or spawn is retired to burnin-only).
- **C5 — Duplicate pose pipelines during migration.** RESOLUTION: no fork of pipeline.py.
  Frame policy is a versioned config consumed by ONE pipeline; shadow runs are the same
  pipeline at a different policy version, outputs to a shadow artifact name. Flag removal
  condition per flag (see §4).
- **C6 — Duplicate club trackers.** RESOLUTION: v2 club path (09) is built behind
  `club_pose_v2` policy; the classical path remains THE production geometry until GT gates
  pass; then classical every-frame solve + variants machinery are DELETED in 14 (not kept as
  fallback — the gap policy covers low-confidence output).
- **C7 — Duplicate event detectors.** Same pattern: fusion v2 shadow-computes alongside
  current refine_events; disagreements reviewed; promote then delete the old impact snap as a
  standalone authority (it becomes one evidence input).
- **C8 — Conflicting confidence semantics.** RTMW conf is a rescale, audio conf is
  separation, event conf is sharpness. RESOLUTION: never merged into one number (plan 04
  §10); artifact documents per-field semantics; calibration only where GT exists (04).
- **C9 — SWISH duplicated Kotlin/Python.** Deliberate twin (client seed vs server witness).
  RESOLUTION: keep, but 02 adds shared parity fixtures (same clip → same candidates within
  tolerance) so drift is caught; constants documented as paired.
- **C10 — Corrections ambiguity.** Fixing frame identity (03) WITHOUT correction provenance
  corrupts the only hand-labelled club truth. 03 does both atomically.
- **C11 — Legacy paths that would linger.** Named with removal conditions in §4: stdout
  scraper, spawn driver, variants machinery, dead columns (`analysis_version`), dead code
  (crop_scale/swing_bbox/remap_to_full), unreferenced weights, web/player.html, isolation
  CLI-only artifacts (either add to pipeline behind a flag or remove the routes).
- **C12 — Track overlap.** `analysis-ground-truth` (planned): step 04 delivers its club/event
  GT + evaluator scope — that track RECONCILEs rather than duplicating. `media-pipeline`
  (planned): keeps resumable/background/wifi upload; 02 deliberately does NOT build those.
  `swing-ingest` (planned): keeps golfer-facing validation UX; 01/02's guards are the server
  half it will surface. `swing-isolation` (future): untouched; the visual fallback (item 7)
  is trim-window-only, not swing isolation.

## 3. Recommended migration architecture (end state)

```
client: audio seed → mark → sanity check → remux → preflight → manifest → direct R2 upload
server: S0 guard(manifest+probe+budget) → frame manifest (source_timing v2, in contract)
        → coarse pass (~30 Hz pose, motion, event neighborhoods, active window)
        → planner (versioned policy → explicit frame sets, stored in artifact)
        → body refine (≤60 Hz active + forced event frames; provenance-threaded)
          / club v2 (sparse region detector → crops → 5-pt pose → candidates → solver)
          / ball windows
        → event native refinement + calibrated impact fusion (evidence breakdown)
        → metrics/scoring with provenance+confidence gates (abstention structured)
        → analysis_ready (progressive partials en route)  → deferred render
one frame identity; one artifact family; one job system; GT-gated promotion; measured runtime
```

## 4. Temporary mechanisms and their removal conditions (STEP 14 of the brief)

| Mechanism | Purpose | Owner step | Removal condition | Removal step |
|---|---|---|---|---|
| `frame_policy` version pin to "legacy every-frame" | old behavior reproducible during shadow | 07 | cadence ablation passes gates + rollout complete | 14 |
| `club_pose_v2` policy flag + shadow artifacts | club A/B against GT | 09 | GT gates pass (05 §13 of plan) and promote | 14 (delete classical solve + variants) |
| `impact_fusion_v2` shadow | disagreement review | 10 | catastrophic-miss + calibration gates pass | 14 (old snap demoted to evidence) |
| stdout stage scraping (spawn) | local dev progress | pre-existing | spawn consumes structured events / retired | 14 |
| variants machinery (27/job) | trace-winner comparison for Taylor | pre-existing | Taylor's verdict (open HANDOFF row) | 14 |
| container-tag fps fallback in S0 | old clients without manifest | 02 | client version floor raised past manifest ship | 14 |
| corrections legacy rows w/o fps provenance | pre-migration data | 03 | backfill migration verified | 03 (same step) |
