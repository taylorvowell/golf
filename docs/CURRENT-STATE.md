# SwingSage — Current State

**Snapshot: 2026-08-09.** What is *built and working right now*, verified against the tree, the
artifacts on disk, and a green test run on this date. No plans, no roadmap, no history. Where
something does not exist, that absence is stated as a fact, not as a task.

The product target is [`.claude/ai-instructions/PROJECT_MAIN.md`](../.claude/ai-instructions/PROJECT_MAIN.md).
Measured against it, what exists today is a **proof of concept of the analysis core** — the CV
pipeline and a desktop-web player that proves the analysis is real. The application, platform
and business layers around it are unbuilt. [`PRODUCT-COVERAGE.md`](PRODUCT-COVERAGE.md) is the
section-by-section gap.

---

## 1. The system in one paragraph

SwingSage analyses a 3–15 s golf swing clip offline. A Python pipeline, run today via a CLI
script, normalizes the video, extracts a 49-keypoint pose per frame, tracks the club, detects
the 8 canonical swing events and 10 P-system checkpoints, computes a full angle/metric
catalogue, and scores the swing against a versioned scoring config — writing one
`analysis.json` + `coach_report.json` per swing. A Next.js web app reads those artifacts and
renders a frame-accurate player (skeleton, club trace, angles, silhouette overlays), a real
scorecard, and per-swing correction tools, indexed in Postgres under a single seeded admin
user. Everything is deterministic CV — **no AI is involved anywhere in the current system**.

---

## 2. Repository layout

```
apps/web/               Next.js 16 App Router, TypeScript strict, Tailwind v4 — the real UI
services/analyzer/      Python worker: pipeline (swingsage/), CLI + debug scripts (scripts/),
                        scoring_config/, tests/, out/<swingId>/ artifacts (gitignored),
                        models/ (pose bundle, gitignored), runs/clubhead/ (trained detector)
fixtures/               local test footage, gitignored — 10 analysis-ready clips at the top,
                        fixtures/raw/ holds the uncompressed phone originals (270–330 MB each)
.claude/                build system: ai-instructions/ (north star + step template), skills/,
                        agents/, commands/, rules/, ROADMAP.json
docs/                   this file, PRODUCT-COVERAGE, DECISIONS, GLOSSARY, METRICS
docker-compose.yml      local Postgres 16 on port 5433
```

pnpm workspace is rooted at the repo root. The analyzer venv is `services/analyzer/.venv` —
always run analyzer Python via `.venv\Scripts\python.exe`.
`services/analyzer/web/player.html` + `scripts/serve.py` are a superseded stopgap player kept
on disk; the Next.js app replaced them.

---

## 3. The analyzer pipeline

Entry point: `swingsage.pipeline.run(AnalysisRequest)` — the whole composition, the
`analysis.json` doc assembly and the output lock live there. `python scripts/burnin.py <video>`
from `services/analyzer/` is the thin CLI over it (flags: `--view dtl|face_on`,
`--handedness right|left`, `--club-detector`, `--club-type`, `--scoring-config`,
`--no-stage3/--no-club/--no-scoring/--no-silhouette`, etc.). The printed stage lines are a
compatibility surface — `apps/web/src/lib/jobs.ts` parses them for progress.

Stages, in execution order, all in `services/analyzer/swingsage/`:

| Stage | Module | What it does |
|---|---|---|
| 0 normalize | `video.py` | ffmpeg VFR→CFR 60 fps, rotation fix; writes `normalized.mp4` (1080, player source) + `analysis.mp4` (720 short side — what CV consumes) |
| 0b source timing | `source_timing.py` | Per-packet PTS read off the *original* upload (demux only), mapping each true camera observation to the normalized frames that display it. Sidecar `source_timing.json`; deliberately outside the `analysis.json` contract |
| 2 pose | `pose.py` + `pose_rtm.py` | MediaPipe PoseLandmarker as person localiser → RTMW wholebody 133-keypoint model for the real pose; hands from real knuckles |
| 2b silhouette | `silhouette.py` | Golfer outline masks off the MediaPipe pass, plus the address "butt line" posture line; assembled last because it needs the address hold. Separate `silhouette.json` (0.3–1.1 MB), fetched by the player only when its overlay is on |
| 2c isolation | `isolation.py` | Body silhouette ∪ the moving components attached to it, so the "isolate the golfer" overlay doesn't dim the club out with the background. Sidecar `isolation.json`, same frame shape as `silhouette.json` |
| 3 post-process | `postprocess.py` | Confidence gating, anatomical priors, smoothing, interpolation (marked `interp: true`) |
| 5 events | `events.py` | The 8 GolfDB events (Address … Finish) from wrist trajectories, club-independent |
| 4 club | `club.py` + `club_detect.py` | Classical shaft/head tracking (motion mask → line candidates → angular profile) fused with a trained YOLO11s club-head detector (`runs/clubhead/weights/best.pt`, SHA-256 recorded in the artifact). `club.refine_events` snaps Impact to the club-head low point and requires the *club* still for the address hold; `club.takeaway_start` moves Address back to where the head left its rest position |
| 4b face | `face.py` | Face-angle *checkpoint classification* only (square/open/closed) — never a fabricated degree from video |
| 5b checkpoints | `checkpoints.py` | The 10 P-system positions; three are shaft-defined, hence it runs after Stage 4 |
| 6 metrics | `metrics.py` | Full angle catalogue (`metrics.angle_fields`) + per-checkpoint deltas, lead/trail resolved by handedness, drawing geometry (`geom`) per angle |
| 8 scoring | `scoring.py` | Deterministic scorecard + coach narrative against `scoring_config/v2.json`; writes `coach_report.json`. `scripts/rescore.py` re-runs *only* this stage over existing artifacts |

