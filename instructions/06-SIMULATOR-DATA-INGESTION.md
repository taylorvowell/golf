# 06 — Simulator / Launch Monitor Data Ingestion

Two upload types, one pattern: **image → AI vision parse → confidence-scored JSON →
user review/correct → attach to swing → feed trends.**

Traditional OCR (Tesseract) is the wrong tool here: monitor screens vary wildly in layout,
fonts, units, and labels (Trackman vs. Garmin R10 vs. SkyTrak vs. Mevo+ vs. Uneekor vs.
GSPro overlays). A vision LLM (Claude) reads them like a human. This flow is inherently
AI-powered — locally it runs through Claude Code (doc 07).

## 1. Stats Screen Parsing

### Schema (`schemas/simulator-stats.schema.json`)
```jsonc
{
  "device_guess": "garmin_r10 | trackman | skytrak | mevo | uneekor | gspro | unknown",
  "units": {"speed":"mph|kmh|ms", "distance":"yd|m", "spin":"rpm"},
  "shot": {
    "club_speed": {"value": 98.2, "conf": 0.95},
    "ball_speed": {"value": 142.1, "conf": 0.95},
    "smash_factor": {"value": 1.45, "conf": 0.9},
    "launch_angle_deg": {"value": 13.8, "conf": 0.9},
    "launch_direction_deg": {"value": -1.2, "conf": 0.8},
    "spin_rate_rpm": {"value": 2650, "conf": 0.9},
    "spin_axis_deg": {"value": 4.1, "conf": 0.8},
    "apex": {"value": 31, "conf": 0.85},
    "carry": {"value": 245, "conf": 0.95},
    "total": {"value": 262, "conf": 0.9},
    "offline": {"value": 8, "conf": 0.8},
    "club_path_deg": {"value": 2.3, "conf": 0.8},
    "face_angle_deg": {"value": 1.1, "conf": 0.8},
    "face_to_path_deg": {"value": -1.2, "conf": 0.75},
    "attack_angle_deg": {"value": -3.1, "conf": 0.8},
    "dynamic_loft_deg": {"value": 16.4, "conf": 0.7}
  },
  "club_label_on_screen": "7 Iron | Driver | null",
  "multiple_shots_detected": false,
  "notes": "free text: anything ambiguous"
}
```
All fields nullable. **Prompt rules**: transcribe only what is visibly on screen; never
infer or compute values not shown (exception: smash may be computed only if both speeds
are read at conf ≥0.9, marked `derived:true`); include units exactly as displayed;
if the screen shows a table of multiple shots, set `multiple_shots_detected` and parse
either the highlighted row or return an array (v1: parse highlighted/most-prominent, tell
user).

### Validation layer (code, after parse)
Range sanity per field & club class (e.g., club speed 40–140 mph; smash ≤ 1.56 for driver
flag >1.52 as suspicious; smash ≈ ball/club within 3% else flag both). Cross-field checks
downgrade confidence rather than reject. Values failing hard ranges → shown as "check
this" in review UI.

### Review UI
Image left (pinch-zoom), fields right, low-confidence highlighted amber, hard-flag red.
Every correction saved to `corrected` (parsed kept immutable). Attach to a swing (default:
most recent swing today with matching club) or save standalone.

## 2. Club Face / Impact Image Parsing (bird's-eye readout)

Simulators render a top-down graphic of club-vs-ball at impact: club path arrow, face
angle line, impact point on the face, sometimes numbers on the graphic.

Schema (`schemas/impact-image.schema.json`):
```jsonc
{
  "face_angle_deg": {"value": 1.5, "open_closed": "open", "conf": 0.85},
  "club_path_deg": {"value": 3.0, "in_to_out": true, "conf": 0.85},
  "face_to_path_deg": {"value": -1.5, "conf": 0.8},
  "impact_location": {"horizontal": "center|toe|heel", "vertical": "center|high|low",
                       "offset_mm_estimate": null, "conf": 0.7},
  "numbers_visible_on_graphic": true,
  "notes": ""
}
```
Prompt rules: prefer printed numbers over interpreting the graphic geometry; if only the
graphic exists, classify direction (open/closed, in-to-out/out-to-in) and give a coarse
magnitude bucket (slight <2°, moderate 2–5°, severe >5°) with lower confidence; always
state sign convention (positive = open / in-to-out for a right-handed golfer, mirror for
left — pass user handedness into the prompt).

**This parsed face angle is the authoritative face-angle source for the swing record**
(video-based face estimation is checkpoint-classification only — doc 04 §6).

## 3. Unified Swing Record

A complete logged swing = video analysis (docs 03–05) + simulator stats + impact parse +
user notes. The swing detail page composes all of it; the Coach's narrative prompt (doc 05
C2) receives simulator numbers when present ("ball data says face 1.1° open with path
2.3° in-to-out — matches the slight draw setup we see at address...") which makes the
coaching dramatically better. Trends read from any source field.

## 4. Testing
Fixture folder of ~15 real monitor screenshots across ≥4 device brands (grab from own sim
+ friends + public forum images for dev only). Golden parses reviewed by hand once, then
snapshot-tested. Track field-level accuracy; require ≥95% exact on clearly-legible numeric
fields before shipping the flow.
