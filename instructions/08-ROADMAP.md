# 08 — Development Roadmap

Vertical slices; every phase ends user-demoable. Sequence is dependency-ordered — do not
reorder Phases 2→5. Estimated effort assumes one AI-assisted developer.

---

## Phase 0 — Foundations (2–3 days)
Scaffold monorepo (layout in 00-README). Next.js app, Python FastAPI analyzer, SQLite +
migrations, shared schema package, `AIProvider` with **Mock + ClaudeCode** providers and
the `ai:smoke` script. Collect ≥10 fixture videos into `fixtures/` (both views, both
handedness, sim + range). ffmpeg wrapper: probe, normalize-to-CFR-60fps, thumbnail.
**Accept:** `pnpm dev` runs both services; a hello-prompt round-trips through Claude Code
headless including reading a test image; a fixture video normalizes and probes correctly.

## Phase 1 — Upload & Player Shell (3–5 days)
Upload flow (view/club/notes), swing record + job rows, normalized video storage, swing
list page, player page with **frame-accurate scrubbing** (CFR + half-frame seek +
requestVideoFrameCallback), speed control, frame counter. Canvas overlay stack rendering a
test pattern locked to frames.
**Accept:** upload → scrub any fixture frame-by-frame with zero overlay drift at every
speed; stepping ← → moves exactly one frame.

## Phase 2 — Pose Pipeline & Stick Figure (1–1.5 weeks) → doc 03
Stage 2 MediaPipe estimation; Stage 3 post-processing (gates, side-swap fix, interpolation,
One-Euro smoothing, derived joints); `analysis.json` writer (pose portion); skeleton
renderer with confidence styling; job progress UI; pose debug page (confidence heat).
Golden snapshot tests on 3 fixtures; hand-label spot-check per doc 03 §7.
**Accept:** on all fixtures the skeleton visibly sticks to the golfer through the full
swing; joints listed in the spec all render; interpolated/low-conf styling works; user
story #1 passes (excluding club overlay).

## Phase 3 — Swing Events & Phase Playback (4–6 days) → doc 05 A
Heuristic event detector from pose (club-independent fallbacks first — club data doesn't
exist yet); ordering constraints; confidences; phase bar UI; per-phase loop playback;
event thumbnails. Validate event frames by eye on every fixture (+ optionally a few GolfDB
clips); `events.disambiguate` AI assist wired for low-confidence cases.
**Accept:** 8 events within ±3 frames of hand-judged truth on ≥80% of fixtures; phase loop
(user story #3) works.

## Phase 4 — Club Tracking & Trace (1.5–2 weeks, hardest phase) → doc 04
Week 1: address calibration; motion mask; Hough shaft; head refinement; the CV debug page
(non-negotiable). Week 2: Kalman + per-segment splines; blur-streak handling; trace
polylines + renderer (red/blue, grow/full modes); shaft-angle series; refine Impact/Toe-Up
events now that club data exists; `club.correct` AI assist; quality gate (disable trace
below coverage threshold). Optional 4b (only if needed per doc 04): YOLO head detector.
**Accept:** on ≥70% of fixtures the trace is smooth and convincing through backswing AND
downswing (user story #2); head position error target per doc 04 §7; low-coverage videos
degrade gracefully.

## Phase 5 — Metrics & Golf Coach (1–1.5 weeks) → doc 05 B/C
Metric time-series + event snapshots; `scoring_config.json` (view- and club-aware bands);
deterministic scorecard with per-check evidence frames; `coach.narrate` via AI with schema
validation + bounded score adjustments; Coach Report UI with deep links into the player;
angle-readout overlays in the player.
**Accept:** user story #4 (tap finding → jump to evidence frame); scores stable (±2) across
re-analysis of the same video; narrative cites real measured numbers; report renders fully
with MockProvider too (template fallback).

## Phase 6 — Simulator & Impact Ingestion (4–6 days) → doc 06
`stats.parse` + `impact.parse` prompts with few-shot examples; validation ranges; review/
correct UI; attach-to-swing; screenshot fixture set + golden parses; coach prompt enriched
with ball data when present.
**Accept:** user story #5; ≥95% field accuracy on legible fixtures; corrections persist
separately from raw parse.

## Phase 7 — Swing Log & Trends (4–6 days) → doc 01 F7, 05 C3
History with filters; swing detail composition (video+report+sim data+notes); sessions;
trends charts (score, categories, tempo, sway, club speed, carry) filterable by club;
personal bests; JSON/CSV export; re-analyze button (uses AI cache).
**Accept:** user story #6; trends correct against a hand-computed spot check.

## Phase 8 — Hardening & v1 Polish (ongoing 1 week)
Failure UX per doc 02 quality gates; performance pass (analysis < ~2 min for 8s clip);
mobile player polish; ghost-address overlay; side-by-side compare (v1.5 flag); handedness
audit across all angle math; docs/DECISIONS.md tidy; seed data script.

## Later / v2 Parking Lot
Auth + multi-user; Postgres/S3/Redis; RTMPose upgrade; SwingNet ensemble; two-view 3D
fusion; slow-mo (120/240fps) support; coach-sharing; auto view/handedness detection;
model-assisted trimming; native mobile capture guidance.

---

## Cross-Phase Definition of Done
Every phase: fixtures pass, snapshot tests updated deliberately (never blindly), pipeline
runs green with `AI_PROVIDER=mock`, `ai:smoke` green after prompt changes, progress states
visible in UI, and DECISIONS.md updated for any spec deviation.

## Top Risks & Planned Responses
1. **Club tracking quality** (highest risk) → layered fallbacks in doc 04; product degrades
   to "no trace" gracefully; AI-assist for keyframes; optional YOLO escalation.
2. **Pose on DTL trail-side occlusion** → interpolation + honest confidence + RTMPose
   escalation path (doc 03 §1).
3. **60fps sparsity near impact** → physics-informed splines + blur-streak path segments;
   set user expectation in UI ("impact positions estimated").
4. **Claude Code headless image-read regressions** → pin CLI version; MockProvider keeps
   dev unblocked; Agent SDK/API path exists.
5. **Scope creep in scoring** → scoring bands live in config, ship a modest defensible v1
   rubric, iterate with real user swings.