Per-swing output in `out/<stem>/`: `analysis.json`, `coach_report.json`, `silhouette.json`,
`isolation.json`, `source_timing.json`, `club_only.json`, `normalized.mp4`, `analysis.mp4`,
`overlay.mp4` (skeleton burned into pixels — the reference render), `contact.jpg` (a 6x4 grid with
the skeleton burned in and frame numbers stamped — a debug sheet), plus debug sheets.

Two stages can be added to an already-analysed folder without a full re-run: `resegment.py`
(silhouette + butt line) and `rescore.py` (Stage 8 only).

**Operational trap that has bitten before:** re-running `burnin.py` on a fixture without
`--club-detector runs/clubhead/weights/best.pt` silently regenerates the club trace on the
weaker classical-only path and overwrites the better artifact. Always pass the detector flag
on fixture re-runs, whatever the reason for the run.

### Club-head detector (trained, wired, opt-in)

YOLO11s @ 640, 40 epochs, trained on a Roboflow golf-swing dataset (4,399 train images,
CC BY 4.0). ~197 s/epoch on a GTX 1080 (Pascal needs `amp=False`; torch must be the cu126
build). It contributes *evidence* into the classical angular profile (`--club-detector-gain`,
default 0.8) — `detector=None` is byte-identical to the classical path. Invoked per-run via
flag, not on by default.

Two ball-related features exist and are **both off by default** because they fail on some
fixtures: `--club-ball-anchor` (place the head on the ball at Impact when nothing detected it
there — rescues `pro_2`, degrades `perfect` by overwriting a real detection) and
`--club-ball-detect` (find the ball by its disappearance — finds a shoe on two fixtures,
nothing on two others). Hand-placed markers (§6) are the supported correction path.

---

## 4. Data contracts

`analysis.json` is the single contract between analyzer and player. Properties currently
enforced by the invariant test suite, not just by convention:

- **All coordinates normalized 0–1** (x right, y down); renderable with no client-side
  computation beyond scaling.
- **49 keypoints, append-only order** fixed by `keypoint_names`: 33 native → 7 derived
  (`neck`, `mid_hip`, `spine_mid`, `head_center`, `grip_center`, `left_hand`, `right_hand`)
  → 8 measured (knuckles, small toes, `chin`, `nose_bridge`, jaw) → 1 derived-tail (`waist`).
  The measured block sits *after* the derived one so published indices 0–39 keep their
  meaning. Only the wholebody model fills the measured block; other paths zero it and
  dependent metrics report `null`. `skeleton.strip_derived()` is the only correct way to
  remove derived joints — the two derived blocks are not contiguous and a hand-written slice
  gets it wrong silently.
- **`waist` is a rendering point only** — midpoint of `spine_mid` and `mid_hip`, carrying no
  information the shoulders and hips do not already carry. Never a scoring input.
- **Keypoint confidence is truncated to 5 decimals, not rounded** — every consumer re-applies
  the same `MIN_CONF` gate, so a value rounding *up* onto the threshold would make the client
  include a point the analyzer dropped, and the two would then describe different geometry.
  This applies to any threshold a client reads back.
- `interp: true` marks smoothed/interpolated values; the UI renders these dashed at 60%.
- **Keypoints are anatomical (`left_wrist`); metrics are lead/trail (`lead_knee_flex`)**, with
  lead = the side nearest the **target**, resolved by handedness — never "the side facing the
  camera", which inverts for a left-handed golfer. `metrics.sides` carries the mapping;
  `metrics.glossary` maps golf vocabulary onto existing fields.
- **Angle conventions differ by shape**: `_flex` is 0° = straight; `_hinge` is the interior
  angle; from-vertical angles are signed and the sign flips with camera side; stack angles are
  90° = stacked. Every 2D joint angle is projection-sensitive — read the elbows with
  `lead|trail_arm_in_plane`.
- **Eight events, ten checkpoints, one detection.** `events` stays the GolfDB contract;
  `checkpoints` is the same swing as the ten P-system positions a coach names.
  `metrics.angle_fields` is the one angle catalogue — the burn-in table and the player's table
  both render from it, and `geom` on each entry is what lets the player draw that angle over
  the video on click.
- **Strict event ordering**, and `playback_window` pinned to `address − 1s … finish + 1s` so
  every clip's lead-in and run-out match (required by the comparison view). Clips too short
  publish `playback_pad` and the player freezes the end frame for the shortfall.
- **`video.source.path` is verified before the artifact is written.** Its one reader is the
  re-analyze flow, so a wrong value is invisible until someone presses the button.
- **Face-angle honesty**: video yields only checkpoint classifications; nothing in the system
  fabricates a face-angle degree from video.
- **Hand corrections never live in `analysis.json`** — the file is rewritten wholesale by every
  re-analysis, so corrections live in Postgres (`head_markers`, `swing_stages`) and are merged
  by frame at render time.

