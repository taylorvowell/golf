# 04 — Club Head & Shaft Tracking

Goal: per frame, the club **shaft line** (2 endpoints: grip-end, head-end) and the **club
head point**; from these, the toggleable **trace** (backswing red, downswing blue), shaft
angle over time, and best-effort face angle.

This is the hardest CV problem in the app. Design for graceful degradation.

---

## 1. Why It's Hard (be realistic)

- The shaft is thin (a few pixels at 720p), often low-contrast (chrome reflects
  sky/grass), and the head is small.
- Speed: a driver head at ~100 mph moves roughly **0.7–0.8 m between frames at 60 fps**
  near impact — that can be 15–30% of the frame width in one step, with severe motion blur
  (the head becomes a translucent streak, the shaft a blurred fan).
- The club crosses in front of/behind the body and legs (occlusion), and in DTL view points
  toward/away from camera at parts of the swing (foreshortening → the shaft is short or
  nearly a point).

Consequences we accept in v1: near-impact head positions will be sparse/estimated; the
trace is smoothed through impact; face angle from video is a rough estimate at best
(the simulator impact image in doc 06 is the authoritative face-angle source — say so in
the UI).

## 2. Approach — Layered Hybrid (classic CV + optional detector + AI assist)

Research basis: the classic and still-effective recipe (Gehrig et al., UCSD project) is
frame differencing to isolate motion → line detection (Hough) for the shaft → pick the
distal endpoint as the head → fit a global trajectory model to per-frame hypotheses.
Modern option: a small fine-tuned object detector (YOLO) for the club head — public
golf-club datasets exist on Roboflow to bootstrap. We combine both, anchored by the pose
skeleton (we know where the hands are — the shaft must start there).

### Layer A — Motion mask
For each frame f: `mask = closing( AND(|f−f₋₁| > τ, |f₊₁−f| > τ) )` (three-frame
differencing ANDed isolates pixels moving *at* time f; morphological closing heals the
thin shaft). The golfer's own moving pixels are removed by subtracting a dilated hull of
the skeleton/person segmentation (MediaPipe provides a segmentation mask — use it).

### Layer B — Shaft as a line
- Restrict search to an annulus around `grip_center` (from pose) with radius up to
  club-length estimate (calibrated at address, see §3).
- Probabilistic Hough transform on the masked edge image → candidate segments.
- Score candidates: (1) proximity of near endpoint to `grip_center`, (2) length plausibility,
  (3) angular continuity with previous frame's shaft (limited angular velocity except
  through impact), (4) collinearity with lead forearm at address/impact-ish frames.
- Winner = shaft line for frame; distal endpoint = head-end hypothesis.

### Layer C — Club head refinement
- Around the shaft's distal endpoint, search a small window for the head blob (largest
  motion-mask blob / highest-gradient cluster). During blur frames, the streak's far tip
  along the streak axis is the head-at-frame-time approximation; also record the streak as
  a path segment (blur is information: it literally paints the path between shutter
  open/close — append streak endpoints to the trace polyline with `blurred: true`).
- Optional (Phase 4b, only if Layer B/C precision is unsatisfying on fixtures): fine-tune
  YOLOv8-nano on ~300–800 labeled frames from our fixtures + a Roboflow golf-club dataset;
  run it per frame as an independent head hypothesis and fuse (detector box center vs.
  line endpoint; take confidence-weighted choice). Keep the classic layer as fallback —
  never detector-only.

### Layer D — Temporal model / trajectory fit
- Track head with a **Kalman filter** (constant-acceleration, high process noise during
  downswing) for gating + gap prediction.
- After the pass, fit smoothing splines to head positions **per swing segment**
  (backswing / downswing / follow-through separately — the path is only piecewise smooth,
  with a sharp reversal at Top). Weight points by confidence, downweight blurred.
- Interpolate small gaps on the spline; mark `interp`. Compute coverage % per segment for
  the quality gate (doc 02).

