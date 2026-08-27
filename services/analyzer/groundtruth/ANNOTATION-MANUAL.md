# SwingSage Annotation Manual

The definitions in this file are **frozen**: labels produced under them are only comparable to
each other while these definitions stand. Changing a definition bumps the relevant schema's
`schema_version` and invalidates (or forces re-review of) every label written under the old one.
Do not edit casually.

## 0. Frame identity — what a label's `frame` means

Every label is keyed on the **normalized frame clock** — the artifact's declared public frame
identity (`video.frame_id_space: "normalized"`), i.e. frame `N` of `out/<stem>/normalized.mp4`,
which is exact CFR so `frame = round(t * fps)` holds. This is the same clock the project's
existing hand truth (`head_markers`, `swing_stages`) uses, and labels carry the same staleness
guard those rows do: every label file records the `fps` it was made against, and an evaluator
comparing it to an artifact at a different fps must flag the labels **stale** and refuse to
score, never silently renumber. (The one deterministic remap — a 30 fps source labeled against
an old duplicated-frame 60 fps artifact — is `frame_30 = frame_60 // 2`; doing it is a
deliberate, logged act, not something an evaluator does on the fly.)

Trim labels (§3) are the exception: they describe RAW pre-trim clips no artifact exists for, so
they use the raw clip's own wall-clock in ms.

Store **both** `frame` and `ms` (ms = frame midpoint: `(frame + 0.5) / fps * 1000`). If the two
ever disagree, `frame` wins; `ms` exists for cross-fps reporting.

## 1. Club points (5-point schema)

Per labeled frame, five points, each in **normalized image coordinates** (x right, y down, 0–1,
same convention as `analysis.json`):

| Point | Definition |
|---|---|
| `grip` | Midpoint of the visible grip, halfway between the hands' contact zone. If only part of the grip is visible, the midpoint of the *visible* portion. |
| `shaft_mid` | Midpoint of the visible shaft between `grip` and `hosel`. On a heavily blurred shaft (streak), the midpoint of the streak's centerline. |
| `hosel` | The hosel/neck junction: where the shaft's centerline meets the club head body. |
| `head_a` | The **heel-most extent** of the club head silhouette (the end adjacent to the hosel junction). |
| `head_b` | The **toe-most extent** of the club head silhouette (the tip farthest from the hosel along the heel–toe axis). |

Derived (never labeled directly): **head center** = midpoint(`head_a`, `head_b`); **shaft axis**
= line through `grip` and `hosel` (sanity: `shaft_mid` within tolerance of it); **apparent head
length** = ‖`head_a` − `head_b`‖.

Exception: labels **imported** from the player's head-marker editor (`head_markers` rows,
provenance `player_correction`) carry a direct `head_center` point and nothing else — a marker
is one click, not a 5-point pose. Evaluators score whichever points a frame has.

### Per-club-type notes

- **Driver / fairway wood:** the silhouette is a rounded solid. `head_a`/`head_b` are the extreme
  points of the crown-to-sole silhouette along the heel–toe axis — NOT face corners. At DTL the
  toe (`head_b`) is usually the far, lower-contrast end; label the extent you can defend, drop
  visibility to `occluded` when the boundary is a guess.
- **Iron / wedge:** `head_a` is the heel at the hosel bend (just below the `hosel` point;
  distinct points even when close), `head_b` the toe tip along the topline.
- **Putter:** out of scope; do not label.

### Motion blur

A fast head renders as a streak. Rules, in order:

1. `blur: "none" | "mild"` — the head reads as a shape: label normally.
2. `blur: "heavy"` — boundaries soft but the shape's location is defensible: label the
   **centroid-time position** (the middle of the streak), set point visibility as warranted.
3. `blur: "shaft_streak"` / `"head_streak"` — the shaft/head is a translucent smear across many
   pixels: label the **midpoint of the streak** for the streaked points only, mark those points'
   visibility `occluded`, keep unstreaked points normal.
4. `blur: "unusable"` — nothing defensible: label NO points, keep the frame row with the flag so
   the evaluator counts it as unlabelable rather than unlabeled.

### Visibility per point

`visible` — clearly resolvable. `occluded` — position inferable (body/club overlaps it, or blur
rule 2/3) but not directly seen; coordinates are still REQUIRED and the evaluator scores them
separately. `out_of_frame` — beyond the image boundary; no coordinates.