The trace drawn by the player and the per-frame club positions are **different products that
fail differently**. Every complaint so far that sounded like "the club tracking is wrong"
turned out to be the polyline, not the head. The polyline is built once per segment and
revealed frame-by-frame; gaps where the detector declined are drawn as dashed straight chords
and never interpolated (reconstruction was tried on held-out gaps and lost to a straight line).
Nine render-time smoothing methods are switchable live in the overlay menu
(`lib/traceSmoothing.ts`, default Savitzky-Golay); all keep endpoints exact so the head of the
line lands on the playhead. Thirteen alternative club SOLUTIONS are stored per swing and switchable
the same way; `lib/clubVariants.ts` picks the default and every fixture gets
**`model_traj_moving`** — trajectory-gated head + moving-average trace — which with Savitzky-Golay
render smoothing is the approved combination (2026-08-08, from 31 evaluated candidates).
**A sparse trace is the correct output, not a failure**: `swing1`'s 24 downswing frames contain
zero real uninterpolated detections, so the approved solve draws 1 point through them where the
classical `primary` solve draws 24 — every one asserted rather than measured. Where the detector
did answer (`pro_2`: 11 of 16) the trace is full. An empty stretch is a detector result to fix
upstream, never a reason to switch solution. `checkclub.py` judges the per-frame head, `checktrace.py` the
polyline — a good `checkclub.py` sheet says nothing about the trace.

---

## 5. Scoring (Stage 8)

- Config-versioned: `scoring_config/v2.json` is current, generated by
  `scoring_config/build_config.py` from `scoring_config/criteria.md`; `v1.json` is frozen on
  disk so v1-stamped reports stay reproducible. Every `coach_report.json` records
  `scoring_model_version`. No threshold is hardcoded in code.
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
  against real pipeline output. **Known limit, learned the hard way: it proves a field
  *exists*, never that it *means* what the band assumes.** v1 shipped nine rotation checks
  reading a quantity that *decreases* as a down-the-line golfer turns; they scored 0 on every
  swing and dragged the best fixture below an amateur one. One of them scored 100/100/94.5 and
  looked healthy — that was luck. **A check that scores well is not evidence the check works.**
  Before trusting a new check, print its raw value at the checkpoint across all fixtures and
  confirm the number moves the way the band assumes.
- The coach narrative (findings, priorities, primary fix, drill) is generated deterministically
  from the weakest checks. It is not AI.

---

## 6. The web app

Next.js 16 App Router (`apps/web`), TypeScript strict, Tailwind v4. The design system lives
entirely in the app: theme tokens in `globals.css`'s `@theme` block (Tailwind v4 reads theme
from CSS, not a JS config), and the shared card/panel shapes as named components in
`components/ui/kiosk.tsx` — use those rather than inventing a new panel.

**Pages:** `/` (swing list, Postgres-backed, sortable by denormalized score/band) and
`/swing/[id]` (the workspace).

**API routes — all under `/api/v1/`, nothing unversioned (D41).** `GET /api/v1/swings`, and per
swing: `analysis`, `silhouette`, `isolation`, `club-only`, `markers`, `stages`, `reanalyze` (POST
start / GET poll), `thumb`, `video`. Plus `GET /api/v1/client`, the one unauthenticated route:
version negotiation, so a build too old to sign in can still learn that it is too old. The one
deliberately unversioned prefix is `/api/internal/jobs/*` — the worker-facing surface (source
download, artifact upload, job events), machine-to-machine and authenticated by a signed
per-job token rather than a session; it is not a client API and makes no store-app
compatibility promise. A test enumerates the route files and fails on any that is unversioned
(outside that prefix) or unguarded — internal routes are held to their own rule: every one
must call `requireJobAccess`. `proxy.ts` answers
**426** with an `UpgradeRequired` body to any client below `SWINGSAGE_MIN_CLIENT_VERSION`, and
fails open for a caller that sends no version header. Media goes through `lib/media`, addressed by
identity (D33); no route reads the filesystem for it.

**The contract lives in `packages/schema`.** JSON Schema for `analysis.json`,
`coach_report.json`, `silhouette.json` and the API bodies; TypeScript generated from it and
imported by both clients; the analyzer validates against the same files before writing.
`schemas/shape-lock.json` fails the suite on any non-additive change. `pnpm schema:generate` /
`pnpm schema:check`; re-lock with `pnpm --filter @swingsage/schema lock`.

**The player** (`SwingWorkspace` → `SwingStage` + three folder tabs):

- **Frame sync is the #1 perceived-quality feature.** CFR-60 source makes
  `frame = round(currentTime * fps)` exact — VFR phone video *will* break this; seeks go to
  `(frame + 0.5) / fps` to dodge boundary rounding; `requestVideoFrameCallback` during playback
  with rAF fallback; canvas stack `video → skeleton → club → trace → annotations`. A live drift
  meter exists as a debug panel.
- Overlay menu: skeleton, club, trace (9 smoothing variants), silhouette, isolation, butt line,
  angles — clicking any row of the angle table draws that angle over the video using the `geom`
  the analyzer shipped.
- Tabs: **Overview** (golfer + scorecard), **Coach** (narrative), **Advanced**
  (measurements-only angle catalogue + `CriteriaBreakdown` of every scored check). All score UI
  reads the real `coach_report.json` — there is no mock scoring anywhere.
- **Comparison view**: side-by-side second swing pane (`ComparisonPane`, `swingSync.ts`,
  `proSwings.ts`), enabled by every clip sharing the pinned 1 s lead-in/run-out.
- **Correction tools**, both writing Postgres and both surviving re-analysis: "modify head
  markers" (click to place the club head per frame → `head_markers`) and swing-stage keyframe
  overrides ("this frame is the top" → `swing_stages`, one row per stage by unique index).
- **Re-analyze** from the video's settings gear: POSTs a job, polls stage/progress, ~90 s,
  reloads on completion, and syncs the fresh `coach_report.json` into the `scores` table. The
  job is owned by the page, not the button — a menu closes on the click that starts a 90-second
  run. An orphaned job (dead worker) is settled by reading `.analysis.lock` + artifact mtime so
  a row can't stay "running" forever and block every future re-run.

