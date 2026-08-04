# SwingSage — UI Design Brief

A self-contained handoff for a designer who has **no access to this repo**. Everything below
is read from the running code and from a real `analysis.json` on disk (swing1, 2026-08-04) —
not from aspirational specs. Where something is planned but not built, it is labelled.

> **This brief was the input to a redesign that has since shipped.** The player was rebuilt on
> `instructions/template_sample.html`; see **DECISIONS D35**. §3.2 (the two-column layout),
> §4's control inventory and §7's "current visual system" now describe the *previous* UI. §5
> (the data), §6 (the constraints) and §8's list of problems are still current, and D35 says
> which of those problems it addressed and which it did not. The data inventory in §5 remains
> the authoritative description of what the player has to work with.

---

## 1. What the product is

**SwingSage is an upload-based golf swing analyser.** A golfer films a 3–15 second swing on a
phone, uploads it, and a Python computer-vision pipeline returns a frame-by-frame breakdown:
where every joint was, where the club was, which frame was the top of the backswing, which
was impact, and what the body angles measured at each of those checkpoints.

The output is one JSON artifact per swing. The web app's entire job is to **render that
artifact over the video, frame-accurately.** It runs no computer vision itself.

**It is not a live-camera app.** There is no real-time coaching, no camera viewfinder, no
rep counter. Everything is post-hoc review of a clip that already exists. Do not design
capture UI.

### Who uses it

| Persona | Need |
|---|---|
| **The Improver** (primary) | 8–25 handicap amateur. Films at the range or a home simulator. Wants concrete feedback and proof of improvement over time. |
| **The Sim Owner** | Has a launch monitor (Garmin / SkyTrak / Mevo / Trackman). Wants swing video and monitor numbers in one place. |
| **The Coach** (future, v2) | Reviews a student's log and annotates. Don't preclude it; don't design for it yet. |

### Vocabulary the UI should use consistently

- **Swing** — one recorded swing: video + analysis (+ optional simulator data).
- **Session** — a group of swings from one practice. *(not built)*
- **Swing Log** — the full history with trends. *(list exists; trends not built)*
- **Coach Report** — AI scorecard + narrative for a swing. *(not built)*

---

## 2. Reality check — what exists today

Design against this, not against the roadmap. The gap is large.

| Thing | State |
|---|---|
| Video normalisation, pose, events, metrics, club overlay | **Built and working** |
| Swing list page | **Built** — trivial card grid |
| Swing player page | **Built** — this is the real product surface, and where the design effort should go |
| Upload flow | **Not built.** Videos are analysed by running a Python script by hand |
| Job / progress states (`queued → analyzing → ready | failed`) | **Not built.** No DB, no queue |
| Coach report / scorecard / AI narrative | **Not built** |
| Simulator screenshot ingestion | **Not built** |
| Trends dashboard, sessions, filtering, compare | **Not built** |
| Accounts | **Not built.** Single user, local |

There are **2 real swings** in the system. Everything is tuned on two clips.

### Data quality honesty (matters for the design)

- **Pose is excellent** — 94–100 % coverage on every joint that matters. Trust it visually.
- **Club tracking is weak.** Coverage reads 100 % but has overstated real quality three
  separate times. The club is drawn from a *rigid model*: length is fixed at address, only
  the angle changes per frame. It is directionally right and approximately angled. The UI
  currently says so in a caveat paragraph.
- **Face angle at impact is deliberately never shown as a number.** Company policy in the
  spec: 60 fps video cannot resolve the club face at impact — it's a blur streak. The UI must
  say "requires launch monitor" and never fabricate degrees. This is a hard rule.
- **Metric thresholds are provisional.** The payload carries
  `provisional_thresholds: true`. Nothing should be rendered as a pass/fail grade yet.

---

## 3. The screens that exist

### 3.1 Swing log — `/`

A `max-w-4xl` page. Header: "SwingSage" + "Swing log — N analysed swings". Then a 2-column
card grid. Each card:

