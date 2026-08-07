# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current State

**SwingSage** is an upload-based AI golf swing analysis app. **Read
[docs/STATUS.md](docs/STATUS.md) first** — it is the current handoff state, and this file's
"Current state" section further down carries the measured numbers.

In short: the analyzer pipeline runs end to end (normalize → pose → Stage 3 → events → club →
face → metrics → **scoring (Stage 8)** → `analysis.json` + `coach_report.json` → Next.js
player) on both fixtures, with a golden-snapshot and invariant suite over the deterministic
stages including scoring. Persistence is real Postgres (Drizzle), not SQLite — see
[docs/DECISIONS.md](docs/DECISIONS.md) D38 for why the "v1 SQLite" shortcut doc 02 describes
was skipped outright. Not built yet: AI provider (doc 07 — scoring's coach narrative is
deterministic, not AI, today), simulator ingestion (doc 06), the upload flow —
`burnin.py` is still run by hand, though its output is now indexed into Postgres
(`pnpm db:backfill`) rather than only readable off disk. **There are 2 fixtures where the
Working Practices' 10–20-clip target (below) wants far more, and no hand-labelled event truth
at all, so no acceptance percentage anywhere in this project is independently verifiable yet.**
Scoring coverage is also partial by design — see
[services/analyzer/scoring_config/COVERAGE.md](services/analyzer/scoring_config/COVERAGE.md)
for exactly which `instructions/criteria.md` rows are wired versus deferred.

`instructions/` is the source of truth. Before writing code for a phase, read that phase's
referenced spec doc(s). The docs are dense and cross-referenced — read the specific doc,
don't guess from this summary.

| Doc | Covers |
|-----|--------|
| [00-README.md](instructions/00-README.md) | Vision, constraints, repo layout, engineering principles |
| [01-PRODUCT-SPEC.md](instructions/01-PRODUCT-SPEC.md) | Features F1–F8, user stories, UX |
| [02-ARCHITECTURE.md](instructions/02-ARCHITECTURE.md) | Stack, pipeline stages, data model, `analysis.json` contract, API surface |
| [03-POSE-TRACKING.md](instructions/03-POSE-TRACKING.md) | MediaPipe pose, Stage 3 post-processing, angle toolkit |
| [04-CLUB-TRACKING.md](instructions/04-CLUB-TRACKING.md) | Shaft/head CV (hardest problem), trace, face-angle honesty policy |
| [05-SWING-PHASES-AND-SCORING.md](instructions/05-SWING-PHASES-AND-SCORING.md) | 8-event detection, metrics, scorecard, coach narrative |
| [06-SIMULATOR-DATA-INGESTION.md](instructions/06-SIMULATOR-DATA-INGESTION.md) | Launch-monitor screenshot + impact-image parsing schemas |
| [07-AI-INTEGRATION-CLAUDE-CODE.md](instructions/07-AI-INTEGRATION-CLAUDE-CODE.md) | `AIProvider` abstraction, Claude Code headless provider |

## Non-Negotiable Constraints

These override normal judgment calls. They are decisions already made, not open questions.

- **Uploads only, never live capture.** Everything is offline batch analysis of a 3–15s clip.
- **CV lives in Python, not Node/browser.** MediaPipe + OpenCV + ffmpeg in a FastAPI worker.
  Doc 02 calls this non-negotiable for v1. The frontend never runs CV — it only renders.
- **Deterministic CV first, AI second.** Pose, club, phase, and angle math are machine
  vision. Claude is used only for: coaching narrative, correction of *low-confidence spans*
  (capped ~10 frames/swing), simulator image parsing, and trend notes. Never send raw video
  to the AI — send extracted keyframe images + structured JSON.
- **AI is an enhancement, never a hard dependency** for a swing reaching `ready` status.
  The whole pipeline must run green with `AI_PROVIDER=mock`. (Sole exception: simulator
  image parsing is inherently AI and may fail visibly.)
- **Local dev uses the Claude Code CLI, not an Anthropic API key.** All AI goes through the
  `AIProvider` interface; `ClaudeCodeProvider` shells out to `claude -p --output-format json`
  against the developer's own subscription. Production swaps to `AnthropicAPIProvider` via
  one env var. Never ship end-user traffic served by a subscription login (doc 07 §3
  compliance notes).
- **Confidence on everything** — every keypoint, club detection, event frame, and parsed
  stat carries a confidence. The UI dims/flags low-confidence data.
- **Handedness must be threaded through all angle math.** Right/left mirroring is a
  correctness requirement, not a polish item.
- **Never fabricate a face-angle number from video.** Video gives checkpoint
  classifications (square/open/closed); the simulator impact image is the authoritative
  degrees source (doc 04 §6).
