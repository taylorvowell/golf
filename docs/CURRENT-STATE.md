# SwingSage — Current State

**Snapshot date: 2026-08-07.** This document describes what is *built and working right now* —
verified against the tree, the artifacts on disk, and a green test run on this date. It contains
no plans, no roadmap, and no feature discussion. Where something does not exist, that absence is
stated as a fact, not a task.

---

## 1. The system in one paragraph

SwingSage analyses a 3–15 s golf swing clip offline. A Python pipeline (FastAPI-style worker,
run today via a CLI script) normalizes the video, extracts a 49-keypoint pose per frame, tracks
the club, detects the 8 canonical swing events and 10 P-system checkpoints, computes a full
angle/metric catalogue, and scores the swing against a versioned scoring config — writing one
`analysis.json` + `coach_report.json` per swing. A Next.js web app reads those artifacts and
renders a frame-accurate player (skeleton, club trace, angles, silhouette overlays), a real
scorecard, and per-swing correction tools, indexed in Postgres under a single seeded admin user.
Everything is deterministic CV — **no AI is involved anywhere in the current system**.

---

## 2. Repository layout

```
apps/web/               Next.js 16 App Router, TypeScript strict, Tailwind v4 — the real UI
services/analyzer/      Python worker: pipeline (swingsage/), CLI + debug scripts (scripts/),
                        scoring_config/, tests/, out/<swingId>/ artifacts (gitignored),
                        models/ (pose bundle, gitignored), runs/clubhead/ (trained detector)
fixtures/               5 newer clips (6iron ×3, 7wood ×2)
instructions/swing/     all 9 fixture clips, committed — the ground truth footage
docker-compose.yml      local Postgres 16 on port 5433
scripts/                repo-level helpers
```

pnpm workspace is rooted at the repo root. The analyzer venv is
`services/analyzer/.venv` — always run analyzer Python via `.venv\Scripts\python.exe`.
`services/analyzer/web/player.html` + `scripts/serve.py` are a superseded stopgap player kept
on disk; the Next.js app replaced them.

---

## 3. The analyzer pipeline

Entry point: `python scripts/burnin.py <video>` from `services/analyzer/` (flags:
`--view dtl|face_on`, `--handedness right|left`, `--club-detector`, `--club-type`,
`--scoring-config`, `--no-stage3/--no-club/--no-scoring/--no-silhouette`, etc.).

Stages, in execution order, all implemented in `services/analyzer/swingsage/`:

| Stage | Module | What it does |
|---|---|---|
| 0 normalize | `video.py` | ffmpeg VFR→CFR 60fps, rotation fix; writes `normalized.mp4` (1080, player source) + `analysis.mp4` (720 short side — what CV consumes) |
| 2 pose | `pose.py` + `pose_rtm.py` | MediaPipe PoseLandmarker as person localiser → RTMW wholebody 133-keypoint model for the real pose; hands from real knuckles |
| 2b silhouette | `silhouette.py` | Golfer outline masks off the MediaPipe pass, plus the address "butt line" posture line; assembled last because it needs the address hold. Writes separate `silhouette.json` (0.3–1.1 MB), fetched by the player only when its overlay is on. `scripts/resegment.py` adds it to an existing out/ folder |
| 3 post-process | `postprocess.py` | Confidence gating, anatomical priors, smoothing, interpolation (marked `interp: true`) |
| 5 events | `events.py` | The 8 GolfDB events (Address … Finish) from wrist trajectories, club-independent |
| 4 club | `club.py` + `club_detect.py` | Classical shaft/head tracking (motion mask → line candidates → angular profile) fused with a trained YOLO11s club-head detector (`runs/clubhead/weights/best.pt`, SHA-256 recorded in the artifact). `club.refine_events` snaps Impact to the club-head low point and requires the *club* still for the address hold |
| 4b face | `face.py` | Face-angle *checkpoint classification* only (square/open/closed) — never a fabricated degree number from video |
| 5b checkpoints | `checkpoints.py` | The 10 P-system positions; three are shaft-defined, hence it runs after Stage 4 |
| 6 metrics | `metrics.py` | Full angle catalogue (`metrics.angle_fields`) + per-checkpoint deltas, lead/trail resolved by handedness, drawing geometry (`geom`) per angle |
| 8 scoring | `scoring.py` | Deterministic scorecard + coach narrative against `scoring_config/v2.json`; writes `coach_report.json`. `scripts/rescore.py` re-runs *only* this stage over existing artifacts |