**Editing `swingsage/` does not change a stored `analysis.json`** — the player keeps drawing the
old artifact until something re-runs the analyzer. That is the usual reason a pipeline change
"doesn't show up".

Server/client discipline: `lib/scoring.ts` (reads disk/Postgres) is server-only;
`lib/scoreDisplay.ts` (types + `scoreColor`/`scoreBand`) is the client-safe split. Importing the
former from a `"use client"` component pulls the Postgres client into the browser bundle — the
split exists to prevent exactly that.

Dev-environment specifics already handled in config: `next.config.ts` enumerates this machine's
LAN IPs into `allowedDevOrigins` (Next 16 otherwise serves the HTML but blocks `/_next/*`
cross-origin, so a phone gets a page that never hydrates); use `127.0.0.1`, not `localhost`
(resolves to `::1` first on this machine).

---

## 7. Persistence

Postgres 16 via Drizzle ORM — local in Docker on **port 5433**, migrations in
`apps/web/drizzle/`. Ten tables (`apps/web/src/db/schema.ts`):

| Table | Holds |
|---|---|
| `users` | `id` is the Supabase `auth.users` id (D7) — one identity, no shadow table |
| `clubs` | §6 equipment inventory; `analyzer_club_type` feeds `--club-type driver\|irons` |
| `sessions` | Practice-session grouping (date/location/notes/goal, representative swing) — schema only, no UI |
| `swings` | **The shot**, keyed by uuid: owner, session, club, ball, handedness, notes, §7.3 favourite/tags, coach-reviewed, `reference_label` for the bundled model swings, and the primary view's denormalized `overall_score`/`band`/`scoring_model_version` for the list's hot path |
| `swing_views` | **One camera's recording of it** (§7.1: DTL, face-on, or both — at most one of each): `media_key` (a storage key, never a path), raw-original key + expiry (D29), fps/frame count/dimensions, status, per-view score, `is_primary` |
| `jobs` | Job protocol rows (stage, progress_pct, message, log), durable across hot-reloads; an in-process mirror serves the actively-running job so the per-frame stdout path never round-trips the DB |
| `scores` | The full scorecard as jsonb + real columns for overall/band/version; source of truth behind the swing's denormalization |
| `head_markers` | Hand-placed club-head positions, normalized 0–1, unique per (view, frame) — the project's only hand-labelled club-head truth |
| `swing_stages` | Hand-corrected event keyframes, unique per (view, stage) |
| `coach_links` | The golfer↔coach relationship the RLS policies reference; pending/approved/revoked |

**Everything frame-indexed hangs off a view, not off a swing** (`jobs`, `scores`,
`head_markers`, `swing_stages`). A frame number is meaningless without knowing which video
counts it, and two cameras on one swing never agree. A swing's id is a uuid the database mints:
before migration 0006 it was literally the analyzer's `out/<stem>` folder name, which coupled the
key to disk layout and made a second camera unrepresentable.

API routes take a **swing** id plus an optional `?view=dtl|face_on`, defaulting to the primary
view; `db/views.ts:resolveView` is the single resolution point. A `?view=` naming something that
is not one of the two is a 400, not a silent default.

**Row-level security is the authorization boundary, and it is live in the running app** (D7, D42).
RLS is enabled and **forced** on all ten tables. The app connects as `swingsage_app` — a login role
that is NOINHERIT, not a superuser, without `BYPASSRLS`, and not a member of `service_role` — and
every query goes through `withUser(userId, fn)` in `src/db/session.ts`, which opens a transaction,
sets `request.jwt.claims` and `set local role authenticated`, and drops both on commit. **There is
no ambient `db` export**; the data modules take the transaction as their first argument, so there
is nowhere else a query can run. `withUser` refuses to serve if the connection turns out to be
privileged, so a mis-set `APP_DATABASE_URL` is a loud failure rather than a silent bypass.

`src/db/admin.ts` (`withOwner`) is the privileged counterpart for command-line work only — it
**throws at import if `NEXT_RUNTIME` is set**, so it cannot reach a request path. First sign-in
goes through `app.ensure_profile()`, a `SECURITY DEFINER` function that reads the identity from
`auth.uid()` internally and lives in a schema PostgREST does not serve. Account deletion uses the
same shape — `app.delete_own_account()` takes **no argument** and reads `auth.uid()` itself, so one
account deleting another is not expressible; `users` has no DELETE policy and is not meant to get
one. `users.email` is `NOT NULL` as well as UNIQUE, and `ensure_profile` raises a matchable
`SS_EMAIL_REQUIRED` for an identity that arrives without one (D31, D45).

Two connection strings, and the difference is the boundary: **`DATABASE_URL`** is the owner
(migrations, seed, backfill), **`APP_DATABASE_URL`** is what serves requests.

Commands (repo root unless noted): `docker compose up -d`, then from `apps/web`:
`pnpm db:migrate` (applies migrations *and* runs `db:app-role`, which gives `swingsage_app` its
password), `pnpm db:seed`, `pnpm db:backfill` (idempotent — indexes every `out/` folder + syncs
scores), `pnpm db:claim-fixtures <email>`, `pnpm db:generate`, `pnpm db:studio`.

**Known seam:** `burnin.py` run from the CLI does not touch Postgres at all. A manually
re-analysed fixture shows a stale score in the swing list until `pnpm db:backfill` runs.

`analysis.json` on disk remains the CV artifact of record; the DB is the queryable index and
score/job/correction store on top of it. Because analysis is a stored artifact, "re-analyze"
can re-run improved models over historic swings.

---

## 8. Fixtures and measured state

