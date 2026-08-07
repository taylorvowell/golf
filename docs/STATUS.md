# SwingSage — Status & Handoff

**Last updated:** 2026-08-06

Read this first, then [CLAUDE.md](../CLAUDE.md) for commands and architecture, then
[DECISIONS.md](DECISIONS.md) for *why* things are the way they are (53 entries, every one
status-marked; several are negative results that will save you repeating the work, and roughly
a quarter no longer hold — check the `Status:` line before acting on any of them).

---

## 1. Where we are

A working end-to-end pipeline: **clip → normalized video + `analysis.json` + `coach_report.json`
→ browser player with skeleton, events, club overlay, metrics and a real scorecard**, indexed
into Postgres per admin user. Two real fixture swings analysed and scored.

| Stage | State |
|---|---|
| 0 — normalize (ffmpeg, VFR→CFR, rotation) | **Done**, robust |
| 2 — pose (MediaPipe localiser → RTMW wholebody 133) | **Done**, excellent |
| 3 — post-processing (gating, priors, smoothing) | **Done** |
| 5 — swing events (8 GolfDB events) | **Done**, snapshot-pinned. **Not** validated against hand labels — see the warning below |
| 5b — checkpoints (10 P-system positions) | **Done**; P6 falls back to a proxy on swing1 (D31) |
| 6 — metrics (doc 05 Part B) | **Done**, provisional thresholds; full angle catalogue + per-checkpoint deltas |
| 4 — club tracking | **Weak** — see §3 |
| 4b — club face | Partial, honest about limits |
| 8 — coach scoring (doc 05 C1) | **Done, deliberately partial** — 38 checks (bucket A + a slice of B) against a versioned `scoring_config/v1.json`; deterministic narrative, no AI. See `services/analyzer/scoring_config/COVERAGE.md` for what's wired vs. deferred |
| Web app (Next.js) | Player rebuilt on `instructions/template_sample.html` — three tabs, overlays on the video (D35); real scorecard on Overview/Coach/Advanced; swing log backed by Postgres, scoped to one seeded admin user; **still no upload flow or job queue beyond the DB-backed reanalyze job** |
| Database | **Postgres via Drizzle** (D38) — `users`/`sessions`/`swings`/`jobs`/`scores` tables, migrations in `apps/web/drizzle/`. Not SQLite; doc 02's "v1 SQLite" line is superseded |
| 6 — simulator ingestion | Not started |
| 7 — AI provider | Not started — the coach narrative on Overview/Coach is deterministic (Stage 8's own weakest-check logic), not AI-generated |
| Tests | Golden snapshots + contract invariants over frozen pose/club data, now including Stage 8 scoring — `python -m pytest tests` (40 tests) |

### Measured quality (both fixtures)

| | swing1 (oblique, adult) | swing2 (DTL, junior) |
|---|---|---|
| Pose, all key joints | 94–100% | 98–100% |
| `grip_center` | 94.2% @ 0.73 | 90.9% @ 0.71 |
| Tempo | 2.09:1 (800/383ms) | 1.55:1 (750/483ms), flagged by D37 |
| Impact vs club-head low point | ±2 frames | exact |
| Club detector contribution | 114/396 frames (29%) | 298/341 (87%) |
| Club head path accel p95 (back / down) | 30.8 / 54.2 px | 16.9 / 65.4 px |

> **Event accuracy is unverified, and this table used to claim otherwise.** It previously read
> "verified ±2 frames". On 2026-08-04 Address was found to be 48 frames early on swing1,
> reporting a 1600ms backswing against a real 800ms — it had been picking the *longest*
> quasi-static hold instead of the last one (D36, D37). Nothing caught it; it surfaced because
> the tempo ratio happened to look wrong. There are still **no hand-labelled event frames** for
> either clip, so doc 08 Phase 3's ±3-frame criterion remains unmet. `tests/fixtures.json` has
> the slots; filling them is a human watching the video, and the suite skips until then rather
> than passing vacuously.
>
> Confidence figures above are post-D26. Anything recorded as "100% @ 1.00" measured a clamp on
> SimCC peak magnitudes, not the model's opinion, and is not comparable.

---

## 2. What is genuinely good

- **Pose is solved.** RTMW wholebody 133 gives every joint at 94–100%, including the
  far-side limbs MediaPipe lost entirely (left_elbow 10% → 99%). Hands come from real
  knuckles, so `grip_center` is a measured point rather than an inferred one.
- **Events are snapshot-pinned** and internally consistent — ordering is enforced, Impact agrees
  with the club-head low point on both clips, and tempo is now a self-check that flags its own
  implausibility (D37). They are *not* validated against hand reading; see the warning above.
- **The web player works** — frame-accurate scrubbing, phase bar with click-to-loop, overlay
  stack, live frame-sync drift meter.
- **The verification harness is the most valuable asset here.** `checkclub.py`, `sweep.py`,
  `dense.py`, `clubdebug.py`. Coverage percentages have overstated club quality **three
  separate times**; only rendering the overlay onto real frames caught it.

---

## 3. The open problem: club head tracking

Four hand-designed approaches were built and measured. **All failed.**

| # | Approach | Result |
|---|---|---|
| 1 | Dense optical flow (head = fastest pixel) | Good address→mid-backswing; fails at Top (club slower than body) and at impact (displacement exceeds flow's search radius) |
| 2 | Track-before-detect over a parametric path | Failed badly — 4-D random search never found the optimum |
| 3 | Morphological lineness (thin bright bar) | Failed — shirt hems, collar and fence rails are also thin bright bars |
| 4 | LSD segments from the hands + monotonic height | **Best classical result** — 8 consecutive frames correct through the early backswing, then candidates dry up (28/111 frames) |

**Root cause, and the lesson:** each method assumes the club is the *most extreme* thing in
some hand-designed measure. In real footage it usually isn't — the body is faster at the top,
the fence is more line-like, the foliage more textured. See DECISIONS D17–D20.

**Second lesson:** we tuned against head-path *smoothness* for several rounds. It cannot
distinguish "smooth and correct" from "smooth and wrong", and a direct AI-vs-CV comparison
showed the tracker was more accurate than the metric implied (D20a). **Build the real metric
before tuning further** — doc 04 §7 specifies it: hand-label the club head every 5th frame on
5 clips, measure position error in pixels.

**Third lesson, 2026-08-06: the drawn trace is not the tracker** (D43). Three reported "the
club tracking is wrong" symptoms on `perfect` all turned out to be the polyline rather than the
per-frame head — the line was cut at the event frames 102px short of the ball, grown against a
point-count index that put its head up to 34 frames from the playhead, and drawing a solid
straight chord across the frames the detector declined. The heads themselves were right on
every one of those frames. `scripts/checktrace.py` now measures the polyline specifically
(reach to the ball, each unmeasured bridge with its chord length, fidelity, growth error);
`checkclub.py` cannot see any of it. Interpolating across the gaps was tried and lost to a
straight chord on held-out data — see D43's table before rebuilding it.

**Fourth lesson: the strike is where the detector has nothing, and a constraint beats a
detector there** (D44). Through impact the head moves ~90px a frame and smears into the turf, so
on `pro_2` the tracked head never comes within 196px — 35% of body height — of the ball. The
club head *is* at the ball at impact, so `club.anchor_ball` writes that position when nothing
found it, guarded to fire only on a miss above 5% of body height. With it, `pro_2` reaches
18.8px. It is **off by default** (`--club-ball-anchor`): on `perfect` the same guard fires and
overwrites a real detection with a landmark 48px away, and nothing inside the algorithm
separates the two clips — both miss the landmark by exactly 47px. Hand-placed markers (below)
are the supported fix today.

### The next model to train is a ball detector

`club.find_ball` locates the ball by its disappearance at impact. It is **implemented and off**:
on the four fixtures it finds the golfer's shoe twice and nothing twice, because every
individually-discriminative property of a golf ball is also a property of a shoe edge, a divot
or a background range ball. D44 has the table. This is the clearest case in the project for a
second learned detector — a ball is an easier target than a club head (rigid, high-contrast,
and *stationary for hundreds of frames*, so consensus over the address hold makes a weak
per-frame model strong), public datasets exist, and it pays twice: it anchors the club at
impact, and the frame the ball leaves would pin Impact to ±1 frame, which nothing currently
does.

Meanwhile the fallback landmark is weaker than doc 04 §3 claims. "The club head at Address is
the ball" holds only if Address lands on a frame where the club is grounded behind it, and on
`perfect` it does not — the detected Address frame catches the club still off the turf, 150px
(18% of body height) away. `scripts/checkball.py` shows it on the pixels. That is an event-
detection defect nothing else currently surfaces.

### Hand-placed club-head markers

The player has a **"modify head markers"** mode (D45): click the picture to place the club head
on the current frame, arrow keys to step, delete to clear, one batched save. Markers live in a
`head_markers` Postgres table, deliberately **not** in `analysis.json` — that file is rewritten
by every re-analysis, so a correction stored there would be destroyed by the next run. The trace
merges them by frame, so correcting a frame inside a bridge closes the bridge.

These rows are the project's **first hand-labelled club-head truth**. Doc 08 Phase 3 wants a
position-error metric and `tests/fixtures.json:hand_labeled` is still null; `GET
/api/swings/:id/markers` is where that data now comes from.

---

## 4. In flight: learned club detector

This is the live thread. Pick it up here.

**Dataset:** `golf-swing-vnwlh/golf-swing-msiuj` v9 (Roboflow, CC BY 4.0) — 4,399 train
images, classes `clubhead` + `stick`, instance segmentation. Verified genuine: median
clubhead extent **0.013 × 0.024** of the image.

> Do **not** use `club-head-tracking/golf-club-tracking` — despite the name it contains
> three overlapping full-body golfer boxes per image (median 0.42 × 0.59). Already checked.

**Training:** `services/analyzer/scripts/train_club.py`, `yolo11s` @ 640px, 40 epochs.

**Compute blocker resolved.** Machine 2 has a GTX 1080 (8 GB, CUDA 12.6). Measured **197 s/
epoch**, so the full 40-epoch run is **~2h10m** — the "~20 minutes" estimate here was
optimistic by ~6×, though a GPU is still 7.5× better than CPU's ~25 h. Pascal requires
`amp=False`, and torch must come from the cu126 index or `pip` silently installs a CPU build.
See DECISIONS **D21b**. The `yolo11n` / subset fallbacks below are no longer needed.

**Dataset verified independently** (D22b): `clubhead` median extent 0.0137 × 0.0243, 0 of
8,506 instances above 10% of frame. v9 on disk is train 4,399 / valid 269 / test 909. Note the
export is segmentation *polygons* even when the `yolov11` detection format is requested;
Ultralytics converts them to boxes for a detection task (0 corrupt across 4,399).

**Two other Roboflow candidates were evaluated and rejected** (D22) — including one whose
advertised "mAP 86.09" is box-only, with every keypoint metric exactly 0.000. Don't re-survey
without reading D22 first.

**Inference is now written** (D23): `swingsage/club_detect.py`, wired via
`burnin.py --club-detector <weights>`. It contributes evidence into the existing angular
profile rather than replacing the tracker (doc 04 §2 forbids detector-only), so
`detector=None` is byte-identical to the classical path. `analysis.json` now carries
`club.detector` with the weights' SHA-256, closing the versioning gap in §7.

**Roboflow API key** is deliberately not committed. Supply it as `ROBOFLOW_API_KEY` in the
environment or in `services/analyzer/.env` (gitignored); `scripts/fetch_club_dataset.py` reads
either. Datasets re-download in minutes.

---

## 5. Next steps, in order

1. ~~**Finish the club detector.**~~ Trained, wired and A/B'd (D23, **D23a**). Weights at
   `runs/clubhead/weights/best.pt`. On swing2 it **fixed the finish** — the classical tracker
   draws the club up-left there while the real shaft goes down-right, verified with
   `checkclub.py` — and halved off-plane deviation. Left behind `--club-detector`, **not
   default**: one clip, one visual pass. Promoting it needs step 2 and step 3.
2. **Build the ground-truth metric** (doc 04 §7) — hand-label the club head every 5th frame on
   5 clips, measure position error in px. **This is the top blocker, and D23a made the case
   undeniable:** the detector's follow-through got *less smooth* at exactly the segment where it
   became *visibly more correct*, so head-path acceleration actively preferred the wrong answer.
   Any tuning against smoothness from here risks undoing a real fix. Off-plane deviation is the
   better interim proxy (it is anchored to the hand-fitted plane, D18b) but it is still a proxy.
3. **More fixtures.** Everything is tuned on two clips; doc 03 §7 wants ≥15. The phase-based
   detector split especially may be overfit. A face-on and a left-handed clip would test the
   handedness mirroring that has never been exercised.
4. **Phase 1 properly** — the upload flow and staged progress are still missing; `burnin.py` is
   still run by hand. Job rows and Postgres (D38, not SQLite — that line in doc 02 is
   superseded) landed as part of building real scoring (§6 below), ahead of the upload flow
   that was originally going to bring them.
5. ~~**Then Phase 5 coach scoring.**~~ Built, deliberately partial: `scoring_config/v1.json`
   (versioned per doc 05 C1) plus `swingsage/scoring.py` (Stage 8) score 38 checks — bucket A
   from `docs/SCORING-CRITERIA-TRIAGE.md` almost entirely, plus a slice of bucket B. See §6.

## 6. Real scoring + Postgres (landed 2026-08-05)

Doc 05 Part C1's scoring engine is built and wired into `burnin.py` as Stage 8, writing
`coach_report.json` next to `analysis.json`. `apps/web/src/lib/mockScoring.ts` is deleted —
Overview, Coach and a new Advanced-tab `CriteriaBreakdown` all read the real scorecard.

- **`scoring_config/v2.json`** (`services/analyzer/scoring_config/build_config.py` generates
  it; `v1.json` is frozen on disk so v1-stamped reports stay reproducible) — 38 checks against
  `criteria.md` + the triage's bucket A/B rows, each validated to resolve against the real
  pipeline output (`scripts/validate_scoring_config.py`, also a pytest test). **Of those 38,
  28 are scored and 10 are `deferred`** — authored but abstaining on every swing because the
  metric behind them isn't trustworthy (DECISIONS D42). **Not** the full ~160-row A+B set the
  triage identifies as buildable — see `scoring_config/COVERAGE.md` for exactly what's wired,
  scored, deferred and never-wired, and why.
- **v1 scored, but ~a third of its checks couldn't be right** (D42). Nine rotation checks read
  `*_turn_from_address`, which DECREASES as a down-the-line golfer turns, so they floored at 0
  on every swing; `perfect` scored 37.5 (Reset), below amateur `swing1` at 45.0. v2 defers
  those nine plus ANG-30, fixes TKA-01 (now a `checkpoint_delta` vs address) and the
  slow-motion duration gate, and weights `overall` by check instead of averaging seven
  category scores. Current: **perfect 78.9 Pure · swing1 65.4 Solid · swing2 54.2 Building**.
  The lesson worth carrying: `validate_scoring_config.py` proves a field *exists*, never that
  it means what the band assumes, and a check scoring 100 is not evidence it works (ROT-06
  scored 100/100/94.5 off the same broken field, by luck).
- **`scripts/rescore.py`** re-runs Stage 8 over an existing `analysis.json` — Stage 8 is a pure
  function of that plus the config, so a scoring change never needs `burnin.py` (and so never
  risks the club-trace overwrite CLAUDE.md warns about). `--dry-run` to preview.
- **Persistence is Postgres, not SQLite** (`docs/DECISIONS.md` D38) — `users` / `sessions` /
  `swings` / `jobs` / `scores` tables via Drizzle, migrations in `apps/web/drizzle/`. Local dev
  runs the same engine via `docker compose up -d` (port 5433, not 5432 — see
  `docker-compose.yml`'s comment on why); production is intended to be Railway-managed Postgres,
  not provisioned yet. `pnpm db:seed` creates the one admin user everything is owned by;
  `pnpm db:backfill` indexes `out/<id>/` folders that predate the DB (or were analysed by
  hand via CLI, which still doesn't touch Postgres — only the web app's reanalyze job does).
- **`lib/jobs.ts`'s in-memory `Map`** (the thing that used to lose a running job's status on
  every Next.js hot-reload) is now the `jobs` table, with an in-process mirror only for the
  actively-running job in this process so the per-frame stdout hot path never round-trips the DB.
- **Known gap, named rather than silently carried:** `burnin.py` run directly from the CLI has
  no idea Postgres exists. Regenerating a fixture by hand and forgetting `pnpm db:backfill`
  afterward leaves the swing list showing a stale score. Always re-run `db:backfill` after a
  manual `burnin.py` run on a fixture already in the DB.
- **A related, sharper trap already bit this session: see `docs/DECISIONS.md` D39.**
  Re-running `burnin.py` on a committed fixture for an unrelated reason (there, testing Stage 8
  itself) without `--club-detector runs/clubhead/weights/best.pt` silently regenerated the club
  trace on the weaker classical-only path, overwriting the better one already on disk. Fixed;
  the general lesson (re-running a fixture needs its previous canonical flags, not just the one
  you're testing) is captured in D39 and above `burnin.py`'s flag list in CLAUDE.md.

---

## 7. Setting up a new machine

```bash
# system
winget install Gyan.FFmpeg          # or apt/brew equivalent
# node 22+, pnpm 11+

# analyzer
cd services/analyzer
python -m venv .venv                # Python 3.11-3.14 all fine
.venv/Scripts/python -m pip install mediapipe opencv-python numpy scipy \
    rtmlib onnxruntime ultralytics roboflow

# pose model (30MB, gitignored)
curl -o models/pose_landmarker_heavy.task \
  https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task
# RTMW wholebody weights download themselves on first run, into ~/.cache/rtmlib

# web
cd apps/web && pnpm install && pnpm dev
```

Then `python scripts/burnin.py <video>` to regenerate `out/` — it is gitignored, so the new
machine needs one run per fixture before the web app shows anything.

**Fixture clips live in `instructions/swing/` and ARE committed** — they are the ground truth
for everything above.

---

## 8. Known debt

- `analysis.json` (300–700 KB) is passed to the client as React props. Doc 02's Frame Sync
  section wants a client-side fetch into typed arrays instead.
- `services/analyzer/web/player.html` + `scripts/serve.py` are the superseded stopgap player;
  the Next.js app replaced them. Safe to delete once you are confident.
- No tests at all. Doc 03 §7 wants golden snapshots on 3 fixtures. **This has now cost us
  something concrete:** swing2's tempo reads 1.76:1 on machine 2 against the 1.93:1 recorded
  here. The likely cause is the uncommitted pose work below rather than the environment, but
  with no snapshot there is no way to confirm it (D21a).
- **There is uncommitted work in the tree on top of `879a908`, and it is not documented
  anywhere but here.** `skeleton.py` (+79, new `MEASURED` keypoints incl. `middle_mcp`),
  `pose_rtm.py` (+70), `postprocess.py` (+37), `pose.py` (+16), `SwingPlayer.tsx`, a new
  untracked `scripts/kpdebug.py`, the fixture renamed to `swing1.mp4` (same bytes), and the
  pnpm workspace moved from `apps/web/` to the repo root. Commit or describe it before the
  numbers in this file can be trusted again — several of them were measured before it existed.
- ~~No club-model versioning in `analysis.json`.~~ Closed by D23 — `club.detector` records the
  weights' SHA-256, size, imgsz, conf and class map.
- ~~Metric thresholds are provisional... must move to a versioned `scoring_config.json` before
  any scoring ships.~~ Closed — `scoring_config/v1.json` exists and Stage 8 reads it (§6).
  `metrics.angle_fields` itself (D31) stays deliberately band-free regardless: the scoring
  config is where bands live per CLAUDE.md's non-negotiable, not the angle catalogue that just
  says what's measured. `provisional_thresholds: true` still means what it always did — the
  underlying metric bands haven't been calibrated against real (not just these two) fixtures;
  `scoring_config/COVERAGE.md`'s calibration warning says the same thing about the scoring
  bands specifically, and for the same reason.
- **Joint angles are 2D projections and some of them are visibly wrong at the top.** swing2's
  trail elbow reads 172° of flex at P3 and its lead hip hinge reads 179.8° at P4, both because
  the limb points near the camera axis. `lead|trail_arm_in_plane` measures how bad it is for
  the arms (0.35 at that P3 against 0.86 at address); the hip hinge has no equivalent guard
  yet. A second view would fix this properly and nothing else will (doc 03 §5).
- Two dev-environment gotchas, both already handled but worth knowing: `next.config.ts`
  enumerates LAN IPs into `allowedDevOrigins` (without it a phone gets HTML that never
  hydrates), and on Windows use `127.0.0.1` rather than `localhost` (which resolves to `::1`).
