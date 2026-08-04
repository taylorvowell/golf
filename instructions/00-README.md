# SwingSage — AI Golf Swing Analysis & Coaching Platform
## Master Development Plan

This folder is the complete strategic and technical plan for building SwingSage end-to-end.
It is written to be handed directly to an AI developer (Claude Code or similar). Read this
file first, then follow the documents in order.

---

## Document Index

| Doc | Purpose | Read before |
|-----|---------|-------------|
| `00-README.md` | This file. Vision, principles, how to use the plan | Everything |
| `01-PRODUCT-SPEC.md` | Full feature spec, user stories, UX flows | Any feature work |
| `02-ARCHITECTURE.md` | Tech stack, system design, data model, API contracts | Any code |
| `03-POSE-TRACKING.md` | Joint/body tracking research + implementation spec (the stick figure) | Phase 2 |
| `04-CLUB-TRACKING.md` | Club head + shaft detection, trace overlay, face angle | Phase 4 |
| `05-SWING-PHASES-AND-SCORING.md` | Swing event detection, metrics, the "Golf Coach" scoring engine | Phase 3 & 5 |
| `06-SIMULATOR-DATA-INGESTION.md` | Parsing simulator stat screenshots + club face / impact images | Phase 6 |
| `07-AI-INTEGRATION-CLAUDE-CODE.md` | AI provider abstraction; using Claude Code locally (no API key) | Phase 1 (scaffold), used everywhere |
| `08-ROADMAP.md` | Development sequence, milestones, acceptance criteria per phase | Before starting; revisit each phase |

---

## Product Vision

SwingSage is an upload-based (not live) golf swing analysis app. A golfer uploads a
60 fps video of their swing (down-the-line "side" view or face-on "front" view) and gets:

1. **Stick-figure body tracking** — every joint marked on every frame (head, neck, shoulders,
   elbows, wrists, spine, hips, knees, ankles/feet), rendered as an overlay on the video.
2. **Frame-by-frame scrubbing** — precise stepping through the swing at 1/60s resolution.
3. **Swing phase segmentation** — automatic detection of the 8 canonical swing events
   (Address → Toe-Up → Mid-Backswing → Top → Mid-Downswing → Impact → Mid-Follow-Through
   → Finish) with the ability to play back any single phase.
4. **Club tracking** — club shaft line and club head marked per frame; a toggleable trace
   overlay showing the club head path (backswing in **red**, downswing in **blue**); club
   shaft angle over time, and best-effort face angle estimation.
5. **The Golf Coach** — an AI scoring engine that grades aspects of the swing (posture,
   rotation, tempo, plane, etc.) from measured joint/club angles, with narrative feedback.
6. **Simulator data ingestion** — upload a photo of a launch monitor / simulator stats screen
   (club speed, ball speed, smash factor, launch, spin, carry...) and a photo of the
   simulator's bird's-eye club-face/impact readout; AI parses both into structured data.
7. **Swing Log** — every swing (video analysis + simulator data) stored as a session entry;
   histories, trends, and improvement tracking over time.

## Non-Negotiable Constraints

- **Uploads only, 60 fps assumed.** No live camera pipeline. Design everything for offline
  batch analysis of an uploaded clip (typically 3–15 seconds).
- **Two view types**: down-the-line (DTL / "side") and face-on ("front"). The user declares
  the view at upload (with auto-detect as a nice-to-have). Metrics differ per view — see
  `05-SWING-PHASES-AND-SCORING.md`.
- **Local development uses Claude Code, NOT an Anthropic API key.** All AI calls go through
  a provider abstraction. Locally, the provider shells out to the developer's installed
  Claude Code CLI in headless mode (`claude -p`), which bills against the developer's own
  Claude subscription. Production later swaps in the real API provider with zero changes to
  calling code. Full details and legal notes in `07-AI-INTEGRATION-CLAUDE-CODE.md`.
- **Deterministic CV first, AI second.** Pose estimation, club detection, phase detection,
  and angle math are done with machine vision (MediaPipe/OpenCV/optional YOLO) — fast, free,
  repeatable. The AI (Claude) is used for: coaching narrative, correction/validation of
  ambiguous CV output, parsing simulator images, and summarizing trends. Never send raw
  video to the AI; send extracted keyframe images + structured JSON.
- **Every analysis artifact is stored as JSON** alongside the video so the UI can re-render
  overlays instantly without re-processing, and so future scoring-model improvements can be
  re-run over historical swings ("re-analyze" button).

## Engineering Principles for the AI Developer

1. **Build vertical slices.** Each roadmap phase ends with something a user can actually do
   in the browser. Do not build all backend services before any UI exists.
2. **Overlay data is frame-indexed JSON.** The contract between analysis backend and the
   player UI is a single `analysis.json` per swing (schema in `02-ARCHITECTURE.md`). The
   frontend never runs CV; it only renders.
3. **Confidence everywhere.** Every keypoint, club detection, event frame, and parsed
   simulator stat carries a confidence score. The UI dims/flags low-confidence data, and the
   AI-correction pass only runs on low-confidence spans.
4. **Test with a fixture library.** Immediately collect 10–20 real swing clips (mixed views,
   lighting, handedness) into `fixtures/`. Every pipeline change runs against them. Add
   golden-output snapshot tests for pose JSON on at least 3 clips.
5. **Handedness matters.** Detect (or let the user set) right/left-handed. All angle logic
   must be mirrored correctly. Store handedness on the user profile as a default.
6. **Keep processing observable.** Analysis runs as a job with stages (decode → pose → club
   → phases → metrics → coach). Emit per-stage progress so the UI can show a meaningful
   progress bar and so failures are diagnosable per stage.

## Suggested Repo Layout

```
swingsage/
├── apps/
│   └── web/                  # Next.js app (UI + API routes + job orchestration)
├── services/
│   └── analyzer/             # Python FastAPI worker: ffmpeg, MediaPipe, OpenCV, club CV
├── packages/
│   └── shared/               # TypeScript types generated from JSON schemas
├── ai/
│   ├── providers/            # claude-code / anthropic-api / mock providers
│   └── prompts/              # versioned prompt templates (coach, ocr, correction)
├── fixtures/                 # test swing videos + golden analysis JSON
├── docs/                     # these planning docs
└── schemas/                  # JSON Schema files: analysis.json, simulator-stats.json, ...
```

## How to Use This Plan

Work through `08-ROADMAP.md` phase by phase. Before writing code for a phase, re-read the
referenced spec doc(s) for that phase. When a spec and reality conflict (a model
underperforms, a library breaks), prefer the spec's *fallback path* — every risky component
in these docs lists a primary approach and at least one fallback. Log deviations in a
`docs/DECISIONS.md` file so the plan stays truthful.