## 2. Event labels

Per swing, on the normalized clock (frame + ms each). The four anchor events are required;
the rest are labeled when defensible. The event names are the artifact's own (GolfDB), plus
`takeaway` which the artifact does not emit but the plan tracks:

| Event | Definition (the FIRST frame where the statement is true) |
|---|---|
| `address` | The club head has been grounded/settled behind the ball and the golfer's feet, grip and posture stop adjusting. Waggles END before address; a re-grip restarts it. |
| `takeaway` (optional) | The club head first moves away from the ball with intent (not a waggle — motion that continues into the backswing). |
| `toe_up` (optional) | Backswing: the shaft is horizontal (parallel to the ground), club toe pointing up. |
| `mid_backswing` (optional) | Backswing: the lead arm is horizontal. |
| `top` | The club head's reversal frame: the last frame of backswing travel; on a frame-straddling reversal, the frame nearer the pause. |
| `mid_downswing` (optional) | Downswing: the lead arm is horizontal again. |
| `impact` | First frame of club–ball contact. If contact falls between frames (240 fps can straddle it), the LAST frame before the ball deforms/leaves. The audio region and ball fields witness this. |
| `mid_follow_through` (optional) | Follow-through: the shaft is horizontal again. |
| `finish` | The golfer's rotation has stopped and the hold (or recoil) begins — the first frame where forward rotation of the body has ceased. |

Witnesses, labeled alongside:

- `audio_region` — start/end ms bracketing the strike transient in the waveform (tool: any
  waveform view; `scripts/checkaudio.py` renders one).
- `ball.last_present_frame` — last source frame where the ball is at rest at its address
  position. `ball.first_moving_frame` — first frame it has visibly left. Either may be null
  (ball obscured, no ball in frame).

`annotator_confidence` is per event, 0–1: 1.0 = certain to the frame, 0.5 = ±2 frames honest
range, below 0.3 = prefer abstaining (omit the event, record why in `notes`).

**Left-censored address:** when a clip already begins settled at address (no settle transition
was witnessed), label `address` frame 0, write "left-censored" in its notes, and cap its
confidence at 0.5 — frame 0 is a lower bound, not an observed settle. A detector picking any
frame inside the opening static hold is disagreeing with a definition artifact, not wandering;
read such errors accordingly. (Duplicated-frame clips: label the FIRST index of an identical
run, and note the run length when it stretches beyond a pair.)

A `second_annotator` block (same shape) exists for the representative subset that measures
inter-annotator error; leave absent otherwise.

## 3. Trim labels (raw, pre-trim clips)

Per RAW clip (`fixtures/raw/**`), on the raw clip's own clock, all in ms:

- `strikes_ms[]` — every actual ball strike audible/visible, in order.
- `practice_swing_intervals_ms[][2]` — start/end of each practice swing (no ball).
- `chosen_swing_ms` — the strike the trimmed fixture is built around (must be a member of
  `strikes_ms`), null if the clip has exactly one strike.
- `true_interval_ms` — `{address, finish}` for the chosen swing (same event definitions as §2).
- `walking_intervals_ms[][2]` — walking in/out, phone handling (optional).
- `audio_quality` — `good | noisy | unusable` (unusable: strike not identifiable by ear).
- `slowmo` — `{is_slowmo, capture_fps, container_fps}` facts as stamped/known, null fields when
  unknown.

## 4. Body labels

Not all joints, not all frames. Label ONLY: (a) the event frames from §2, (b) any frame a
scoring check reads directly. Joints: shoulders, hips, knees, elbows, wrists/hands, head/neck,
plus the trunk points current metrics consume (see `docs/METRICS.md`). Same coordinate and
visibility conventions as §1. Body labeling starts only after event labels exist — its frames
come from them.

## 5. Split discipline

A clip belongs to exactly one tier: **golden** (release gate, never tuned on), **dev** (tuning,
training, threshold selection), **holdout** (untouched; golfer- AND recording-disjoint from both
others). Assignment is by golfer and source recording — never frame-level, never per-swing
within one recording. The manifest (`groundtruth/goldenset.py`) is the authority; a clip absent
from the manifest has no tier and must not be used for either purpose.
