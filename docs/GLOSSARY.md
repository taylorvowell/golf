# Glossary — coaching term → measured field

One vocabulary for the analyzer, the player UI and the AI coach narrative. If a term is not
in this file it should not appear in user-facing text; if a field is not in this file it is
geometry, not coaching language.

Every mapping here is a *naming* layer over `analysis.json`. Nothing in
`metrics.glossary` is computed twice — it points at numbers the pipeline already produced.

---

## 1. Sides: lead and trail

**Lead** is the side of the body **closest to the target**. **Trail** is the side furthest
from it. For a right-handed golfer, lead = left, trail = right; for a left-handed golfer it
inverts.

Lead/trail is decided by **handedness**, never by which side faces the camera. The two agree
for a right-handed golfer filmed down the line from behind — the trail arm and leg are nearer
the lens — but that is a property of that one camera setup. It inverts for a left-handed
golfer and means nothing at all face-on. Anything keyed off camera-nearness is silently wrong
for half of all golfers.

| Layer | Vocabulary | Why |
|---|---|---|
| Keypoints (`pose.keypoint_names`) | **anatomical** — `left_wrist`, `right_heel` | Model output and a fixed published contract |
| Metrics (`metrics.series`, `event_snapshots`) | **lead / trail** — `lead_knee_flex` | The coaching layer, where side has meaning |
| UI labels, coach narrative | **lead / trail** | What a golfer is told |

`metrics.sides` restates the resolved mapping (`{handedness, lead, trail}`) so no consumer
has to re-derive it and risk disagreeing with the series keys.

Side-keyed metrics: `lead|trail_` + `knee_flex`, `wrist_deviation`, `forearm_roll`,
`forearm_roll_delta`, `foot_flare`, `heel_lift`, `ankle_lean`, `foot_width_ratio`.

## 2. Facing: anterior and posterior

A golfer finishes with the face and chest turned to the target, so **the side of the body
presented to the camera inverts during every swing**. `body_facing` states which, per frame:

- **`anterior`** — front of the body toward the camera.
- **`posterior`** — back of the body toward the camera.

Down the line, the camera sits behind the golfer looking along the target line, so the
expected pattern is: back toward camera at address, chest toward camera near the top (the
trail-side turn brings it round), and back toward camera again at the finish as the body
turns through to the target.

`facing_conf` (0–1) is essential to read alongside it. Facing is derived from the left/right
ordering of the shoulders in the image, which is **degenerate when the shoulders are
edge-on** — precisely at address and impact. Measured on swing2: `facing_conf` 0.46 at
address, **1.0** at the top, **0.05** at impact, 1.0 at the finish. Below 0.5, treat
`body_facing` as "cannot tell", not as a fact. `facing_agrees_hips` corroborates — the hips
turn later than the shoulders, so agreement is real evidence rather than a restatement.

---

## 3. Setup and posture

| Term | Field | Notes |
|---|---|---|
| **Address** | `glossary.address_frame`, `address_span` | The event is the *last* frame of the quasi-static hold; `address_span` is the whole hold. Setup numbers are medians over it (D28). |
| **Spine Angle** | `glossary.spine_angle` | Forward tilt of the upper body from the hips at address, degrees from vertical. |
| **Primary Tilt** | `glossary.primary_tilt` | Forward bend from the hips seen from the side. **Down-the-line only** — `null` face-on. Same measurement as spine angle. |
| **Secondary Tilt** | `glossary.secondary_tilt` | Side bend of the spine away from the target at setup. **Face-on only** — `null` down the line. |
| **Stance** | `glossary.stance` | Foot width as a ratio of shoulder width. **Face-on only**: down the line the camera looks along the stance so both ankles foreshorten onto each other. |
| **C-Posture** | `glossary.posture_type` = `"C-posture"` | Rounded, slouched upper back. Positive `posture_value`. |
| **S-Posture** | `glossary.posture_type` = `"S-posture"` | Excessive lower-back arch. Negative `posture_value`. |

**Read `glossary.posture_note` before using posture for anything.** C- and S-posture are
opposite signs of a single curvature number (`spine_curvature`, the sagitta of the
hip→shoulders→head chain). Three limits, all real:

1. **One number, not a spine profile.** Four trunk keypoints cannot separate thoracic
   rounding from lumbar flexion, so the C/S label is a direction, not a diagnosis.