```
swing1
396 frames @ 60.00fps · DTL
pose 99% · tempo 3.09:1 · trace
rtmw-wholebody-133 (+mediapipe-localiser)
```

Empty state shows a code block telling you to run a Python command. That is the current
"upload flow."

**No thumbnail.** Cards are pure text. Sorted by file modification time. This screen is
essentially unstyled and is wide open for redesign.

### 3.2 Swing player — `/swing/[id]`

The whole product. `max-w-6xl`, two columns on desktop: **video stage + transport** on the
left, a **300 px stack of six panels** on the right. Single column on mobile (panels fall
below the video).

```
┌──────────────────────────────────────┬─────────────────┐
│ ← log   swing1   1080×1920 · 60fps · │  OVERLAYS       │
│ 396 frames · VFR→CFR · DTL · right   │  ☑ Stick figure │
│                                      │  ☑ Confidence…  │
│ ┌──────────────────────────────────┐ │  ☐ Hide <0.5    │
│ │                                  │ │  ☐ Club shaft   │
│ │   VIDEO (9:16 portrait)          │ │  ☐ Club trace   │
│ │   + canvas overlay on top        │ │  ☑ Trace grows  │
│ │                                  │ │  ☐ Ghost pose   │
│ │                                  │ │  ☐ Grip centre  │
│ │                                  │ │  ●left ●right…  │
│ └──────────────────────────────────┘ ├─────────────────┤
│ ┌──────────────────────────────────┐ │  FRAME SYNC     │
│ │ [TOE][MID-B][TOP][MID-D][IMP]... │ │  mean drift 0.0 │
│ │ tempo 3.09:1 · back 1133ms ...   │ ├─────────────────┤
│ │ ═══════════●═══════════════════  │ │  CLUB TRACKING  │
│ │ [Play][‹10][‹1][1›][10›][1×▾]    │ │  back 100% …    │
│ │ frame 221/395 · IMP (conf 0.98)  │ ├─────────────────┤
│ │ 3.683s · shaft -58°              │ │  METRICS AT …   │
│ │ ← → step · shift ×10 · space play│ ├─────────────────┤
│ └──────────────────────────────────┘ │  CLUB FACE      │
│                                      ├─────────────────┤
│                                      │  POSE QUALITY   │
└──────────────────────────────────────┴─────────────────┘
```

The video stage is capped at `min(100%, 72vh × aspect)` so a portrait clip fits the viewport.

---

## 4. Complete control inventory

Every control that exists today. A redesign may reorganise these but should not silently drop
any — each maps to a real capability.

### Transport (below the video)

| Control | Behaviour |
|---|---|
| Scrub bar | `<input type=range>` over frames 0…N-1. Dragging pauses playback and cancels any loop. |
| Play / Pause | Toggles. Label swaps. |
| `‹ 10` `‹ 1` `1 ›` `10 ›` | Frame step. Pauses and cancels loop. |
| Speed select | 0.1× / 0.25× / 0.5× / 1× — **no faster than real time**, this is an analysis tool. |
| Frame readout | `frame 221 / 395`, tabular numerals. |
| Event badge | Appears **only when the current frame is exactly an event frame**: `· IMP (conf 0.98)`. Amber if conf < 0.5, blue otherwise. |
| Time readout | `3.683s` |
| Shaft angle readout | `shaft -58°` when club data exists for this frame. |

### Keyboard

- `←` / `→` — step one frame (with `shift`, ten frames)
- `space` — play/pause
- Hint text is printed under the transport: *"← → step · shift ×10 · space play · click a
  phase to loop it"*

### Phase bar

Seven buttons in a row, `flex-grow` proportional to each phase's frame length, so the bar is
a proportional timeline of the swing. Clicking one **sets a loop over that phase and starts
playback**; clicking the active one clears the loop and pauses. Tooltip gives frames and
seconds.

Each button is labelled with the short code of the phase's **ending** event:
`TOE · MID-B · TOP · MID-D · IMP · MID-F · FIN`.

### Overlay toggles (8 checkboxes)

