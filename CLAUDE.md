# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current State

**Greenfield — no code exists yet.** The repo contains only [instructions/](instructions/): a
complete 9-document spec for **SwingSage**, an upload-based AI golf swing analysis app.
There are no commits on `main`, no `package.json`, and no scaffold. The next task is
Phase 0 of [instructions/08-ROADMAP.md](instructions/08-ROADMAP.md).

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
| [08-ROADMAP.md](instructions/08-ROADMAP.md) | Phase sequence + per-phase acceptance criteria |

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

## Architecture — the parts that span files

### Two services, one artifact
Next.js web app (UI + API routes + job orchestration) and a Python FastAPI analyzer talk
via **shared DB rows + polling** in v1 (chosen over HTTP callbacks for simplicity). The
analyzer's only real output is **`analysis.json` per swing** — the single contract between
backend and player. Full schema in doc 02. Key properties to preserve:

- All coordinates **normalized 0–1** (x right, y down) so the client scales to any canvas.
- Keypoint array order is fixed by `keypoint_names`; derived joints (`neck`, `mid_hip`,
  `spine_mid`, `head_center`, `grip_center`) are **appended after** the model's native 33.
- `interp: true` marks smoothed/interpolated values — the UI renders these dashed at 60%.
- It must be renderable with no client-side computation beyond coordinate scaling.

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

| Tool | Version | Notes |
|---|---|---|
| ffmpeg / ffprobe | 8.1.2 (`Gyan.FFmpeg` via winget) | Use `-fps_mode cfr` — `-vsync` is deprecated |
| Python | 3.14.6 | venv at `services/analyzer/.venv` |
| mediapipe | **1.0.0** | Legacy `mp.solutions.pose` is **gone** — see `docs/DECISIONS.md` D1 |
| opencv-python | 5.0.0 | |
| numpy | 2.5.1 | |
| Node / pnpm | 22.20.0 / 11.9.0 | nothing scaffolded yet |
| Claude Code CLI | 2.1.202 | for `ClaudeCodeProvider` later |

Pose model bundle is vendored at `services/analyzer/models/pose_landmarker_heavy.task`
(30.6 MB, not in git — re-download from the MediaPipe model URL if missing).

Run the analyzer's Python via the venv interpreter directly:
`services\analyzer\.venv\Scripts\python.exe`

**Read `docs/DECISIONS.md` before writing pose code** — doc 03's API no longer exists as
written, and the Tasks API has a monotonic-timestamp constraint that shapes the design.

## Commands

All from `services/analyzer/`, using the venv interpreter (`.venv\Scripts\python.exe`).
Nothing is scaffolded in `apps/web` yet — the browser player below is a plain static page
served by the analyzer, standing in for Phase 1.

```
python scripts/burnin.py <video>          analyse a clip -> out/<stem>/
      --out DIR                           output dir (default out/<video stem>)
      --view dtl|face_on  --handedness right|left
      --analysis-short-side 720           keep 720; higher is pure cost (DECISIONS D5)
      --roi                               experimental, known-WORSE (DECISIONS D5)
      --no-retry                          skip IMAGE-mode re-detection of dropout spans

python scripts/qa.py out/<stem> --motion            grip-height trace; reads swing structure
python scripts/qa.py out/<stem> --frames 30 86 114  full-res annotated frames + sheet

python scripts/serve.py [--port 8000]     browser player at /web/player.html?swing=<stem>
```

`burnin.py` writes `normalized.mp4` (1080 CFR, player source), `analysis.mp4` (720, what CV
consumed), `analysis.json`, `overlay.mp4` (skeleton burned into pixels), `contact.jpg`.

No test suite yet. Golden snapshot tests over `fixtures/` are the Phase 2 deliverable
(doc 03 §7).

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