Ten clips in `fixtures/` (gitignored), **all ten analysed** into `out/` and scored against
`scoring_config/v2.json`. Regenerated 2026-08-09 against the current pipeline — the previous
figures predated the club-takeaway refinement and were stale:

| Fixture | Overall | Band | Club | Tempo | Frames |
|---|---|---|---|---|---|
| perfect | 79.9 | Pure | — | 1.57 | 829 |
| pro_3 | 76.7 | Pure | — | 1.83 | 1889 |
| 6iron-1 | 73.1 | Solid | irons | 2.85 | 519 |
| 7wood-2 | 73.1 | Solid | — | 2.95 | 453 |
| 6iron3 | 69.8 | Solid | irons | 3.44 | 519 |
| swing1 | 69.6 | Solid | — | 2.09 | 396 |
| 6iron2 | 68.5 | Solid | irons | 3.21 | 552 |
| pro_2 | 61.6 | Solid | — | 2.47 | 322 |
| swing2 | 58.3 | Building | — | 1.62 | 341 |
| **7wood-1** | **43.1** | **Building** | — | **53.5** | 487 |

Two things moved and one broke:

- **The takeaway refinement moved Address** on `6iron2` (261→255), `6iron3` (289→283) and
  `swing2` (41→39), which is what shifted their tempo and scores. `perfect`, `pro_2`, `swing1`
  and `6iron-1` were left alone, as intended — the refinement only fires when the club is
  demonstrably still beforehand.
- **`6iron-1` fell 78.0 → 73.1** because it is now scored with `--club-type irons` like the
  other two 6-irons. Previously it ran with the club unknown and skipped the club-aware bands.
  That is a correction, not a regression: the old figure was flattering it.
- **`7wood-1` is a genuine detection failure**, described below.

All ten are down-the-line and right-handed — **there is no face-on fixture and no left-handed
fixture**, so every view-gated and mirroring-dependent path remains untested against real
footage.

### `7wood-1` — the first new clip exposed the deferred problem

Its last five events collapse into consecutive frames (`top` 343, `mid_downswing` 344, `impact`
345, `mid_follow_through` 346, `finish` 347), all at the 0.35 confidence floor, while everything
up to `mid_backswing` (342, conf 0.95) looks healthy. The resulting "backswing" runs 1783 ms
against a plausible 450–1300, and tempo reads **53.5:1**.

The shape says the detector locked onto pre-swing motion — setup, a waggle or a practice swing —
and then had no real downswing left to find. **That is precisely the §11 automatic-swing-detection
problem deferred in D2**, arriving on the first genuinely new clip analysed. It is direct
evidence for the manual trim/select fallback `in-app-capture` is required to ship.

Worth noting what did work: the system **self-flagged all three implausibilities** rather than
presenting the number as fact. The confidence discipline caught it; nothing else would have.

Measured pipeline quality on the two original fixtures:

- Pose: all key joints 94–100%; `grip_center` 94.2% @ 0.73 (swing1), 90.9% @ 0.71 (swing2).
  RTMW recovered far-side limbs MediaPipe lost entirely (left_elbow 10% → 99%).
- Club detector contribution: 114/396 frames (29%) on swing1, 298/341 (87%) on swing2; on
  swing2 it fixed a visibly wrong finish direction.
- Impact agrees with the club-head low point within ±2 frames on both.
- Tempo: 2.09:1 (swing1), 1.62:1 (swing2, self-flagged implausible).

### Honesty caveats — these are part of the current state

- **No hand-labelled event frames exist.** `tests/fixtures.json:hand_labeled` is null for both
  frozen clips, so event accuracy is internally consistent but *unverified*. An earlier status
  doc claimed "verified ±2 frames" while Address was in fact 48 frames early on swing1,
  reporting a 1600 ms backswing against a real 800 ms. Nothing caught it; it surfaced only
  because the tempo ratio happened to look wrong. **No accuracy percentage anywhere in this
  project is independently verifiable yet.**
- **No club-head position-error metric exists.** Every club change so far has been tuned on
  proxies (smoothness, off-plane deviation), and smoothness has actively preferred wrong
  answers at least once. Any club change tuned on smoothness is unfalsifiable.
- **Coverage percentages have overstated club quality three separate times.** Always run
  `scripts/checkclub.py` and look at the club drawn over the real frame before believing them.
- **Top of backswing is a hand landmark, not a club one.** The club keeps working at the top
  after the hands reverse — 15 frames on swing2 — so the phase flips to downswing while the club
  is still going back. Four club-based redefinitions disagree by more than the transition is
  long, and on two fixtures there are zero measured club frames within 12 of Top. Unresolved;
  hand labels are the unlock.

  **The "tempo reads low everywhere" claim attached to this is now falsified**, and was an
  artefact of a four-clip sample. Across the ten analysed fixtures, `6iron3` reads 3.44,
  `6iron2` 3.21, `7wood-2` 2.95 and `6iron-1` 2.85 — in or beside the typical 3:1. The low
  readings cluster on `perfect` (1.57), `swing2` (1.62) and `pro_3` (1.83), the slow-motion and
  junior clips. Whatever the Top landmark costs, it is not a uniform downward bias on tempo.
- **The drawn trace is still segmented on pre-refinement events**, so a refined Impact can sit
  a few frames after where the downswing segment was cut.
- Some 2D joint angles are visibly wrong when a limb points near the camera axis (swing2 trail
  elbow 172° at P3; lead hip hinge 179.8° at P4). The arm-in-plane fields quantify this for the
  arms; the hip hinge has no equivalent guard.
- All thresholds and bands are authored from coaching definitions, **not calibrated against a
  real fixture population**.

---

## 9. Tests