- **Thresholds live in a versioned `scoring_config.json`**, never hardcoded. Every coach
  report stores `scoring_model_version` so old reports stay reproducible.
- **Infrastructure decisions target production scale, not MVP shortcuts.** Where a spec doc
  offers an interim/"v1" shortcut for a later "v2" (doc 02's SQLite-now/Postgres-later,
  local-disk-now/S3-later), default to the scale-ready option instead and log the deviation in
  `docs/DECISIONS.md` — building the interim version is the debt this rule exists to avoid, not
  a shortcut that saves time. Concretely: the persistence layer is **Postgres via Drizzle**, not
  SQLite (D38) — SQLite's single-writer model doesn't survive multiple app instances or
  concurrent users, and every user-scoped table carries a real `user_id` foreign key from its
  first migration, never a hardcoded string, even while only one seeded user exists.

## Architecture — the parts that span files

### Two services, one artifact
Next.js web app (UI + API routes + job orchestration) and a Python FastAPI analyzer talk
via **shared DB rows + polling** in v1 (chosen over HTTP callbacks for simplicity). The
analyzer's only real output is **`analysis.json` per swing** — the single contract between
backend and player. Full schema in doc 02. Key properties to preserve:

- All coordinates **normalized 0–1** (x right, y down) so the client scales to any canvas.
- Keypoint array order is fixed by `keypoint_names`: native 33 → derived 7 (`neck`,
  `mid_hip`, `spine_mid`, `head_center`, `grip_center`, `left_hand`, `right_hand`) →
  measured 8 (knuckles, small toes, `chin`, `nose_bridge`, jaw) → derived-tail 1 (`waist`)
  = **49**. Append only, never reorder — the measured block sits after the derived one
  precisely so published indices 0–39 keep their meaning (D25), and `waist` sits *after
  measured* rather than beside its siblings for the same reason (D47). Only a wholebody
  model fills the measured block; other paths zero it and dependent metrics report `null`.
  Undo the derived joints with `skeleton.strip_derived()` — the two derived blocks are not
  contiguous and a hand-written slice gets it wrong silently.
- **`waist` is a rendering point, not a measurement** (D47). No pose model in the pipeline
  labels the abdomen, so it is the midpoint of `spine_mid` and `mid_hip` and carries no
  information the shoulders and hips do not already carry. Do not build a scoring check on
  it — that would be D42's failure again, dressed as a new signal.
- `interp: true` marks smoothed/interpolated values — the UI renders these dashed at 60%.
- It must be renderable with no client-side computation beyond coordinate scaling.
- **Keypoints are anatomical (`left_wrist`); metrics are lead/trail (`lead_knee_flex`).**
  Lead = the side closest to the **target**, set by handedness — never "the side facing the
  camera", which inverts for a left-handed golfer. `metrics.sides` carries the resolved
  mapping. [docs/GLOSSARY.md](docs/GLOSSARY.md) is the single vocabulary for the UI,
  scorecard and coach narrative; `metrics.glossary` maps standard golf terms onto existing
  fields (D29).
- **Eight events, ten checkpoints, one detection.** `events` stays the GolfDB contract;
  `checkpoints` is the same swing as the ten P-system positions a coach names, adding P6
  (shaft parallel coming down) and P9 (trail arm parallel through). `metrics.angle_fields`
  is the one angle catalogue — the burn-in table and the player's table both render from it,
  so adding an angle in `metrics.py` adds a row in both, and `geom` on each entry is what
  lets the player draw that angle over the video on click. **Angle conventions differ by
  shape**: `_flex` is 0° = straight, `_hinge` is the interior angle, from-vertical angles are
  signed and the sign flips with camera side, stack angles are 90° = stacked. Every 2D joint
  angle is projection-sensitive — read the elbows with `lead|trail_arm_in_plane` (D31).
  GLOSSARY §6–7.
- **Keypoint confidence in `analysis.json` is truncated, not rounded** (D33). Every consumer
  re-applies the same `MIN_CONF` gate, so a value rounding *up* onto the threshold makes the
  client include a point the analyzer dropped, and the two then describe different geometry.
  This applies to any threshold a client reads back, not just this one.

Because analysis is a stored artifact, "re-analyze" can re-run improved models over historic
swings, and the AI disk cache (hash of promptId + variables + image bytes) makes re-runs free.

### The 9-stage pipeline
`normalize → frames → pose → pose-post → club → events → metrics → ai-review → coach`
(doc 02). Each stage writes `stage`/`progress_pct`/`message` to the job row so the UI shows
meaningful progress and failures are diagnosable per stage. Stages 2–4 are the slow ones and
report per-frame progress.