| Toggle | Default | Draws |
|---|---|---|
| Stick figure | **on** | 21 bones + joint dots, colour-coded by body side |
| Confidence styling | **on** | Bones below 0.5 confidence go dashed `[7,5]`; joint dots go hollow (stroked, not filled) |
| Hide joints below 0.5 | off | Removes low-confidence joints entirely instead of styling them |
| Club shaft + head | **off** | Shaft line, yellow butt dot, rose head circle |
| Club head trace | **off** | The accumulated club-head path |
| Trace grows with playback | on | Trace draws up to the current frame during playback instead of showing the whole path |
| Ghost address pose | off | The address-frame skeleton at 22 % opacity, as a reference |
| Mark grip centre | off | White ring around `grip_center` |

**Note the defaults:** the club shaft and the trace — the two most visually distinctive
features in the product — are both **off by default.** A first-time user sees only a stick
figure. That is almost certainly wrong.

### Canvas stack (fixed order, do not reorder)

`video → ghost pose → club trace → club shaft/head → skeleton → grip marker`

The skeleton draws **last**, over the club, so the body reads on top.

---

## 5. Complete data inventory

One JSON file per swing, served from `GET /api/swings/:id/analysis`. Video is
`GET /api/swings/:id/video` (H.264 MP4 with HTTP Range support — seeking depends on it).

**Size: ~810 KB for a 396-frame clip.** It is currently passed to the client as React props
inside the server-rendered HTML, which is known debt.

All coordinates are **normalised 0–1** (x right, y down) against the video frame, so the
client only ever multiplies by canvas width/height. No other client-side maths.

### Real values from `swing1` (use these as sample data)

```
video      1080×1920 portrait, 60.00 fps, 396 frames
           source: 3840×2160 HEVC, VFR, rotated -90° → normalised to CFR
           view: dtl (down-the-line) · handedness: right
```

### `video`
`fps`, `frame_count`, `width`, `height`, `view` (`dtl` | `face_on`), `handedness`
(`right` | `left`), `source` (original path/codec/rotation/fps/`is_vfr`), `analysis_res`
(the downscaled resolution CV actually consumed — 720×1280).

### `pose`
- `model` — e.g. `rtmw-wholebody-133 (+mediapipe-localiser)`
- `keypoint_names` — **48 names, order is the contract.** Indices 0–32 are the standard
  body landmarks; 33–47 are derived/extra joints appended by our pipeline:
  `neck`, `mid_hip`, `spine_mid`, `head_center`, **`grip_center`**, `left_hand`,
  `right_hand`, `left_middle_mcp`, `right_middle_mcp`, `left_small_toe`, `right_small_toe`,
  `chin`, `nose_bridge`, `jaw_left`, `jaw_right`.
  `grip_center` is the important one — it's where the hands hold the club, measured from real
  knuckles, 100 % coverage at 1.00 confidence.
- `frames[]` — one per video frame: `{ f, kp: [[x, y, conf], …48], st, interp }`.
  `interp: true` means the frame was interpolated rather than measured.

### `events` — the 8 checkpoints
Every event carries a **confidence**. Real values:

| Event | Short | Frame | Conf |
|---|---|---|---|
| address | ADR | 131 | 0.90 |
| toe_up | TOE | 170 | 0.80 |
| mid_backswing | MID-B | 183 | 0.94 |
| top | TOP | 199 | **0.35** |
| mid_downswing | MID-D | 212 | 0.95 |
| impact | IMP | 221 | 0.98 |
| mid_follow_through | MID-F | 242 | 0.80 |
| finish | FIN | 243 | 0.75 |

### `phases`
7 spans between consecutive events: `{ name: "address->toe_up", from: 131, to: 170 }`.
Note the last span here is **1 frame long** (242→243) — real data produces degenerate
segments, so the phase bar must handle them.

### `tempo`
```json
{ "backswing_frames": 68, "downswing_frames": 22,
  "ratio": 3.09, "backswing_ms": 1133, "downswing_ms": 367 }
```
The reference band is 2.5–3.5 : 1; outside it the current UI appends an amber note.