### Layer E — AI assist (flagged frames only)
Same pattern as pose (doc 03 §4): send ≤10 rendered keyframes (image + our drawn
shaft/head guess) to Claude → JSON corrections `{frame, head:[x,y]} / {frame, shaft:[[x,y],[x,y]]}` →
validate → refit Layer D. Especially useful at Top (club nearly stationary, no motion
mask — see §4) and at address.

## 3. Address Calibration (do this first, it makes everything easier)

At the detected Address span (club is static → motion differencing is useless, which is
fine because everything is static):
- The shaft at address: edge detection + Hough in the region below `grip_center`, biased
  toward the known ball area (lowest strong short line/ellipse near the ground plane, or
  user-tappable "mark your ball" fallback in the UI).
- Record: club pixel length L (grip→head), address shaft angle, ball position, ground line
  (fit through ankles/heels + ball).
These calibrations set the search radii, plausible lengths, and the DTL swing-plane
reference line (ball → through trail shoulder).

## 4. Per-Phase Tracking Notes

- **Address**: static method (§3). Head ~stationary; average over the span.
- **Takeaway/backswing**: easiest segment — moderate speed, minimal blur. Expect ≥90%
  coverage. This makes the **red trace** high quality.
- **Top**: club decelerates to ~0 → motion mask fades. Bridge with Kalman prediction +
  the pose wrists (shaft direction ≈ continues smoothly; at top, DTL foreshortening may
  collapse the shaft — accept a short/absent shaft, keep head via detector/AI assist).
- **Downswing**: fast; rely on blur-streak handling + Kalman + spline. The **blue trace**
  will be sparser; the spline through streak segments still yields a convincing path.
- **Impact ±2 frames**: hardest. Ball-contact frame identified in doc 05 partly *from*
  this pipeline (head reaches ball position). Accept estimated positions.
- **Follow-through**: speed decays; tracking recovers; club often exits frame — stop trace
  at frame exit, no error.

## 5. Trace Overlay Spec

- Data: three polylines (normalized coords) in `analysis.json → club.trace`, segmented by
  events: backswing = Address→Top, downswing = Top→Impact, follow-through = Impact→Finish.
- Rendering: backswing `#E5484D`, downswing `#3B82F6`, follow-through `rgba(59,130,246,.35)`;
  round joins; slight outer glow; draw beneath the skeleton canvas so joints stay readable.
- Modes: (a) full trace while paused/toggled, (b) progressive grow during playback up to
  current frame, (c) "comet" mode (trailing 15-frame window). Default: full when paused,
  grow when playing.
- Also expose `shaft_angle_deg` time series → used for plane analysis (doc 05) and a
  "shaft plane" mini-chart under the player.

## 6. Club Face Angle — Honest Capability Statement

From a single 2D 60fps video, true face angle (open/closed at impact) is **not reliably
measurable** — pros use radar/photometric launch monitors for this. Our tiering:

1. **Authoritative**: parsed from the simulator's bird's-eye impact image / stats screen
   (doc 06). The UI's "Face Angle" field always prefers this source.
2. **Estimated from video (DTL)**: shaft lean + a face-normal proxy from the visible club
   head shape at slow phases (address, takeaway toe-up, top). We report *checkpoint face
   orientation classifications* rather than degrees: e.g., at Toe-Up, classify face as
   square/open/closed by comparing face plane vs. spine tilt (a standard teaching check) —
   this is achievable via the AI assist on 2–3 keyframes with the head crop.
3. **Never** display a fabricated impact face-angle number from video. If only video is
   available, show "Face at impact: requires launch monitor data" + the checkpoint
   classifications from (2).

## 7. Validation Plan

- Fixture labeling: hand-label club head in every 5th frame on 5 clips (a 20-minute job
  with a click-through labeling script — build it). Metrics: head position error (<3% of
  frame height for non-blurred frames), coverage per segment, trace visual QA.
- Golden trace snapshots for 3 fixtures.
- A/B debug page rendering: motion mask, Hough candidates, chosen shaft, Kalman gate,
  final spline — essential for tuning; build it in Phase 4 week 1, not later.