Data dependencies that dictate build order: club tracking (doc 04) uses `grip_center` from
pose to constrain its search annulus; event detection (doc 05) uses both wrist trajectories
and club-head speed. That's why Phase 3 ships club-independent event fallbacks first and
Phase 4 comes back to refine Impact/Toe-Up once club data exists. **Do not reorder
Phases 2→5.**

### Frame sync is the #1 perceived-quality feature
Overlay drift during scrubbing is the thing users notice. The mechanism (doc 02 → Frame Sync):
normalize to CFR 60fps in Stage 0 (`ffmpeg -vsync cfr -r 60`) so `frame = round(currentTime * fps)`
is exact — VFR phone video *will* break this; seek to `(frame + 0.5) / fps` to dodge boundary
rounding; use `requestVideoFrameCallback` during playback with rAF fallback; canvas stack is
`video → skeleton → club → trace → annotations`.

### Quality gates degrade, they don't crash
Pose confidence catastrophically low → fail with a user-readable reason + filming tips.
Club coverage < 50% → still succeed, disable the trace toggle with a tooltip, and exclude
club-dependent scores marked "not scored — club not trackable." Every AI call validates
against its JSON schema, retries once with the validation error appended, then falls back to
a non-AI default.

### Planned repo layout (doc 00)
```
apps/web/          Next.js 14+ App Router, TS, Tailwind
services/analyzer/ Python 3.11 FastAPI worker (ffmpeg, MediaPipe, OpenCV)
packages/shared/   TS types generated from JSON schemas
ai/providers/      claude-code | anthropic-api | mock
ai/prompts/        <promptId>/v<N>/{prompt.md, schema.json, examples/}
fixtures/          test swing videos + golden analysis JSON
schemas/           analysis.json, simulator-stats, impact-image
docs/              DECISIONS.md (log every spec deviation here)
```

## Toolchain

Installed and smoke-tested end-to-end (ffmpeg → OpenCV decode → PoseLandmarker VIDEO mode):

Versions differ between the two dev machines and **both work** — pin nothing on these
numbers. See DECISIONS D21 for the drift and the one metric it may have moved.

| Tool | Version | Notes |
|---|---|---|
| ffmpeg / ffprobe | 8.1.2 or **9.0** (`Gyan.FFmpeg` via winget) | Use `-fps_mode cfr` — `-vsync` is deprecated. 9.0 accepts it too |
| Python | 3.14.6 or **3.13.7** | venv at `services/analyzer/.venv` |
| mediapipe | **1.0.0** | Legacy `mp.solutions.pose` is **gone** — see `docs/DECISIONS.md` D1 |
| opencv-python | 5.0.0 | |
| numpy | 2.5.1 | |
| torch | 2.13.0+**cu126** | Only for the club detector. `pip install torch` gives a CPU build — use the cu126 index and assert `torch.cuda.is_available()` (D21b) |
| ultralytics | 8.4.115 | club-head detector training/inference |
| Node / pnpm | 22.20.0 / 10.23.0 or 11.9.0 | pnpm workspace rooted at the repo root |
| Claude Code CLI | 2.1.202+ | for `ClaudeCodeProvider` later |
| Postgres | 16-alpine (Docker) | local via `docker-compose.yml`; Railway-managed in prod (D38) |
| Drizzle ORM / drizzle-kit | ^0.45 / ^0.31 | schema at `apps/web/src/db/schema.ts` |

**GPU is optional but changes the plan.** One machine has a GTX 1080 (8 GB, CUDA 12.6); the
40-epoch club-detector run is ~197 s/epoch there (**~2h10m**, not the ~20 min STATUS.md
estimated) against ~25 h on CPU. Pascal needs `amp=False` — see D21b.

Pose model bundle is vendored at `services/analyzer/models/pose_landmarker_heavy.task`
(30.6 MB, not in git — re-download from the MediaPipe model URL if missing).

Run the analyzer's Python via the venv interpreter directly:
`services\analyzer\.venv\Scripts\python.exe`

**Read `docs/DECISIONS.md` before writing pose code** — doc 03's API no longer exists as
written, and the Tasks API has a monotonic-timestamp constraint that shapes the design.

### How to read DECISIONS.md

It is an **append-only log of experiments, not a description of the current system.** 53
entries (D1–D53, plus lettered sub-entries), and they do not all still hold. Every entry carries a `Status:` line —
`ACTIVE` / `SUPERSEDED by Dxx` / `NEGATIVE RESULT — do not retry` / `HISTORICAL` / `OPEN`.
**Check it before acting on an entry**; roughly a quarter are no longer current.