`python -m pytest tests` from `services/analyzer` — **80 passed, 2 skipped, 1 xfailed, ~4 s**
on this snapshot date. No video, GPU or `out/` needed. Hermetic: the suite replays the
deterministic stages over *frozen* pose and club output committed in `tests/data/*.input.json.gz`
(~130 KB/clip), so a change to pose inference shows up as a golden diff on every downstream
number rather than hiding inside one. Regenerate frozen input deliberately with
`scripts/make_test_data.py --all` when pose genuinely changes — that is the moment to decide
whether the new numbers are better.

Three kinds of check, and the distinction matters:

- **Golden snapshots** (`test_stages.py`, `test_scoring.py`) prove nothing has *changed*. They
  cannot prove anything is *right* — a snapshot taken while Address was 48 frames early would
  have locked that in. `--update-golden` rewrites them and then fails the run on purpose.
- **Contract invariants** (`test_invariants.py`) need no golden file, so they keep working as
  fixtures are added: 49 keypoints in append-only order, normalized coordinates, truncated
  confidence, strict event ordering, playback-window containment, tempo self-consistency.
  Plus `test_mirrored.py`, `test_source_timing.py`, `test_isolation.py`, `test_takeaway.py`.
- **Hand labels** (`test_hand_labeled.py`) are the only thing that would prove correctness, and
  they are **unfilled** — the label slots are null, so those tests skip rather than pass
  vacuously. The fixture-count check xfails at 2 frozen clips against a wanted 10.

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
| `kpdebug.py` | RTMW's 133 sub-indices drawn + asserted on a real frame — run before trusting any new mapping |
| `qa.py` | Grip-height trace / frame sheets |
| `isolate.py`, `retiming.py`, `rawdet.py`, `addvariant.py` | Isolation rings, source timing, raw detections, trace variants |

Three independent verification gates exist because "the stick figure looks wrong" has two
unrelated causes — the joint is in the wrong place (pose), or the right joints are drawn on the
wrong frame (sync). Debugging both at once is miserable, so each is proven separately:

- **Gate 1 — pose, no browser.** `burnin.py` draws frame N's skeleton onto frame N's pixels in
  the same process that computed them, so sync cannot be a variable. Anything wrong in
  `overlay.mp4` *is* the pose.
- **Gate 2 — sync, no pose.** The player's frame-sync panel compares the frame the browser
  reports as presented against our computed index during playback.
- **Gate 3 — combined.** The canvas overlay must match the Gate 1 burn-in at the same frame.

---

## 11. Toolchain