### `club`
- `club_len` 0.2594 (fraction of frame height), `butt_len` 0.0348
- `coverage` — `{ backswing, downswing, followthrough, swing }`, each 0–1
- `trace_enabled` — **false disables the trace toggle**; the quality gate is 50 % coverage
- `notes[]` — free text, e.g. *"backswing plane fitted; 25/69 frames off-plane (median dev
  0.083 club-lengths)"*
- `frames[]` — `{ f, shaft: [[x,y],[x,y]] | null, head: [x,y] | null, butt: [x,y] | null,
  conf, shaft_angle_deg, blurred, interp }`. Below `conf 0.35` the shaft is drawn dashed and
  translucent.
- `trace` — `{ backswing: [[x,y]…], downswing: […], followthrough: […] }`, 69 / 23 / 23 points

### `face` — club-face orientation, never impact degrees
```json
"address": { "class": "toe up / open-ish", "head_to_shaft_deg": -57.5,
             "deviation_deg": 32.5, "conf": 0.81, "n_frames": 1 },
"top":     { "class": "square-ish", "head_to_shaft_deg": 81.5, "conf": 0.61 },
"impact":  { "class": "requires launch monitor", "conf": 0.0,
             "reason": "Face angle at impact is not measurable from 60fps video —
                        the head is a blur streak. Upload a simulator impact image…" }
```
Classifications are fuzzy strings (`"square-ish"`, `"toe up / open-ish"`) by design. **Never
render a fabricated impact number.**

### `metrics`
- `body_height_norm` 0.4588 — sway/lift are expressed in *golfer body-heights*, so they are
  camera-distance independent
- `provisional_thresholds: true`
- **`series[]` — one row per frame, 28 numeric channels, 396 rows. Completely unused by the
  UI today.** This is the biggest untapped data asset. Channels:
  `spine_from_vertical, shoulder_tilt, hip_tilt, xfactor_estimated, left_knee_flex,
  right_knee_flex, lead_wrist_hinge, left_wrist_deviation, right_wrist_deviation,
  lead_arm_angle, lead_arm_in_plane, stance_width_ratio, left_foot_flare, right_foot_flare,
  head_x/y, hip_x/y, grip_x/y, head_sway, head_lift, hip_sway, hip_lift, grip_sway, grip_lift`
- `event_snapshots` — the same channels sampled at each of the 8 events. Real impact values:
  spine from vertical 10.8°, X-factor 35.2°, lead wrist hinge 11.3°, left knee flex 27.3°,
  right knee flex 41.8°, head sway −0.015 bh, hip sway 0.013 bh
- `summary` — `max_head_sway 0.023, max_hip_sway 0.023, spine_at_address 16.0,
  lead_wrist_hinge_at_top 59.2, lead_arm_at_top 115.5, xfactor_estimated_at_top 23.6`
- **`null` means "not measurable in this view", never zero.** `stance_width_ratio` is null in
  DTL and carries a sibling `stance_width_note: "face-on view only"`. This distinction must
  survive the design — "n/a because wrong camera angle" is different from "0".

### `quality` (+ `quality_raw`, `quality_mediapipe`)
`detection_coverage` 1.0, `overall_mean_conf` 0.6924, and `per_joint[name] = { coverage,
mean_conf }` for all 48. The UI currently shows 6 joints as bars, with the MediaPipe result
underlaid in grey as a before/after comparison. This is developer diagnostics, not user value.

### `stage3` — pipeline diagnostics
`side_swaps 7, bone_rejects 4, outlier_rejects 203, interpolated 207`. Pure developer data.

---

## 6. Non-negotiable constraints

These are decided, not open. A design that breaks them cannot ship.

1. **Frame sync is the #1 perceived-quality feature.** Overlay drift while scrubbing is the
   thing users notice first. Video is normalised to constant 60 fps so
   `frame = round(time × fps)` is exact; the player seeks to `(frame + 0.5) / fps` to dodge
   boundary rounding. Any transport redesign must preserve exact frame ↔ time mapping.