2. **Down-the-line only** — the sagittal plane has to lie in the image.
3. **The scale is unvalidated.** swing1 reads 0.096 and swing2 0.021, which separates two
   setups cleanly, but nothing anchors what counts as rounded. The neutral band (±0.03) is a
   placeholder, not a tuned rubric, and belongs in `scoring_config.json` once some clips have
   a known verdict behind them. See DECISIONS D27.

## 4. Swing mechanics

| Term | Field | Notes |
|---|---|---|
| **Takeaway** | `glossary.takeaway_frames` | `[address, toe_up]` — the first backward movement. |
| **Coil** | `glossary.coil_at_top` | Upper torso wound over the lower body. Same quantity as X-factor; `xfactor_rotation_est` per frame. |
| **Transition** | `glossary.transition_frames` | `[top, mid_downswing]` — the change of direction. |
| **Tempo** | `glossary.tempo` | Backswing:downswing frame ratio, plus both in ms. |
| **Early Extension** | `glossary.early_extension` | Pelvis thrusting toward the ball in the downswing; largest hip excursion between top and impact, in body heights. **Use the magnitude** — the sign is unresolved because which direction is "toward the ball" depends on the camera side, which the pipeline does not record. Down-the-line only. |
| **Swing Plane** | `club.notes` | Fitted per phase in `club.py`, not duplicated into metrics. |

### Rotation: what the sign means

`shoulder_turn_from_address` and `hip_turn_from_address` are magnitudes derived from how far
each body line's projected width has collapsed — `arccos` is even, so a line turned 40° one
way and 40° the other project identically.

`shoulder_facing_signed` / `hip_facing_signed` add the direction, using `body_facing` to
resolve it, and are **`null` wherever `facing_conf` < 0.5**. That is deliberate: the
ambiguity is worst exactly where the shoulders are edge-on, and an absent sign is better than
a wrong one.

Two X-factor fields exist and they are not interchangeable:

- `xfactor_rotation_est` — from projected widths. Has a geometric basis. **Prefer this.**
- `xfactor_estimated` — subtraction of two image-plane tilts. Kept for continuity; it read
  70.8° at impact on swing2 where the width-based figure read 15.9°.

Both are unstable across clips (swing2 gave 22.5° at the top, swing1 gave 0.8°), so neither
is ready to be scored.

## 5. Head

| Term | Field | Notes |
|---|---|---|
| Head sway / lift | `head_sway`, `head_lift` | Off `head_center`, the **ear midpoint** — which redefines itself to a single ear when one drops out (D25). |
| Head sway / lift, stable anchor | `face_sway`, `face_lift` | Off `nose_bridge`, a single observed point. **Prefer this.** On swing1 `head_center` holds 23.7% coverage against `nose_bridge` at 100%. |
| Head turn | `head_turn`, `head_turn_delta` | Rotation, so it can be told apart from translation. A signed −1..1 jaw asymmetry, **deliberately not degrees** — converting it to an angle needs camera intrinsics the pipeline does not have. |

## 6. The ten checkpoints (P1–P10)

The eight events in `analysis.json.events` are the GolfDB contract and never change.
`analysis.json.checkpoints` is the same swing indexed the way a coach talks about it — ten
positions, the eight events plus two GolfDB does not label.

| P | id (`checkpoints[].id`) | Position | Defined by | From |
|---|---|---|---|---|
| P1 | `address` | Address | setup | `events.address` |
| P2 | `backswing_bottom` | Backswing — bottom | shaft parallel to the ground, takeaway | `events.toe_up` |
| P3 | `backswing_middle` | Backswing — middle | lead arm parallel to the ground | `events.mid_backswing` |
| P4 | `backswing_top` | Backswing — top | highest grip before the change of direction | `events.top` |
| P5 | `downswing_top` | Downswing — top | lead arm parallel to the ground, coming down | `events.mid_downswing` |
| P6 | `downswing_middle` | Downswing — middle | shaft parallel to the ground, coming down (delivery) | **detected in `checkpoints.py`** |
| P7 | `impact` | Impact | impact | `events.impact` |
| P8 | `follow_through_middle` | Follow-through — middle | shaft parallel to the ground after impact | `events.mid_follow_through` |
| P9 | `follow_through_top` | Follow-through — top | trail arm parallel to the ground | **detected in `checkpoints.py`** |
| P10 | `finish` | Finish | motion decayed, hands high | `events.finish` |