Analyzer runtime deps are **pinned in `services/analyzer/requirements.txt`** (exact versions —
the configuration the CUDA measurement and determinism baseline were taken on; install is the
two-command sequence in its header, rtmlib always `--no-deps`), and
`services/analyzer/Dockerfile` rebuilds the environment from those pins and runs the suite
green. The pinned set on the primary machine: Python 3.13, mediapipe 1.0.0 (Tasks API only —
legacy `mp.solutions.pose` is gone, and the Tasks API has a monotonic-timestamp constraint
that shapes the design), opencv-python 5.0.0.93 (+ contrib, same version — mediapipe requires
it), numpy 2.3.5, scipy 1.18.0, torch 2.13.0+cu126 (pose and detector; plain `pip install
torch` silently gives a CPU build — assert `torch.cuda.is_available()`),
onnxruntime-gpu 1.22.0 (must match torch's CUDA major), ultralytics 8.4.115, rtmlib 0.0.16
(RTMW weights self-download to `~/.cache/rtmlib`), qstash 3.4.0 (delivery signature
verification only). System: ffmpeg 8.1.2/9.0 (use
`-fps_mode cfr`; `-vsync` is removed in 9), Node 22 / pnpm 10–11, Postgres 16 (Docker),
Drizzle ^0.45 / drizzle-kit ^0.31.

Pose model bundle: `services/analyzer/models/pose_landmarker_heavy.task` (30.6 MB, gitignored —
re-download from the MediaPipe models URL if missing; asset table in RUNBOOK §4). One machine
has a GTX 1080 (8 GB, CUDA 12.6); Pascal requires `amp=False` for training, and the 40-epoch
detector run is ~2h10m there against ~25 h on CPU.

Run: `docker compose up -d` → `pnpm i` → `pnpm dev` (127.0.0.1:3000) for the app;
`.venv\Scripts\python.exe scripts/burnin.py <clip> --club-detector runs/clubhead/weights/best.pt`
per fixture, then `pnpm db:backfill`.

---

## 11b. Measured Android device capability

Everything here was measured on a **Galaxy S25+ (SM-S936U1, Android 36)** by the step 02 spike, and
every number comes from decoding an artifact rather than from an API's self-report. Decisions
D34–D39 carry the reasoning; this is the standing summary.

### What works, and what to build on

| Capability | Result | Reach it with |
|---|---|---|
| **Overlay locked to the presented frame** | **99.2% exactly locked** (n=250), ~49 ms of lead to draw in | `modules/frame-clock` — `expo-video` exposes no frame callback |
| **Frame-exact seeking** | **100% exact** once the target became `frame / fps` | `frame-clock`; media3 resolves seeks FORWARD, so the web rule is wrong here (D40) |
| **Seeking in the real player** | **100% exact, p95 0, max 0** — re-confirmed against the shipped player, not the spike | `mobile-player` step 01's *Run 250 seeks*, which waits for each landing before asking for the next |
| **Seeking over HTTP** | **identical to a bundled file** — the network adds zero error | any range-capable origin |
| **True high-frame-rate capture** | **1080p 231 fps** (240 requested), **1080p 119 fps** (120 requested) | `modules/high-speed-camera` — Camera2 constrained-high-speed |
| Sustained 60 fps capture | 59.5–60.0 fps at 1080p | either path |
| Artifact parse on device | 13.7 MB `analysis.json` parses in **199 ms** | — |
| Slow-motion playback | `setPlaybackSpeed`; 240 fps at 0.25× is a true 60 fps on screen | `frame-clock` |

The harness that produced these numbers was **deleted on 2026-08-11 (D44)**. The numbers stand;
the instruments do not, and a repeat measurement is rebuilt against the real player rather than
resurrected. **That rebuild happened** — the *Run 250 seeks* control in the player's own frame-sync
panel is the replacement instrument, and it is shipped rather than thrown away this time.

### Scrubbing — the gap D44 left open, now closed

Recorded honestly, because this project has shipped a confident accuracy claim that was wrong.

| | |
|---|---|
| **Directly observed on screen** (2026-08-12, S25+, a 1889-frame 60fps clip) | **30 seeks · 100.0% exact · p95 0 · max 0**, worst seek error 0 frames, `container fps 60.00 vs 60 declared`. The run was interrupted at 31/250 when the phone was picked up. |
| **Confirmed by Taylor** | The full run "looks good". **The figure itself was not read back**, so no number larger than n=30 is claimed here. |
| Playback health alongside it | 59.9 fps UI, **0 stutters** |

n=30 at 100% is consistent with D40's spike measurement and with the native counter, which scores
on the playback thread when the frame is decoded. It is **below the n≥200 the step asked for**, and
that shortfall is stated rather than rounded away. Re-running it is one tap — RUNBOOK §11 — and
anyone wanting a larger sample should take it before quoting a percentage.

**Two modules survived that deletion because they are load-bearing:**

- **`modules/frame-clock`** — Media3 `VideoFrameMetadataListener`. `mobile-player` needs the same
  frame callback, and no Expo/RN video component surfaces one.
- **`modules/high-speed-camera`** — `Camera2HighSpeed`. The **deprecated**
  `createConstrainedHighSpeedCaptureSession(surfaces, callback, handler)` is the call that works;
  the modern `SessionConfiguration(SESSION_HIGH_SPEED, …)` is silently swallowed on this device
  (no callback at all). Do not "fix" that deprecation — it removes 240 fps with no error.

### What does NOT work, and is not worth retrying

| Attempt | Outcome |
|---|---|
| `react-native-vision-camera` v5 for high speed | Accepted 120/240 and **silently delivered 60** |
| CameraX 1.5 high-speed | Refuses — gates on `CamcorderProfile`, which this device leaves empty |
| Skia for the overlay | Unnecessary **for the skeleton**. Plain rotated `View`s drawing 49 keypoints hit 99.2%, so that retest is cancelled. The **trace** was never in that measurement and is 3–4× the view count — see the open item below |
| React state as the overlay paint path | Not the bottleneck — removing it entirely scored no better (99.0%) |

### Known limits and open items

- **Never port the web player's `(frame + 0.5) / fps` seek rule to Android.** HTML video seeks to
  the frame *containing* a time; media3 resolves forward to the next boundary. The conventions are
  opposite and the web rule costs exactly one frame on every seek (D40).

- **231 fps against a requested 240** is 3.6% short (~50 frames over 5.8 s) — probably encoder ramp
  or the stop edge, not a rate cap. Needs one look before `in-app-capture` relies on an exact rate.
- **Scrubbing is unmeasured.** Four instrument revisions could not measure it honestly; a seeked
  frame is displayed on arrival so there is **no lead** on that path, unlike playback's 49 ms. Any
  scrub design must draw for a target it already knows. The instrument that was to verify it
  (`measure_overlay.py`, comparing the drawn marker and the burned-in bar within one screenshot)
  went with the harness in D44 — the measurement is now `mobile-player`'s to make against the
  real player, and it is an open item, not a solved one.
- **The overlay's frame lock WITH THE TRACE ON is unmeasured.** The view count is measured and the
  geometry is verified: on a 360pt stage across all ten fixtures the mobile overlay costs **59–61
  views for the skeleton alone and peaks at 461 at impact on `pro_3`, 400 of them trace** — where
  D36's 99.2% figure was taken at roughly 77, with no trace at all. Second and third worst are
  `pro_3` at the top (293) and `7wood-1` at impact (234); a typical clip sits near 110–200. `scripts/checkoverlay.ts` confirms every layer lands
  on the analyzer's Gate 1 burn-in on all ten fixtures (RUNBOOK §12a). What is NOT known is whether
  frame-lock holds at 461 views, and that is the number the Skia question turns on. Reading it is
  one screen: RUNBOOK §12b, Overlay drift with the trace on and with it off. **Do not conclude
  either way from the view count alone** — D23's rejection of Skia was on cost, not on merit, and
  reversing it needs a measurement rather than an inference. **The reading was offered and declined
  on 2026-08-13 (D51)**, so this stays open by decision rather than by obstacle.

- **Transfer, not parsing, is the artifact problem** — 13.7 MB took 2781 ms over LAN. A lean
  per-view API payload is a step 07 input.
- **iOS is entirely unmeasured** — no Mac, no device. Android leads by D31's amendment.
- **Capability must be probed at runtime, never assumed.** This is a flagship; the mid-range
  Android step 02 still wants may differ, and §2.3 forbids degrading silently.

---

## 12. What does not exist

Stated as fact, with no implied ordering or plan. See
[`PRODUCT-COVERAGE.md`](PRODUCT-COVERAGE.md) for this measured against the product target.

- **The mobile app shows a golfer their swings, plays them back, and explains them — and nothing
  else yet.** An Expo/RN **Android** client is installed on the S25+ with Google sign-in, a real
  swing log (contact-frame thumbnails, scores, bands, pull-to-refresh) reading `/api/v1/swings`,
  navigation via React Navigation 7 native-stack, and a full-bleed swing player: frame-exact
  transport on `modules/frame-clock`, the analysis overlay (skeleton, club, trace, orientation rods,
  angle arcs) drawn as rotated `View`s, a phase strip, and slide-up panels for the overlay switches
  and the swing's numbers. The **Analysis panel** renders the whole of `coach_report.json` — the
  headline with its coverage split, the primary fix and drill, the findings, the per-position
  scores, and every individual check with its measured value against the band it was judged on —
  and **any row anchored to a coaching position seeks the player to that frame**. Its two "not
  scored" reasons stay distinct at every level. **Every screen renders the Ideal Swing design
  system** (`src/design/system/` over `src/theme/` tokens; light default, dark by preference or
  phone): the legacy theme layer and its aliases are deleted, the fixed-dark player/capture
  palette (`COLORS`) and Deck's control shading derive from the same `palette.ts` ramps, and the
  old green/violet identity exists nowhere in the client. **The overlay's frame lock with the trace on is
  still unmeasured on the device** (§11b) and dual-view comparison does not exist. The Analysis
  panel's automated oracles pass but it has **not been looked at on the glass** — layout at phone
  width and the landing frame of a tap are unverified. **Side-by-side comparison** puts a second
  swing beside the first and holds it at the same *position in the swing* — mapped through the
  P-codes both artifacts carry, so five-fold differences in clip length and differing frame rates
  both work (D52); an unalignable pair says so rather than drifting. Whether two decoders are
  affordable is **unmeasured**. No capture, no upload, and no iOS build has ever been compiled.
- **KNOWN DEFECT — every swing-log thumbnail is a contact SHEET, not a frame.** `GET
  /api/v1/swings/:id/thumb` serves the analyzer's `contact.jpg`, and the route describes it as
  *"the contact-frame still"*. It is not: `contact.jpg` is a **24-up contact sheet** (1920×2272,
  six columns of labelled frames across the whole clip), so the swing log renders a 24-frame grid
  crushed into a 58×46 tile — visual noise where a recognisable swing image belongs. The filename
  reads as "contact" in the *contact-sheet* sense, and the route read it in the *ball-contact*
  sense. Fixing it needs a single-frame artifact (impact, P7, is the obvious choice) or a
  server-side crop; picking which is a product call. Found 2026-08-13 by looking at the running
  app on the emulator — nothing in the code or the tests says anything is wrong.
- **No capture of any kind.** No in-app recording, no camera code, no multi-device sync.
- **No upload flow.** Analysis is started by hand (`burnin.py`) or via the web app's re-analyze
  button on an already-indexed swing. Two job drivers exist behind `JOBS_DRIVER` (spawn is the
  default): the analyzer as a child process of the web server, or QStash dispatch to the worker
  HTTP server (`services/analyzer/service/server.py`) — the queue loop is proven locally against
  the QStash dev server (`pnpm --filter web queue:e2e`) but deploys nowhere yet; the worker host
  is an open handoff row.
- **No AI anywhere.** No provider abstraction, no Claude integration, no AI-generated
  narrative, no AI coach chat — the coach text is deterministic Stage 8 output.
- **Auth is one provider deep.** Google native sign-in works on Android and the server accepts
  that session as a bearer token against forced RLS (D42, D43) — verified on the phone. Phone
  OTP, Sign in with Apple and identity linking are **not** built, and the `DEV_USER_EMAIL`
  development identity still exists because deleting it before phone sign-in lands would leave no
  way in. The ten local fixtures belong to that identity, not to a person.
- **Account deletion is built, and reaches three of the six places D15 names.** `DELETE
  /api/v1/account` removes object storage, every database row by FK cascade, and the sign-in
  identity at the auth vendor, in that order (D45) — verified end to end by `pnpm --filter web
  verify:account`. AI conversation history, coach-visible copies, analytics and backups are still
  designed-only; none of them exists yet to delete from.
- **No roles UI, no coach features, no messaging.** The notification BACKBONE exists
  (migration 0013: `notifications` table, `app.notify()` emitter with grouped delivery,
  `GET /api/v1/notifications` + `POST /api/v1/notifications/read`, RLS-proven by
  `notificationsRls.test.ts`) — but nothing emits into it yet and no client surface reads it;
  push and email do not exist.
- **No subscriptions, entitlements, or payments.**
- **No drill library, no trends/history views, no goals, no equipment inventory.**
- **No simulator/launch-monitor data** of any kind, manual or parsed — consequently no
  authoritative face-angle degrees exist anywhere in the system.
- **No production deployment.** Postgres runs locally in Docker; no hosted environment is
  provisioned. Media is local disk (`SWINGSAGE_MEDIA_ROOT`), not object storage — the schema's
  `swing_views.media_key` is backend-agnostic by design, and step 09 turns it into an
  object-storage prefix by changing values rather than columns.
- **No dual-view swing exists yet.** The schema holds two views per swing and the routes address
  them, but all ten analysed fixtures are single down-the-line clips, and no UI switches between
  views — that is `mobile-player`'s. The capability is proven by `src/db/multiView.test.ts`, not
  by a swing anyone has looked at.
- **No analytics, observability, or error reporting.**
- **No hand-labelled ground truth** for events or club-head position, beyond whatever
  `head_markers` rows have been placed by hand in the player.
- **No second camera view per swing** — all angles are single-view 2D projections.
- **No face-on or left-handed fixture.**