2. **The client renders; it never computes.** No CV, no smoothing, no derived geometry in the
   browser beyond multiplying normalised coordinates by canvas size.
3. **Confidence is on everything** — every keypoint, club detection, event and metric. The UI
   must visibly distinguish confident from uncertain data. Current mechanism: dashed lines +
   hollow dots below 0.5. A better mechanism is welcome; removing the distinction is not.
4. **Never fabricate a face angle from video.** See §5.
5. **Quality gates degrade, they don't crash.** Club coverage under 50 % → the swing still
   succeeds, the trace toggle is disabled with a tooltip, and club-dependent numbers read
   "not scored — club not trackable". Design the degraded state, don't assume the happy path.
6. **Handedness matters.** `right` and `left` mirror all the angle language ("lead arm" is the
   left arm for a right-hander). Never hardcode left/right in copy.
7. **View matters.** `dtl` (down-the-line, behind the golfer) and `face_on` expose *different*
   measurable metrics. Some fields are permanently null in one view.
8. **Mobile-first, desktop-great.** Clips are filmed and reviewed on phones; but a bigger
   canvas is genuinely better for analysis, so desktop can't be an afterthought.
9. **Portrait video is the norm.** 1080×1920. Landscape must work but is the minority case.

---

## 7. Current visual system

Everything here is **negotiable except the overlay colours**, which are specified in the
product doc and are load-bearing for how coaches read a trace.

### Locked — overlay colours

| Element | Colour |
|---|---|
| Left side of body | `#22C55E` green |
| Right side of body | `#FACC15` yellow |
| Spine / midline | `#22D3EE` cyan |
| Backswing trace | `#2E9BFF` bright blue — **was** `#E5484D` red, changed deliberately (D34) |
| Downswing trace | `#B44BFF` bright purple — **was** `#3B82F6` blue (D34) |
| Follow-through trace | `rgba(255,255,255,.55)` translucent white, **clipped at the club's high point** so it stops before the club goes over the shoulder (D34) |
| Club shaft | `#F1F5F9` near-white (dashed + 45 % alpha when conf < 0.35) |
| Club butt (grip end) | `#FDE68A` |
| Club head | `#FB7185` rose ring |

**These are no longer the doc 04 §5 palette.** Red-back / blue-down is the golf-instruction
convention and it was abandoned deliberately for blue-back / purple-down / white-through, with
the glow removed and a tapered variable-width stroke in place of the flat line. The cost — a
coach not getting the pairing they expect — was accepted knowingly; see DECISIONS D34. What
follows describes the superseded scheme.

Red-back / blue-down is a golf-instruction convention. Traces carry a 6 px glow of their own
colour so they read over both grass and sky.

### Negotiable — chrome

Tailwind, dark only. Page `#0b0d10`. Panels `bg-neutral-900/60` with `border-neutral-800`,
`rounded-xl`, 12 px padding. Panel titles are 11 px uppercase `tracking-wider`
`text-neutral-500`. Body copy is 12 px `text-neutral-400` with values bumped to
`text-neutral-100`. Accent is `blue-500/600`; warnings are `amber-400`. Quality bars use
green `#22C55E` > 90 %, yellow `#FACC15` > 50 %, red `#E5484D` below.

**Two real defects worth fixing in the redesign:**
- `globals.css` defines light/dark CSS variables and a `--font-geist-sans` token, but the
  layout hardcodes the dark background and **never loads a font** — so the entire app
  currently renders in **Arial**. There is no typographic system at all.
- The light-mode variables are dead code. Decide deliberately: dark-only (defensible — you're
  looking at video) or a real dual theme.

---

## 8. Known problems, roughly ranked

Things a redesign should address. These are observations from the code and real output, not
guesses.

1. **No visual hierarchy.** Six panels of identical weight in a 300 px column: overlay
   toggles, sync diagnostics, club caveats, metrics, face, pose quality. A golfer and a
   developer are being served the same screen. The developer diagnostics (Frame sync,
   Pose quality, and the MediaPipe comparison bars) should probably live behind a "debug"
   affordance.
