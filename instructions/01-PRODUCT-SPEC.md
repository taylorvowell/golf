# 01 — Product Specification

## Personas

- **The Improver** (primary): amateur golfer, 8–25 handicap, films swings at the range or on
  a home simulator, wants concrete feedback and proof of improvement.
- **The Sim Owner**: has a launch monitor (Garmin, SkyTrak, Mevo, Trackman, Uneekor, etc.),
  wants swing video + monitor numbers unified in one log.
- **The Coach (future)**: reviews students' swing logs, annotates. Out of scope for v1 but
  don't design the data model in a way that precludes multi-user sharing later.

## Core Objects (user-facing vocabulary)

- **Swing** — one recorded swing: a video + its analysis (+ optional simulator data).
- **Session** — a group of swings from one practice (same day/location/club, user-managed).
- **Swing Log** — the full history of swings/sessions with trends.
- **Coach Report** — the AI-generated scorecard + narrative for a swing.

---

## Feature Areas

### F1. Video Upload & Management
- Upload MP4/MOV (H.264/HEVC), target ≤ 30s duration, 60 fps assumed (transcode/normalize
  anything else to a canonical 60 fps, 720p–1080p, H.264 MP4 via ffmpeg; if source is
  30 fps, analyze at 30 and record true fps — never fake frames).
- At upload the user selects: **view** (Down-the-Line or Face-On), **club used** (driver,
  irons by number, wedge, etc.), optional session assignment, optional notes.
- Auto-trim assist: detect the swing window (motion burst) and suggest trimming dead time
  before address / after finish; user confirms. Store both original and trimmed.
- Upload states: `uploaded → queued → analyzing (staged progress) → ready | failed`.

### F2. Swing Player (the heart of the app)
- Video player with **frame-accurate scrubbing**: ←/→ step exactly one frame; scrub bar with
  frame ticks; current frame number + timestamp readout; playback speeds 0.1×–1×.
- **Overlay system** (all individually toggleable, rendered on a canvas above the video):
  - Stick figure (joints + bones), color-coded left/right side.
  - Club shaft line + club head marker.
  - **Club head trace**: accumulated path — backswing segment **red**, downswing segment
    **blue** (follow-through optional third color, e.g. faded blue). Toggle on/off.
  - Angle readouts pinned to joints (e.g. spine angle, knee flex) — choose which via a panel.
  - Reference guides: vertical/horizontal grid, draggable user lines, "swing plane" line
    drawn at address from ball through trail shoulder (DTL view).
- **Phase bar**: a segmented timeline showing the 8 detected swing events/phases. Click a
  phase to loop just that phase. Click an event marker to jump to its exact frame.
- Side-by-side compare mode (v1.5): two swings synced by phase (align at Address and Impact).

### F3. Swing Analysis (automatic, on upload)
Pipeline stages (details in docs 03–05):
1. Normalize video, extract frames.
2. Pose estimation → per-frame joints.
3. Club detection → per-frame shaft line + head point.
4. Swing event detection → 8 event frames.
5. Metric computation → angles/positions/tempo per event and over time.
6. Coach scoring → grades + narrative via AI.

### F4. The Golf Coach (scoring)
- Scorecard of graded categories (0–100 + letter), e.g. Setup, Backswing, Top Position,
  Transition/Tempo, Downswing/Plane, Impact, Follow-Through, Balance. Category set differs
  by view (see doc 05).
- Each grade expands to show: the measured values, the target range, the frame(s) evidence
  (thumbnail links that jump the player to that frame), and a plain-English explanation.
- Overall swing score = weighted composite; weights documented and versioned
  (`scoring_model_version` stored on every report so old reports remain reproducible).
- AI narrative: 3–6 sentence summary + top 2 priority fixes + 1 drill suggestion.

### F5. Simulator Stats Ingestion
- Upload a photo/screenshot of a launch monitor results screen. AI vision parses into
  structured fields: club speed, ball speed, smash factor, launch angle, spin rate, spin
  axis, apex, carry, total, side/offline, club path, face angle, angle of attack, dynamic
  loft (whatever is present — schema in doc 06). Unparsed fields left null, never guessed.
- Review screen: parsed values shown next to the image with per-field confidence; user can
  correct any field before saving. Corrections are stored (future: few-shot improvement).
- Attach parsed stats to a Swing (or log as a stats-only entry with club + date).

### F6. Club Face / Impact Image Ingestion
- Upload the simulator's bird's-eye club-face graphic (face angle, path, impact location on
  face). Same parse → review → attach flow. Fields in doc 06.

### F7. Swing Log & Trends
- History list: filter by date range, club, view, session; each row shows thumbnail, date,
  club, overall score, key stats (club speed, carry if present).
- Swing detail page: player + coach report + simulator data + notes, all in one place.
- Trends dashboard: line charts over time for overall score, per-category scores, club
  speed, carry, tempo ratio, and any parsed stat — filterable by club. "Personal bests"
  panel. Compare any two swings.
- Export: swing entry as JSON; log as CSV.

### F8. Accounts & Settings (minimal v1)
- Single-user local-first is fine for v1 (SQLite). Auth (email magic link) in v1.5.
- Profile: handedness, height (used to sanity-scale pose), default club set.

---

## Key User Stories (acceptance-level)

1. *As a golfer, I upload a DTL swing video and within ~60s I can scrub it frame by frame
   with a stick figure and club overlay that visibly sticks to my body/club.*
2. *I toggle the trace and see my club head path: red going back, blue coming down, and I
   can screenshot it.*
3. *I tap "Top" on the phase bar and the video loops just my backswing-to-top move.*
4. *I read my Coach Report, tap the "early extension" finding, and the player jumps to the
   exact frame showing my hips moving toward the ball.*
5. *I snap a photo of my simulator screen; the app fills in club speed 98.2, ball speed
   142.1, etc.; I fix one misread digit and save it to today's swing.*
6. *After 6 range sessions I open Trends and see my overall score and shoulder turn
   improving, filtered to 7-iron only.*

## UX Notes
- Mobile-first layouts (videos are filmed on phones), but the player must also be great on
  desktop (bigger canvas = better analysis).
- Overlay rendering must stay locked to the video during scrubbing — this is the #1
  perceived-quality feature. See `02-ARCHITECTURE.md` → Frame Sync.
- Colors: joints/bones in high-contrast green/yellow; low-confidence joints rendered hollow
  or dashed. Trace: backswing `#E5484D` (red), downswing `#3B82F6` (blue), 2.5px, with a
  subtle glow so it reads over grass and sky.