Entries are never deleted or renumbered — 18 are cited by number from source comments, so
renumbering would break those silently. Environment and version facts belong in the toolchain
table above, not in the log (D2 is retained only so its number isn't orphaned).

Two live traps:
- **D26 invalidated every confidence number recorded before it.** "100% coverage @ 1.00" was a
  clamp on SimCC peak magnitudes, not the model's opinion. Pre- and post-rescale confidence
  figures are not comparable — this affects D4, D9, D15a and STATUS.md's tables.
- **D20 is the standing blocker.** There is still no club-head position-error metric, so any
  club change tuned on smoothness is unfalsifiable. That includes D23's `detector_gain`.

## Build System

There is no static phase document driving development anymore — the earlier `08-ROADMAP.md`
was removed in favor of the `.claude/` agentic build system, which tracks real work as
independent **tracks**: each a self-contained mini-build (`_STATUS.json` + `_PROGRESS.md` +
numbered step files under `.claude/feature-tracks/<id>/`, following the template in
`.claude/ai-instructions/00 - README.md`). The macro index across all tracks is
`.claude/ROADMAP.json`, rendered by `/roadmap` (status is *derived* from each track's
`_STATUS.json` — never hand-write progress into the roadmap).

- `/architect <goal>` — turn a goal into a new scaffolded track (numbered step files, deps,
  verification-first). `/architect-deep` for a more thorough planning pass on a larger goal.
- `/roadmap` — macro picture across all tracks (read-only).
- `/feature <name>` — advance any track; `/feature <name> status|verify|reset|skip|blocker` for
  sub-ops. There is no `spine: true` track yet — mark one in `ROADMAP.json` once the project
  wants `/build` to have a default target; until then, drive every track through `/feature`.
- `/future` (or `/icebox`) — capture a future / nice-to-have idea into the backlog at
  `docs/icebox/`; `/future develop <ICE-NNN>` graduates one into a track.
- `/status`, `/verify`, `/skip --reason="..."`, `/reset-step`, `/blocker` — operate on the
  active track.
- `/audit`, `/heal`, `/checkpoint`, `/commit` — quality gates and safety net around any of the
  above; see the `audit` and `heal` skills for what each checks.

Never advance without Verification passing. Never modify a step's `Steps` section in place —
append a note explaining why. `human-review-required` steps wait for explicit approval. Never
edit any `_STATUS.json`/`_PROGRESS.md` directly; route through `progress-tracker`. Deep
mechanics live in the orchestration skills (`build-orchestrator`, `feature-orchestrator`,
`architect`, `roadmap`, `progress-tracker`, `step-verifier`, `blocker-protocol`). Decisions made
while running a track still go through this file's existing rule: append a numbered entry to
`docs/DECISIONS.md`, never a separate per-domain register.

## Commands

Analyzer commands run from `services/analyzer/` with the venv interpreter
(`.venv\Scripts\python.exe`); the web app runs from the repo root. `apps/web` **is**
scaffolded and is the real player — `scripts/serve.py` + `web/player.html` are the superseded
stopgap.

```
# analyzer (Python) — from services/analyzer, using .venv\Scripts\python.exe
python scripts/burnin.py <video>          analyse a clip -> out/<stem>/
      --view dtl|face_on  --handedness right|left
      --pose-model rtmpose|mediapipe      default rtmpose (DECISIONS D10)
      --no-wholebody                      drop to Halpe26; loses real hands (D15a)
      --analysis-short-side 720           keep 720; higher is pure cost (D5)
      --no-stage3 / --no-club             skip a stage, for A/B
      --club-detector runs/clubhead/weights/best.pt    Stage 4b learned head detector (D23)
      --club-detector-device cpu          if a training run owns the GPU
      --club-detector-gain 0.8            evidence weight; A/B against no detector
      --club-type driver|irons            for Stage 8's club-aware scoring bands (omit if unknown)
      --scoring-config v2                 scoring_config/<version>.json to score against
      --no-scoring                        skip Stage 8
      --no-silhouette                     skip Stage 2b (the golfer's outline, D48)

python scripts/rescore.py                 re-run ONLY Stage 8 over every out/<stem>/analysis.json,
      --dry-run                           rewriting coach_report.json. Stage 8 is a pure function
      --config v1                         of analysis.json + the config, so a scoring change never
                                          needs burnin.py — use this, not a re-run (D42)

python scripts/resegment.py               add ONLY Stage 2b (silhouette.json + the address butt
      --dry-run                           line) to an already-analysed out/<stem>/. Patches
                                          posture into analysis.json; touches nothing else (D48)

# ⚠ ALWAYS pass --club-detector runs/clubhead/weights/best.pt when re-running burnin.py on the
# committed fixtures for any reason (including just testing unrelated code) — omitting it
# silently regenerates the club trace on the weaker classical-only path and overwrites the
# better one already on disk. This has actually happened; see the commit history around D38.

# club-head detector (Stage 4b) — needs ROBOFLOW_API_KEY in services/analyzer/.env
python scripts/fetch_club_dataset.py      -> datasets/Golf-Swing-9/ (562 MB, gitignored)
python scripts/train_club.py              yolo11s @ 640, 40 epochs -> runs/clubhead/
                                          ~197 s/epoch on a GTX 1080 (D21b)

python scripts/checkclub.py out/<stem>    club drawn over the real frame at each event
python scripts/checktrace.py out/<stem>   the drawn TRACE, not the per-frame club: how close
      --variant model_trace_savgol        it gets to the ball, every span where nothing was
      --all                               measured (with the chord it fabricates), fidelity,
                                          and the playhead mapping error (D43)
python scripts/checktop.py out/<stem>     every signal that could define the top of the
                                          backswing, side by side, with the tempo each
                                          implies. Top is a HAND landmark today and the club
                                          is still going back when it fires (D49, OPEN)
python scripts/checkball.py out/<stem>    the ball, the Address club head, and the
      --live                              disappearance image the search reads, on the real
                                          frame. --live re-runs the search with no burnin (D44)
python scripts/checkbutt.py out/<stem>    the stored silhouette and the address butt line drawn
      --frames 219 415  --all             back over the real frames. Reads the artifact only —
                                          it never re-segments, so it shows what the player draws
python scripts/clubdebug.py out/<stem>    motion mask | candidates | chosen shaft
python scripts/kpdebug.py <video>         RTMW's 133 sub-indices drawn + asserted on a
      --frame N                           real frame; run before trusting any new mapping
python scripts/qa.py out/<stem> --motion  grip-height trace; reads swing structure
python scripts/qa.py out/<stem> --frames 30 86 114
python scripts/checkangles.py out/<stem>  every angle the player DRAWS vs the value it
      --field lead_knee_flex              LABELS it with, on every frame. Run after any
                                          change to metrics._angle_geometry or to the
                                          player's point resolution (D33)

# web app (Next.js) — from the REPO ROOT, not apps/web
pnpm i                                    installs every workspace package
pnpm dev                                  http://127.0.0.1:3000 (also binds LAN)

# database (Postgres via Drizzle, D38) — from apps/web, needs Docker Desktop running
docker compose up -d                      from the REPO ROOT — starts Postgres on :5433
                                          (not :5432 — see docker-compose.yml if that's free
                                          on your machine and you'd rather use it)
pnpm db:migrate                           apply apps/web/drizzle/*.sql
pnpm db:seed                              create the one "admin" user every swing is owned by
pnpm db:backfill                          index every out/<id>/ folder into Postgres + sync
                                          coach_report.json scores — idempotent, re-run anytime
pnpm db:generate                          after editing apps/web/src/db/schema.ts
pnpm db:studio                            browse the DB in a browser (drizzle-kit studio)
```

`apps/web` is the real UI (doc 02's stack). `scripts/serve.py` + `web/player.html` are the
superseded stopgap. The web app reads `out/` directly via `SWINGSAGE_MEDIA_ROOT`.

**The visual spec is `instructions/template_sample.html`** (D35). Its `<style>` block lives
unaltered in `app/globals.css`, and the `tailwind.config` colours it declared inline are the
`@theme` block there — Tailwind v4 reads theme tokens from CSS, not from a JS config. The
sample's card shapes are named components in `components/ui/kiosk.tsx`; use those rather than
inventing a new panel. Layout:

```
SwingWorkspace   workspace bar + three folder tabs; owns the playhead and the drawn angles
├ SwingStage     video + overlay canvas + the transport burned into the frame
│ └ OverlayMenu  overlay selection, as a dropdown over the video (lib/overlays.ts drives it)
└ views/         OverviewView (golfer) · CoachView (narrative) · AdvancedView (everything else)
lib/usePlayer.ts frame sync + transport, doc 02's contract — nothing here is negotiable
```

**Overview and Coach run on real scores now.** `lib/scoring.ts` reads `coach_report.json`
(Stage 8's output, written by `swingsage/scoring.py`), typed via `lib/scoreDisplay.ts`'s
`Scorecard` — the mock generator (`lib/mockScoring.ts`) is deleted, not superseded-in-place.
`lib/scoreDisplay.ts` is deliberately split from `lib/scoring.ts`: the former has no I/O and is
safe for `"use client"` components to import (types + `scoreColor`/`scoreBand`), the latter
reads off disk (`node:fs`) and must only be called from a server component or `db/scores.ts` —
importing `lib/scoring.ts`'s value exports from a client component pulls the Postgres client
into the browser bundle, which is exactly the bug this split exists to prevent. The Advanced
tab remains measurements-only for `analysis.json`'s own numbers, plus a real
`CriteriaBreakdown` of every scored check. The face-angle rule still stands: nothing here ever
fabricates a face-angle degree from video (doc 04 §6).

**Editing `swingsage/` does not change a stored `analysis.json`** — the player keeps drawing
the old artifact until something re-runs the analyzer, which is the usual reason a pipeline
change "doesn't show up". The swing page has a **Re-analyze** button for exactly this: it
re-runs `burnin.py` over the clip recorded in `video.source.path`, polls
`GET /api/swings/:id/reanalyze` for stage/progress, and reloads when done (~90s). Job state is
in the `jobs` Postgres table now (D38), mirrored through an in-process map only while a job is
actively running in this process (so the hot stdout-per-frame path never round-trips the DB);
the protocol is still doc 02's (D30). On success the same handler calls `db/scores.ts`'s
`syncSwingScore` to pull the freshly written `coach_report.json` into the `scores` table and
the `swings` row's denormalized `overall_score`/`band`/`scoring_model_version` columns —
**`burnin.py` run by hand from the CLI does not touch Postgres at all**, so a manually-run
fixture needs `pnpm db:backfill` (idempotent) before its score shows up in the swing list.

Two dev-environment gotchas, both already handled in config but worth knowing:
`next.config.ts` enumerates this machine's LAN IPs into `allowedDevOrigins` — without it
Next 16 serves the HTML but blocks `/_next/*` cross-origin, so a phone gets a page that never
hydrates. And on this machine use `127.0.0.1`, not `localhost` (resolves to `::1` first).

`burnin.py` writes `normalized.mp4` (1080 CFR, player source), `analysis.mp4` (720, what CV
consumed), `analysis.json`, `silhouette.json`, `overlay.mp4` (skeleton burned into pixels),
`contact.jpg`.

Pipeline stages live in `swingsage/`: `video` (Stage 0) → `pose`/`pose_rtm` (Stage 2) →
`postprocess` (Stage 3) → `events` (Stage 5) → `club` (Stage 4) → `checkpoints` (Stage 5b) →
`metrics` (Stage 6) → `silhouette` (Stage 2b). Stage 4 runs after events because the trace is
segmented by them, and 5b runs after Stage 4 because three of the ten checkpoints are
shaft-defined (D31). **Stage 2b is numbered where its data is produced, not where it runs**: the
masks come off the Stage 2 MediaPipe pass (`pose.estimate(silhouette=True)`, +2s), but the butt
line derived from them needs the address hold and body height, so it is assembled last (D48).

`silhouette.json` is a **separate artifact** from `analysis.json` — 0.3–1.1 MB of per-frame
outline, fetched by the player only when its overlay is switched on. The small part
(`posture.butt_line`, the address posture line) does live in `analysis.json`, so it draws with
no extra fetch. `scripts/resegment.py` adds both to an existing `out/` folder without a re-run.

**Always run `clubdebug.py` before trusting anything club-related.** Doc 04 §7 calls it
non-negotiable and it has earned that twice already — coverage numbers looked healthy while
the trace was visibly wrong.

**Two club-at-the-ball features exist and are both OFF by default; read D44 before turning
either on.** `club.anchor_ball` (`--club-ball-anchor`) puts the head on the ball at Impact when
nothing detected it there — it takes `pro_2` from missing the strike by 35% of body height to
3.4%, and it *degrades* `perfect`, where it overwrites a real detection with a landmark 48px
away. Nothing inside the algorithm separates the two cases. `club.find_ball`
(`--club-ball-detect`) looks for the ball by its disappearance at impact and finds the golfer's
shoe on two fixtures, nothing on the other two. A learned ball detector is what makes the anchor
safe, and D44 argues it is the highest-value model left to train. Note also that doc 04 §3's
"the club head at Address is the ball" is **not reliable**: on `perfect` the club is still off
the turf at the detected Address frame, 150px from the ball. Until then, hand-placed markers are
the supported way to put the head on the ball.

**Hand corrections live in Postgres, never in `analysis.json`** (D45). The player's "modify head
markers" mode writes `head_markers` rows; `analysis.json` is rewritten by every re-analysis, so a
correction stored there would be destroyed by the next run. The trace merges markers by frame,
which is only possible because `trace_frames` exists.

**Impact snaps to the club head's lowest point, and the address hold requires the CLUB to be
still** (D50) — both in `club.refine_events`, which is where anything the club measures better
than the hands belongs. Impact was 7 frames early on `perfect`; the address "hold" there spanned
127px of club travel, so setup medians and the ball landmark were taken over a club sliding into
position. `refine_events` must be handed the DETECTOR's heads — it runs on the primary solve,
whose `from_model` is false everywhere, and passing nothing silently refines nothing.

**Re-analysis is started from the video's settings gear**, and progress shows at the top of the
workspace (D52). The job is owned by the page, not by the button — a menu closes on the click
that starts a 90-second run. `getJob` settles a job whose owning worker is gone by reading
`.analysis.lock` and the artifact's mtime; without that a finished analysis could leave its row
"running" forever and block every future re-run of that swing.

**`video.source.path` is verified before the artifact is written** (D53). It has one reader —
re-analysis — so a wrong value is invisible until someone presses the button. A shadowed loop
variable once made it a 2.3 MB stringified ClubResult on every fixture and nothing caught it.

**The approach and finish are exactly one second** (D51). `playback_window` is pinned to
`address − 1s … finish + 1s` so every clip's lead-in and run-out match — required by the
comparison view. Clips too short publish `playback_pad` and the player freezes the end frame for
the shortfall.

**Top of backswing is a hand landmark, not a club one** (D49, OPEN). It is the hands' highest
point; the club keeps working at the top after the hands reverse — 15 frames on swing2 — so the
phase flips to downswing while the club is still going back, and tempo reads low on all four
fixtures (1.55–2.47 against a typical 3:1). **Do not fix this from club data without reading
D49**: four club-based definitions disagree by more than the transition is long, and on `perfect`
and swing1 there are zero measured club frames within 12 of Top. Hand labels are the unlock.

**Trace smoothing is a render-time choice, not a pipeline one** (D46). Nine methods in the
overlay menu — interpolating (Chaikin, Catmull-Rom, arc-length spline), approximating (Gaussian,
Savitzky-Golay) and fitting (degree-5 least squares) — switchable live, `lib/traceSmoothing.ts`.
Default is Savitzky-Golay. The path is **built once per segment and then revealed** frame by
frame (`buildTracePath` / `cutAt`) — smoothing the visible prefix instead made the curve settle
as it drew, by up to 9px on the strongest settings. Every method keeps the endpoints exact so
the head of the line still lands on the playhead (D43), none of them smooths a bridge, and
revealing is strictly additive. D46 carries both measurements.

**The drawn trace and the per-frame club are different products and fail differently** (D43).
Every complaint so far that sounded like "the club tracking is wrong" has turned out to be the
polyline, not the head: `club.frames[f].head` was right on the frame while the *line* joining
those heads cut a straight chord across the frames the detector declined, or was cut at an
event frame short of the ball, or was grown against the wrong index. `checkclub.py` judges the
first, `checktrace.py` the second — a good `checkclub.py` sheet says nothing about the trace.
The trace never interpolates across a gap: it draws the chord and dashes it, because on
held-out gaps no reconstruction beat a straight line (D43's negative result).

```
# tests — from services/analyzer, using .venv\Scripts\python.exe
python -m pytest tests                    28 tests, ~0.5s, no video/GPU/out/ needed
python -m pytest tests --update-golden     rewrite snapshots, then FAIL the run on purpose
python scripts/make_test_data.py --all     re-freeze test input from out/<stem>/analysis.json
```

**The suite replays the deterministic stages over *frozen* pose and club output** committed in
`tests/data/*.input.json.gz` (~130 KB per clip). So it is hermetic and fast, and a change to
pose inference — a TensorRT/FP16 port, a new model — shows up as a golden diff on every
downstream number rather than hiding inside one. Regenerate the frozen input deliberately when
pose genuinely changes; that is the point at which you decide whether the new numbers are better.

Three kinds of check, and the distinction matters:

- **Golden snapshots** (`test_stages.py`) prove nothing has *changed*. They cannot prove anything
  is *right* — a snapshot taken while Address was 48 frames early would have locked that in.
- **Contract invariants** (`test_invariants.py`) need no golden file, so they keep working as
  fixtures are added: 49 keypoints in append-only order (D25, D47), normalized coordinates,
  5-decimal truncated confidence (D33), strict event ordering, `playback_window` containing the
  swing (D36), tempo self-consistency.
- **Hand labels** (`test_hand_labeled.py`) are the only thing that proves correctness, and they
  are **unfilled** — `tests/fixtures.json:hand_labeled` is null for both clips, so doc 08
  Phase 3's ±3-frame criterion is unmet and those tests skip rather than pass vacuously. The
  fixture-count check xfails at 2 of the 10 clips doc 08 Phase 0 wants.

## Current state (2026-08-04)

Pipeline runs end to end on both fixtures: normalize → MediaPipe (localiser) → RTMW
wholebody 133 → Stage 3 → events → club → face → metrics → `analysis.json` → Next.js player.

| | swing1 | swing2 |
|---|---|---|
| `grip_center` | 94.2% @ 0.73 | 90.9% @ 0.71 |
| `nose_bridge` (head anchor) | 100% @ 1.00 | 96.8% @ 0.79 |
| `head_center` (ear midpoint) | 23.7% @ 0.46 | 68.6% @ 0.57 |
| Club coverage | 100/100/100% | 100/100/100% |
| Club correct at events (by eye) | 5 of 6 (toe-up flipped) | 5 of 6 (finish uncertain) |
| Tempo | 2.09:1 | 1.55:1 (flagged, D37) |

**These are not comparable to numbers recorded before 2026-08-04.** Confidence used to be
clamped to 1.00 for every RTMW keypoint, so the old "94–100% @ 1.00" measured the clamp, not
the model (D26). Values are lower now and mean something. Regenerate any stored
`analysis.json` rather than comparing against it.

**Coverage percentages have overstated club quality three separate times.** Always run
`scripts/checkclub.py` and look at the club drawn over the real frame before believing them.

Not built yet: AI provider (doc 07 — scoring's coach narrative is deterministic today, not
AI-generated), simulator ingestion (doc 06), the upload flow. Scoring (doc 05 C, Stage 8) is
built but deliberately partial — 38 of the criteria.md rows the triage marks buildable are
wired, of which **28 score and 10 are `deferred`** (authored but abstaining on every swing
because the metric behind them isn't trustworthy); see
`services/analyzer/scoring_config/COVERAGE.md`. Current scores: **perfect 78.9 Pure · swing1
65.4 Solid · swing2 54.2 Building** against `scoring_config/v2.json`.

**Scoring's standing trap, and it is the same shape as the club one (D42).**
`validate_scoring_config.py` proves a config's field *exists* in `metrics.py`'s output — it can
never prove the field means what the band assumes. v1 shipped nine rotation checks reading
`*_turn_from_address`, a quantity that DECREASES as a down-the-line golfer turns, so they scored
0 on every swing and dragged `perfect` below an amateur swing. One of them (ROT-06) scored
100/100/94.5 and looked healthy — that was luck, not correctness. **A check that scores well is
not evidence the check works.** Before trusting a new check, print its raw value at the
checkpoint across all fixtures and confirm the number moves the way the band assumes.

## Verification strategy (why the harness is shaped this way)

"The stick figure looks wrong" has two unrelated causes — the joint is in the wrong place
(pose), or the right joints are drawn on the wrong frame (sync). Debugging both at once is
miserable, so each is proven independently:

- **Gate 1 — pose, no browser.** `burnin.py` draws frame N's skeleton onto frame N's pixels
  in the same process that computed them, so sync cannot be a variable. Anything wrong in
  `overlay.mp4` *is* the pose. This is also the reference render for Gate 3.
- **Gate 2 — sync, no pose.** The player's "Frame sync check" panel compares the frame the
  browser reports as presented (`requestVideoFrameCallback` mediaTime) against our computed
  index during playback. Non-zero drift means the overlay would slip.
- **Gate 3 — combined.** The canvas overlay must match the Gate 1 burn-in at the same frame.
  Any discrepancy is then attributable, because the pose is already known-good.

## Working Practices (from doc 00 §Engineering Principles)

- **Vertical slices.** Every roadmap phase ends with something demoable in the browser.
  Do not build all backend services before any UI exists.
- **Fixtures gate everything.** Collect 10–20 real clips (both views, both handedness,
  sim + range) into `fixtures/` early; every pipeline change runs against them; golden
  snapshot tests on ≥3 clips. Snapshots are updated deliberately, never blindly.
- **Build the CV debug pages when the doc says to, not later.** Doc 04 §7 marks the club
  debug page (motion mask → Hough candidates → chosen shaft → Kalman gate → final spline)
  as non-negotiable for week 1 of Phase 4; doc 03 §7 wants a pose confidence-heat page in
  Phase 2. Tuning these pipelines blind is not viable.
- **When spec and reality conflict, prefer the spec's documented fallback path** — every
  risky component lists a primary approach and at least one fallback. Log the deviation in
  `docs/DECISIONS.md` so the plan stays truthful.