2. **The best features are off by default.** Club shaft and trace both start hidden. The
   red-back/blue-down trace is the single most compelling image the product can produce, and
   a new user never sees it.
3. **`metrics.series` is 396 × 28 channels of per-frame data and nothing renders it.** No
   charts anywhere. An angle-over-time strip aligned to the scrub bar, with event markers, is
   the obvious win — spine angle, wrist hinge, and X-factor across the swing tell the story
   the numbers panel can only sample.
4. **The metrics panel samples one event and shows 8 of 29 fields.** It picks the *nearest*
   event to the current frame and labels it `nearest event: impact (±3f)`. Reasonable idea,
   opaque execution.
5. **Event confidence is nearly invisible.** `top` has confidence 0.35 in the real fixture —
   the least reliable event in the swing — and the UI only reveals that if you land on
   exactly frame 199. Low-confidence events should be visible on the phase bar itself.
6. **Phase bar labelling is confusing.** Each segment is named after the event it *ends* at,
   so the segment from address to toe-up is labelled "TOE". Segments are also proportionally
   sized, which makes real 1–3 frame phases (mid-follow-through → finish) into unreadable
   slivers.
7. **No thumbnails anywhere.** The log is a text list. The pipeline already writes a
   `contact.jpg` and could easily emit event keyframes.
8. **No annotation tools.** The spec asks for draggable reference lines, a swing-plane line,
   and angle readouts pinned to joints. None exist.
9. **No compare mode.** The spec wants two swings synced at address and impact.
10. **Every caveat is a paragraph of grey text.** "Direction is correct at all checkpoints,
    but angle accuracy through the fast downswing is still approximate (DECISIONS D12/D14)"
    is developer prose in the user's face. The honesty is required; this format isn't.

---

## 9. Screens that need designing but don't exist

If the brief should cover the whole product rather than just the player:

- **Upload** — file picker, then required metadata: view (DTL / face-on), club, handedness,
  optional session and notes. Plus an auto-trim confirmation step (the pipeline detects the
  motion burst and proposes a trim; the user confirms).
- **Analysis progress** — 9 named pipeline stages, each reporting a percentage and a message,
  taking roughly 30–60 s total. States: `uploaded → queued → analyzing → ready | failed`.
  Failure must be diagnosable per stage and user-readable ("we couldn't find you in the
  frame" + filming tips, not a stack trace).
- **Coach report** — scorecard of ~8 categories (Setup, Backswing, Top, Transition/Tempo,
  Downswing/Plane, Impact, Follow-Through, Balance), each 0–100 plus a letter grade. Each
  grade expands to: measured value, target range, keyframe thumbnails that jump the player to
  that frame, and a plain-English explanation. Plus a 3–6 sentence AI narrative, the top 2
  priority fixes, and one drill.
- **Simulator ingestion** — photograph a launch monitor screen → AI parses club speed, ball
  speed, smash factor, launch angle, spin, carry, total, club path, face angle, angle of
  attack → a review screen showing parsed values beside the source image with per-field
  confidence, every field user-correctable. Unparsed fields stay null; never guessed.
- **Trends** — line charts over time for score, per-category scores, club speed, carry, tempo
  ratio; filterable by club; a personal-bests panel; compare any two swings.
- **Session grouping and filtering** for the log.

---

## 10. What a great redesign would deliver

In priority order:

1. A player where a golfer immediately sees their **club trace over their swing** and can
   loop the top-to-impact move — without touching a settings panel.
2. A clear split between **golfer-facing insight** and **engineer-facing diagnostics**.
3. A **typographic and spacing system** (there is genuinely none today).
4. Per-frame metric **charts** wired to the scrub position, using `metrics.series`.
5. A confidence language that is honest but not anxious — the product must show uncertainty
   on every number without making the whole screen look broken.
6. A **mobile layout that is actually designed**, not the desktop grid collapsed to one
   column.