The pattern is symmetric, which is what makes P6 and P9 detectable rather than invented:
P2/P8 are the shaft horizontal either side of the ball, P3/P5 the lead arm horizontal either
side of the top, and P6/P9 close it — shaft horizontal coming down, trail arm horizontal
going up.

**Read `basis` before trusting a frame.** Every checkpoint says in words how it was decided:
`shaft horizontal (tracked)` is the real criterion, `proxy: …` is a stand-in, and the
confidence follows. On swing1 the tracked shaft never reads horizontal between P5 and impact,
so P6 falls back to hand height at confidence 0.5; on swing2 the real criterion fires at 0.8.
Both are in the data rather than hidden behind an averaged number (DECISIONS D31).

Angles at each position live in `metrics.checkpoints[]`, with `values` (the angles) and
`delta_from_address` (the change from P1). **P1's angles are medians over the whole address
hold**, not that one frame — it is the reference every delta is measured against, so it is
the one place a single frame's jitter would contaminate the whole table (D28).

## 7. Angles

`metrics.angle_fields` is the catalogue as data: field, label, the view it means what its
name says in, whether a delta from address is the usable form, whether it is setup-only, and
`geom` — where the angle lives on the body. Both the analyzer's table and the player's read
that list rather than repeating it, so they cannot disagree.

**Angles are selectable.** Click an angle's name in the player's checkpoint table and it is
drawn over the video: a vertex, two rays, an arc, and a label that updates as you scrub. Up
to four at once, each in its own colour. The label is read straight from
`metrics.series[frame][field]` — nothing is recomputed in the browser, so the arc and the
number are the same measurement. Three fields cannot be drawn and their rows are disabled:
`shoulder_turn_from_address`, `hip_turn_from_address` and `xfactor_rotation_est` come from
projected body widths rather than from any two bones. `scripts/checkangles.py` verifies that
every drawn arc equals its published value, on every frame (D33).

Three shapes of angle, and the convention differs by shape:

| Shape | Convention | Fields |
|---|---|---|
| **Interior joint angle** | `_flex`: 0° = straight limb. `_hinge`: the interior angle itself, so 180° = in line. | `lead\|trail_` + `knee_flex`, `elbow_flex`, `hip_hinge`; `neck_angle` |
| **From vertical** | Signed; 0° = plumb. **The sign flips with which side of the golfer the camera sits on** — read the magnitude and the change. | `spine_from_vertical`, `lead\|trail_shin_from_vertical`, `lead\|trail_arm_hang`, `head_pitch`, `shaft_from_vertical` |
| **Stack angle** | **90° = stacked.** The angle a plumb line from that point of the foot would make. `_signed` variants are positive toward the ball. | `chin\|shoulders\|hips` + `_over_ball_of_foot_deg`, `_over_midfoot_deg` |

### What each angle is, and what a good one looks like

Reference bands below are **documentation, not a rubric** — they are the coaching
conventions the scoring spec cites, not thresholds tuned on our fixtures. Nothing in the code reads
them; when they become scoring inputs they move to `scoring_config.json` with a version.

**Setup (read at P1).**

| Angle | Field | What it is | Conventional band |
|---|---|---|---|
| Spine angle | `spine_from_vertical` | Forward tilt of the torso from the hips. DTL. | 30–45° from vertical |
| Hip hinge ("leg to back") | `lead\|trail_hip_hinge` | Interior angle at the hip between the torso and the femur. What separates a golf posture from a squat: the same knee flex with a different hinge is a different setup. DTL. | — |
| Knee flex | `lead\|trail_knee_flex` | Hip–knee–ankle, 0° = straight. | 15–25° |
| Shin angle | `lead\|trail_shin_from_vertical` | Ankle→knee from plumb. Tells apart knee flex from the knee travelling forward over the foot, which the knee angle alone cannot. | — |
| Neck angle | `neck_angle` | Interior angle at the neck between the torso and the head. 180° = head carried in line with the spine; less = chin toward the chest, which restricts the lead shoulder turning under it. | — |
| Head pitch | `head_pitch` | The face axis (chin→nose bridge) from vertical. Rotation of the skull, blind to the golfer translating. DTL. | — |
| Arm hang | `lead\|trail_arm_hang` | Wrist→shoulder from plumb. 0° = hands hanging directly under the shoulder socket. **Setup only** — at the top this reads 140° and means nothing. DTL. | near 0° |
| Chin stack | `chin_over_ball_of_foot_deg` | How far the chin sits off a plumb line through the ball of the foot. **90° = stacked.** `chin_over_midfoot_deg` is the same line drawn from mid-foot; a disagreement between the two says which way the chin sits along the foot. DTL. | 90° |
| Shoulder / hip stack | `shoulders\|hips_over_ball_of_foot_deg` | The other two lines a coach draws on a down-the-line still. A textbook setup reads chin slightly forward, shoulders near 90°, hips back over the heels. | — |
| Shoulder tilt | `shoulder_tilt` | Shoulder-line angle in the image. **Face-on only** — down the line the shoulders are edge-on and this wraps wildly. | trail shoulder lower |
| Stance width | `glossary.stance` | Ankles / shoulders (a ratio, not an angle). Face-on only. | 1.0–1.4× |