Per-swing output in `out/<stem>/`: `analysis.json`, `coach_report.json`, `silhouette.json`,
`normalized.mp4`, `analysis.mp4`, `overlay.mp4` (skeleton burned into pixels — the reference
render), `contact.jpg`, plus debug sheets from the check scripts.

**Operational trap that has bitten before:** re-running `burnin.py` on a committed fixture
without `--club-detector runs/clubhead/weights/best.pt` silently regenerates the club trace on
the weaker classical-only path and overwrites the better artifact. Always pass the detector
flag on fixture re-runs, whatever the reason for the run.

### Club-head detector (trained, wired, opt-in)

YOLO11s @ 640, 40 epochs, trained on Roboflow `golf-swing-vnwlh/golf-swing-msiuj` v9 (4,399
train images, CC BY 4.0). ~197 s/epoch on a GTX 1080 (Pascal needs `amp=False`; torch must be
the cu126 build). It contributes *evidence* into the classical angular profile
(`--club-detector-gain`, default 0.8) — `detector=None` is byte-identical to the classical
path. It is invoked per-run via flag, not on by default.

Two ball-related features exist and are **both off by default** because they fail on some
fixtures: `--club-ball-anchor` (place head on ball at Impact when nothing detected it there —
rescues `pro_2`, degrades `perfect` by overwriting a real detection) and `--club-ball-detect`
(find the ball by its disappearance — finds a shoe on two fixtures, nothing on two others).
Hand-placed markers (§6) are the supported correction path.

---

## 4. Data contracts

`analysis.json` is the single contract between analyzer and player. Properties currently
enforced (by the invariant test suite, not just convention):

- **All coordinates normalized 0–1** (x right, y down); renderable with no client-side
  computation beyond scaling.
- **49 keypoints, append-only order** fixed by `keypoint_names`: 33 native → 7 derived
  (`neck`, `mid_hip`, `spine_mid`, `head_center`, `grip_center`, `left_hand`, `right_hand`)
  → 8 measured (knuckles, small toes, `chin`, `nose_bridge`, jaw) → 1 derived-tail (`waist`).
  Only the wholebody model fills the measured block; other paths zero it and dependent metrics
  report `null`. `skeleton.strip_derived()` is the only correct way to remove derived joints —
  the two derived blocks are not contiguous.
- **`waist` is a rendering point only** — midpoint of `spine_mid` and `mid_hip`, never a
  scoring input.
- **Keypoint confidence is truncated to 5 decimals, not rounded** — so a client re-applying
  the same `MIN_CONF` gate can never include a point the analyzer dropped.
- `interp: true` marks smoothed/interpolated values; the UI renders these dashed at 60%.
- **Keypoints are anatomical (`left_wrist`); metrics are lead/trail (`lead_knee_flex`)**,
  with lead = side nearest the target, resolved by handedness (never by camera side).
  `metrics.sides` carries the mapping; `metrics.glossary` maps golf vocabulary onto fields.
- **Angle conventions differ by shape**: `_flex` is 0° = straight; `_hinge` is the interior
  angle; from-vertical angles are signed with camera-side-dependent sign; stack angles are
  90° = stacked. All 2D joint angles are projection-sensitive — `lead|trail_arm_in_plane`
  is the guard for reading elbows.
- **Strict event ordering** and `playback_window` pinned to `address − 1s … finish + 1s`
  (clips too short publish `playback_pad`; the player freezes the end frame).
- **`video.source.path` is verified before the artifact is written** (its one reader is the
  re-analyze flow).
- **Face-angle honesty**: video yields only checkpoint classifications; nothing in the system
  fabricates a face-angle degree from video.
- **Hand corrections never live in `analysis.json`** — the file is rewritten wholesale by
  every re-analysis, so corrections live in Postgres (`head_markers`, `swing_stages`) and are
  merged by frame at render time.

The trace drawn by the player and the per-frame club positions are different products: the
polyline is built once per segment and revealed frame-by-frame; gaps where the detector
declined are drawn as dashed straight chords, never interpolated (interpolation was tried and
lost to a straight chord on held-out data). Nine render-time smoothing methods are switchable
live in the overlay menu (`lib/traceSmoothing.ts`, default Savitzky-Golay); all keep endpoints
exact so the line head lands on the playhead.

---

## 5. Scoring (Stage 8)

- Config-versioned: `scoring_config/v2.json` is current, generated by
  `scoring_config/build_config.py`; `v1.json` is frozen on disk so v1-stamped reports stay
  reproducible. Every `coach_report.json` records `scoring_model_version`. No threshold is
  hardcoded in code.