**Through the swing.**

| Angle | Field | What it is |
|---|---|---|
| Lead wrist hinge | `lead_wrist_hinge` | Lead forearm against the **club shaft** — the lag/casting signal. Needs club data. |
| Wrist cup / bow | `lead\|trail_wrist_deviation` | Hand against the forearm along the third metacarpal. **180° = straight**, not 0 — an older convention this field keeps. |
| Elbow flex | `lead\|trail_elbow_flex` | Lead arm straight through the backswing, trail elbow folded near 90° at the top, are two of the scoring spec's checks. **Read with `lead\|trail_arm_in_plane`** (below). |
| Shoulder / hip turn, X-factor | `shoulder\|hip_turn_from_address`, `xfactor_rotation_est` | See §4 — magnitudes, already measured from address. |
| Shaft angle | `shaft_from_vertical` | Grip→head off the downward plumb: 0° = head hanging directly below the hands, ±180° = head above them. Face-on this is shaft lean; **down the line lean points at the lens and is invisible**, and what is left is the in-plane angle. `shaft_plane` says which. Aspect-corrected, unlike `club.frames[].shaft_angle_deg`. |
| Spine retention | `summary.spine_change_at_impact` | How much of the setup spine angle survived to impact. Losing it is standing up; gaining it is diving. |
| Ankle lean | `lead\|trail_ankle_lean` | Fore/aft down the line, roll face-on. A neutral foot already reads ~40°, so only the change from address is portable. |

### The projection caveat, and the field that measures it

Every angle here is a 2D projection. A limb swinging out of the image plane foreshortens and
its joint reads **straighter or more folded than it is**. This is not hypothetical: on swing2
the trail elbow reads 172° of flex at P3 — anatomically impossible, and exactly where the
trail arm points down the barrel of a down-the-line camera.

`lead_arm_in_plane` / `trail_arm_in_plane` (0–1) is how much of that arm's length survived
projection. Near 1.0 the arm lies in the image plane and its elbow angle is trustworthy; the
172° reading carries 0.35. **Read the elbow angles with it.** The same caveat applies to hip
hinge through the swing, where the torso and femur can project onto each other near the top
(swing2 reads 179.8° at P4) — the hinge is solid at address and at impact, and projection-
confounded at the top.

### Which way the ball lies

`glossary.ball_direction` resolves the one thing several signed measurements need: which
image direction the ball is in. It is observed, not configured — at address the golfer bends
from the hips and the hands hang out over the ball, so the sign of the grip-to-hip horizontal
offset **is** the ball direction. Measured over the whole address hold: +0.212 body heights on
swing1, +0.255 on swing2, both at confidence 1.0.

It is **down-the-line only** and `null` face-on, where the hands sit near the body's centre
line and the offset that survives is lead/trail, not toward/away. Two things read it:

- `early_extension` — now signed, positive = pelvis moved toward the ball. Previously
  published as a magnitude with the direction stated as unresolved.
- `chin|shoulders|hips_over_*_signed` — 0 = stacked, positive = that point sits toward the
  ball (over the toes), negative = back over the heels.

Where `ball_direction` is null both stay null rather than guessing a sign, the same rule
`shoulder_facing_signed` follows.

## 8. Terms that are deliberately absent

- **Face angle in degrees from video.** The club-tracking spec reserves that for the simulator impact
  image. Video gives checkpoint classifications (square / open / closed) and
  `lead_forearm_roll_delta`, which is the body-measured half of the same story.
- **Any 3D angle.** Everything here is a single-view 2D projection. Fields whose reading
  depends on the view say so and return `null` in the wrong one, rather than reporting a
  number that looks valid.