- **38 checks authored; 28 score, 10 are `deferred`** — present in the config but abstaining on
  every swing because the metric behind them is not trustworthy. The largest deferred family is
  rotation: the current turn estimate (`arccos` of projected width) is signless, V-shaped
  through square, and under-reads true turn by roughly half, so all nine rotation checks
  abstain rather than emit confident nonsense. `scoring_config/COVERAGE.md` lists every check's
  status and reason.
- `overall` is weighted over individual measured checks (not category means); `n_total`
  excludes deferred checks. Slow-motion clips are detected (one-sided backswing-duration test)
  so absolute-duration checks don't punish the camera.
- Stage 8 is a **pure function of `analysis.json` + the config** — `scripts/rescore.py`
  re-scores every `out/` folder without re-running CV.
- `scripts/validate_scoring_config.py` (also a pytest) proves every config field resolves
  against real pipeline output. Known limit, learned the hard way: it proves a field *exists*,
  never that it *means* what the band assumes — a check scoring 100 is not evidence it works.
- The coach narrative (findings, priorities, primary fix, drill) is generated
  deterministically from the weakest checks. It is not AI.

---

## 6. The web app

Next.js 16 App Router (`apps/web`), TypeScript strict, Tailwind v4. The design system lives
entirely in the app itself: theme tokens in `globals.css` `@theme` (Tailwind v4 reads theme
from CSS, not a JS config), and the shared card/panel shapes as named components in
`components/ui/kiosk.tsx` — use those rather than inventing a new panel.

**Pages:** `/` (swing list, Postgres-backed, sortable by denormalized score/band) and
`/swing/[id]` (the workspace).

**API routes:** `GET /api/swings`, and per swing: `analysis`, `silhouette`, `markers`,
`stages`, `reanalyze` (POST start / GET poll), `thumb`, `video`. Media is served off disk from
`SWINGSAGE_MEDIA_ROOT` (the analyzer's `out/`).

**The player** (`SwingWorkspace` → `SwingStage` + three folder tabs):

- Frame-accurate sync: CFR-60 source makes `frame = round(currentTime * fps)` exact; seeks to
  `(frame + 0.5) / fps`; `requestVideoFrameCallback` during playback with rAF fallback; canvas
  stack `video → skeleton → club → trace → annotations`; a live frame-sync drift meter exists
  as a debug panel.
- Overlay menu: skeleton, club, trace (9 smoothing variants), silhouette, butt line, angles —
  clicking any row of the angle table draws that angle over the video using the `geom` the
  analyzer shipped.
- Tabs: **Overview** (golfer + scorecard), **Coach** (narrative), **Advanced**
  (measurements-only angle catalogue + `CriteriaBreakdown` of every scored check).
  All score UI reads the real `coach_report.json` — there is no mock scoring anywhere.
- **Comparison view**: side-by-side second swing pane (`ComparisonPane`, `swingSync.ts`,
  `proSwings.ts`), enabled by every clip sharing the pinned 1 s lead-in/run-out.
- **Correction tools**, both writing Postgres, both surviving re-analysis:
  "modify head markers" (click to place the club head per frame → `head_markers`) and
  swing-stage keyframe overrides ("this frame is the top" → `swing_stages`, one row per stage
  enforced by unique index).
- **Re-analyze** from the video's settings gear: POSTs a job, polls stage/progress, ~90 s,
  reloads on completion, and syncs the fresh `coach_report.json` into the `scores` table. Job
  ownership belongs to the page; an orphaned job (dead worker) is settled by reading
  `.analysis.lock` + artifact mtime so a row can't stay "running" forever.

Server/client discipline: `lib/scoring.ts` (reads disk/Postgres) is server-only;
`lib/scoreDisplay.ts` (types + `scoreColor`/`scoreBand`) is the client-safe split. Importing
the former from a `"use client"` component would pull the Postgres client into the browser
bundle — the split exists to prevent exactly that.

Dev-environment specifics already handled in config: `next.config.ts` enumerates LAN IPs into
`allowedDevOrigins` (Next 16 otherwise blocks `/_next/*` cross-origin for phones); use
`127.0.0.1`, not `localhost` (resolves to `::1` first on this machine).

---

## 7. Persistence

Postgres 16 via Drizzle ORM — local in Docker on **port 5433**, migrations in
`apps/web/drizzle/`. Seven tables (`apps/web/src/db/schema.ts`):

| Table | Holds |
|---|---|
| `users` | Real rows with FK'd ownership from the first migration; exactly one seeded "admin" user exists; no auth provider is wired |
| `sessions` | Practice-session grouping (date/location/notes) |
| `swings` | One row per `out/<id>/` folder — id **is** the folder name; view/club/handedness, media path, status enum, denormalized `overall_score`/`band`/`scoring_model_version` for the list's hot path |
| `jobs` | Doc-02-style job protocol rows (stage, progress_pct, message, log), durable across hot-reloads; an in-process mirror serves the actively-running job so the per-frame stdout path never round-trips the DB |
| `scores` | The full scorecard as jsonb + real columns for overall/band/version; source of truth behind the swings denormalization |
| `head_markers` | Hand-placed club-head positions, normalized 0–1, unique per (swing, frame) — the project's first hand-labelled club-head truth |
| `swing_stages` | Hand-corrected event keyframes, unique per (swing, stage) |

Commands (repo root unless noted): `docker compose up -d`, then from `apps/web`:
`pnpm db:migrate`, `pnpm db:seed`, `pnpm db:backfill` (idempotent — indexes every `out/`
folder + syncs scores), `pnpm db:generate`, `pnpm db:studio`.

**Known seam:** `burnin.py` run from the CLI does not touch Postgres. A manually re-analysed
fixture shows a stale score in the swing list until `pnpm db:backfill` runs.

`analysis.json` on disk remains the CV artifact of record; the DB is the queryable index and
score/job/correction store on top of it. Because analysis is a stored artifact, "re-analyze"
can re-run improved models over historic swings.

---

## 8. Fixtures and measured state (as of this snapshot)

Nine committed clips in `instructions/swing/`; **seven analysed** into `out/` and scored
against `scoring_config/v2.json` (verified from `coach_report.json` on disk today):

| Fixture | Overall | Band |
|---|---|---|
| perfect | 79.9 | Pure |
| 6iron-1 | 73.3 | Solid |
| 6iron3 | 69.8 | Solid |
| swing1 | 69.6 | Solid |
| 6iron2 | 68.5 | Solid |
| pro_2 | 61.6 | Solid |
| swing2 | 57.9 | Building |

`7wood-1.mp4` and `7wood-2.mp4` are committed but have no `out/` folder yet.

Measured pipeline quality (recorded 2026-08-04/06 on the two original fixtures; confidence
figures are post-rescale — anything ever recorded as "@ 1.00" measured a clamp, not the model,
and is not comparable):

- Pose: all key joints 94–100%; `grip_center` 94.2% @ 0.73 (swing1), 90.9% @ 0.71 (swing2).
  RTMW recovered far-side limbs MediaPipe lost entirely (left_elbow 10% → 99%).
- Club detector contribution: 114/396 frames (29%) on swing1, 298/341 (87%) on swing2; on
  swing2 it fixed a visibly wrong finish direction.
- Impact agrees with the club-head low point within ±2 frames on both original fixtures.
- Tempo: 2.09:1 (swing1), 1.55:1 (swing2, self-flagged implausible).

**Honesty caveats that are part of the current state:**

- **No hand-labelled event frames exist.** `tests/fixtures.json:hand_labeled` is null for both
  frozen clips, so event accuracy is internally consistent but *unverified* — an earlier
  version of the status claimed "verified ±2 frames" while Address was 48 frames early on
  swing1. The hand-label tests skip rather than pass vacuously.
- **No club-head position-error metric exists.** Every club change so far has been tuned on
  proxies (smoothness, off-plane deviation), and smoothness has actively preferred wrong
  answers at least once. Coverage percentages have overstated club quality three separate
  times; only rendering onto real frames caught it.
- **Top of backswing is a hand landmark, not a club one.** The club is still travelling back
  when the phase flips (15 frames on swing2), so tempo reads low on all fixtures
  (1.55–2.47 vs a typical 3:1). Four club-based redefinitions disagree by more than the
  transition is long; unresolved.
- Some 2D joint angles are visibly wrong when a limb points near the camera axis (swing2 trail
  elbow 172° at P3; lead hip hinge 179.8° at P4). The arm-in-plane fields quantify it for the
  arms; the hip hinge has no equivalent guard.
- All thresholds/bands are authored from coaching definitions, not calibrated against a real
  fixture population.

---

## 9. Tests

`python -m pytest tests` from `services/analyzer` — **37 passed, 2 skipped, 1 xfailed, ~2 s**
on this snapshot date. Hermetic: the suite replays the deterministic stages over *frozen* pose
and club output committed in `tests/data/*.input.json.gz` (~130 KB/clip; regenerate
deliberately with `scripts/make_test_data.py --all` when pose genuinely changes).

Three kinds of check:

- **Golden snapshots** (`test_stages.py`) — prove nothing has *changed* (including Stage 8
  scoring). `--update-golden` rewrites them and then fails the run on purpose.
- **Contract invariants** (`test_invariants.py`) — no golden file needed: 49-keypoint
  append-only order, normalized coordinates, truncated confidence, strict event ordering,
  playback-window containment, tempo self-consistency.
- **Hand-label tests** (`test_hand_labeled.py`) — the only thing that would prove correctness;
  currently **skip** because the label slots are null. The fixture-count check xfails (frozen
  clips are 2 of a wanted 10).

---

## 10. Verification & debug tooling

The debug scripts are a first-class asset — they have caught wrong-but-healthy-looking numbers
repeatedly. All run from `services/analyzer` against an `out/<stem>` folder:

| Script | Shows |
|---|---|
| `checkclub.py` | The club drawn over the real frame at each event — run before trusting anything club-related |
| `checktrace.py` | The drawn *polyline* specifically: reach to the ball, every unmeasured bridge with its chord, fidelity, playhead mapping error |
| `clubdebug.py` | Motion mask → candidates → chosen shaft |
| `checkball.py` | Ball, Address club head, and the disappearance image (`--live` re-runs the search) |
| `checkbutt.py` | Stored silhouette + address butt line over real frames (artifact-only — shows what the player draws) |
| `checktop.py` | Every candidate top-of-backswing signal side by side with the tempo each implies |
| `checkangles.py` | Every angle the player *draws* vs the value it *labels*, per frame |
| `kpdebug.py` | RTMW's 133 sub-indices drawn + asserted on a real frame |
| `qa.py` | Grip-height trace / frame sheets |
| `exp_*.py` | The four failed classical club-tracking experiments, kept as negative results |

Verification gates for the player: Gate 1 `overlay.mp4` proves pose with sync impossible as a
variable (drawn in-process); Gate 2 the player's frame-sync panel proves sync with pose
irrelevant; Gate 3 canvas-vs-burn-in comparison proves the combination.

---

## 11. Toolchain

Two dev machines, versions differ and both work — nothing is pinned to these numbers:
ffmpeg 8.1.2/9.0 (use `-fps_mode cfr`), Python 3.13/3.14 (venv at `services/analyzer/.venv`),
mediapipe 1.0.0 (Tasks API only — legacy `mp.solutions.pose` is gone; monotonic-timestamp
constraint applies), opencv-python 5.0.0, numpy 2.5.1, torch 2.13.0+cu126 (detector only;
plain `pip install torch` silently gives CPU — assert `torch.cuda.is_available()`),
ultralytics 8.4.115, rtmlib + onnxruntime (RTMW weights self-download to `~/.cache/rtmlib`),
Node 22 / pnpm 10–11, Postgres 16 (Docker), Drizzle ^0.45 / drizzle-kit ^0.31.

Pose model bundle: `services/analyzer/models/pose_landmarker_heavy.task` (30.6 MB, gitignored —
re-download from the MediaPipe models URL). One machine has a GTX 1080 (8 GB, CUDA 12.6);
Pascal requires `amp=False` for training.

Run: `docker compose up -d` → `pnpm i` → `pnpm dev` (127.0.0.1:3000) for the app;
`.venv\Scripts\python.exe scripts/burnin.py <clip> --club-detector runs/clubhead/weights/best.pt`
per fixture, then `pnpm db:backfill`.

---

## 12. What does not exist

Stated as fact, with no implied ordering or plan:

- **No upload flow.** Analysis is started by hand (`burnin.py`) or via the web app's
  re-analyze button on an already-indexed swing. There is no job queue beyond the DB-backed
  reanalyze job.
- **No AI anywhere.** No AI provider abstraction, no Claude integration, no AI-generated
  narrative — the coach text is deterministic Stage 8 output. (`AI_PROVIDER`, prompt
  directories, and the provider interface are unimplemented.)
- **No simulator ingestion.** Launch-monitor screenshots and impact images are not parsed;
  consequently no authoritative face-angle degrees exist anywhere in the system.
- **No auth.** One seeded admin user owns every swing; `users.email` is nullable and no
  provider is wired. The schema carries real `user_id` FKs throughout, so auth is a data
  change, not a schema change.
- **No production deployment.** Postgres runs locally in Docker; no hosted environment is
  provisioned. Media is local disk (`SWINGSAGE_MEDIA_ROOT`), not object storage — the schema's
  `media_path` is backend-agnostic by design.
- **No hand-labelled ground truth** for events or club-head position (beyond whatever
  `head_markers` rows have been placed by hand in the player).
- **No second camera view per swing** — all angles are single-view 2D projections.
- **No live capture** — by design, uploads only; the frontend never runs CV.
