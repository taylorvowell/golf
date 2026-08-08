# SwingSage — Every Metric Currently Measured & Displayed

**Generated 2026-08-07** against `scoring_config/v2.json`, `swingsage/metrics.py`, and the seven
analysed fixtures on disk (`6iron-1`, `6iron2`, `6iron3`, `perfect`, `pro_2`, `swing1`, `swing2`
— all down-the-line, all right-handed).

This is a description of **what exists today**, not what the specs plan. Every entry below is a
number the pipeline actually emits and the player actually renders. Anything in
`scoring_config/criteria.md` that isn't wired yet is out of scope here — see
[services/analyzer/scoring_config/COVERAGE.md](../services/analyzer/scoring_config/COVERAGE.md)
for that gap.

## How this list is ordered

Ordering is by **causal importance to the golf shot**, which for scored checks is
`criteria.md`'s own weight column (1–100) — the project's existing, authored judgment of how
much a fault costs in strike quality, distance and accuracy. That gives a defensible ranking
rather than my opinion. Within equal weights, ties break toward the checks that discriminate
across the fixture set.

The list runs in four tiers, numbered continuously 1–61:

| Tier | # | What it is |
|---|---|---|
| **1 — Scored** | 1–28 | Produces the 0–100 swing score. Displayed on Overview, Coach and the Advanced criteria breakdown. |
| **2 — Measured, not scored** | 29–51 | Real numbers, rendered in the Advanced metric explorer / checkpoint table / frame panel. No band attached yet. |
| **3 — Measured but abstaining** | 52–56 | Wired checks the config deliberately **defers** — the underlying number is displayed but not trusted enough to grade. |
| **4 — Pipeline quality** | 57–61 | Confidence and coverage numbers that tell you whether to believe tiers 1–3 at all. |

## Reading the entries

- **How it's measured** — the geometry, in the units published. Every angle is
  aspect-corrected; every displacement is normalised by the golfer's own pixel height
  (`bh`, "body-heights") so it survives camera distance.
- **Ideal** — for tier 1 this is the literal `band` in `scoring_config/v2.json`, with the
  soft `falloff` (score decays linearly to 0 over that many units past the nearer edge — a
  value 1° out never reads the same as one 20° out). For tiers 2–4 there is no authored band;
  "ideal" is the coaching intent, explicitly marked as unvalidated.
- **On the fixtures** — real measured values across all seven clips. This is here because of
  the project's standing rule (D42): a check scoring well is not evidence the check works.
  Seeing the spread is the only cheap way to spot a band that's measuring the wrong quantity.

Three conventions that will otherwise trip you up:

- `_flex` is **departure from straight** (0° = straight limb). `_hinge` is the **interior**
  angle (180° = straight). From-vertical angles are **signed** and the sign flips with camera
  side. Stack angles use **90° = stacked**.
- Keypoints are anatomical (`left_wrist`); metrics are **lead/trail** — lead is the side
  closest to the *target*, set by handedness, never "the side facing the camera."
- `null` always means *not measurable in this view / not tracked*, **never zero**.

---

# Tier 1 — Scored metrics

The 28 checks in `scoring_config/v2.json` that are wired and trying to produce a number. The
overall score is their weighted mean over whichever ones were measurable on that swing;
categories report "n of m measurable" rather than hiding a gap.

Current overall: **perfect 79.9 Pure · 6iron-1 73.3 · 6iron3 69.8 · swing1 69.6 · 6iron2 68.5 ·
pro_2 61.6 · swing2 57.9 Building.**

---

### 1. Flat / bowed lead wrist at impact — `lead_wrist_deviation` @ P7 · `IMP-01`
- **Category:** Impact
- **Why it matters:** The single most causally-loaded thing in the swing that video can see.
  The lead wrist's condition at impact *is* the clubface's condition at impact — a cupped
  wrist adds loft and opens the face, a flat-to-bowed one delivers compression and a square
  face. Everything upstream exists to arrive here.
- **Impact:** weight **88/100** (highest in the config) · effort 4/5 (deep pattern change)
- **How it's measured:** interior angle at the wrist between the forearm (`elbow → wrist`) and
  the third metacarpal (`wrist → middle_mcp`), read at the detected Impact frame. Keeps the
  older convention where **180° = straight**, so this is not a `_flex` field.
- **Ideal:** `165–195°`, falloff 18. Flat to slightly bowed.
- **On the fixtures:** 166.6 / 174.5 / 171.2 / 173.7 / **80.2** / 177.0 / n-a. Six score 100;
  `pro_2` scores 0 at 80.2°, which given the surrounding values reads more like a bad frame or
  a missed impact than a real 100° wrist. **The bow-vs-cup *sign* has never been verified
  against a fixture** — the band is symmetric around straight as a placeholder.

### 2. Shaft lean at impact (irons) — `shaft_from_vertical_at_impact` · `ANG-56`
- **Category:** Impact
- **Why it matters:** Forward shaft lean is compression. Hands ahead of the ball at impact
  delofts the club and produces a descending strike; a vertical or backward-leaning shaft is
  the flip/scoop that costs distance and turf interaction.
- **Impact:** weight **84/100** · effort 4/5
- **How it's measured:** angle of `grip_center → club head` off the **downward plumb line**,
  at the Impact frame. Measured off plumb rather than horizontal specifically because the club
  swings a full half-turn and would otherwise wrap through the branch cut mid-swing.
- **Ideal:** `5–16°` forward, falloff 12.
- **On the fixtures:** 30.5 / 30.6 / 29.4 on the three 6-iron clips → **all score 0**; skipped
  on the other four (club type not recorded). Three independent clips clustering at ~30° against
  a 5–16° band is the D42 signature — either these golfers all have extreme lean, or the
  DTL-view caveat below is biting.
- **⚠ View caveat, and it is load-bearing:** face-on, this quantity is genuinely shaft lean.
  **Down the line, the camera looks along the target line, so lean points at the lens and is
  invisible** — what's left is the shaft's angle in the swing plane. `metrics.shaft_plane`
  says which you're reading. All seven fixtures are DTL, so this check is currently scoring a
  different quantity than its label claims.

### 3. Lead wrist condition at top — `lead_wrist_deviation` @ P4 · `TOP-01`
- **Category:** Backswing & Top
- **Why it matters:** The wrist condition at the top is the strongest single predictor of the
  face condition at impact. A cupped lead wrist at the top means an open face to fight all the
  way down; flat-to-bowed pre-sets a square delivery.
- **Impact:** weight **78/100** · effort 4/5
- **How it's measured:** identical geometry to #1, sampled at the Top checkpoint.
- **Ideal:** `165–195°`, falloff 20.
- **On the fixtures:** 174.3 / 171.6 / 170.0 / 167.1 / 176.0 / 174.7 / 177.4 — **100 on all
  seven.** A check that never discriminates carries no information; see
  [Signal check](#signal-check-which-of-these-actually-discriminate) below.

### 4. Tempo ratio — `tempo.ratio` · `SEQ-02`
- **Category:** Transition & Tempo
- **Why it matters:** Tour tempo clusters hard at 3:1 backswing:downswing. It's the single
  rhythm number that correlates with repeatability, and it's **scale-invariant** — the only
  timing metric that survives slow-motion footage.
- **Impact:** weight **78/100** · effort 3/5
- **How it's measured:** `backswing_frames / downswing_frames`, where backswing is
  Address→Top and downswing is Top→Impact, from the detected event frames.
- **Ideal:** `2.2–3.8 : 1`, falloff 1.2.
- **On the fixtures:** 2.65 / 2.89 / 3.11 / **1.57** / 2.47 / 2.09 / **1.55**.
- **⚠ Known open issue (D49):** Top is defined by the **hands'** highest point, and the club
  keeps working back after the hands reverse (15 frames on swing2). So the backswing is
  measured short and **tempo reads systematically low across every fixture.** Do not tune this
  band before D49 is resolved.

### 5. Lag / wrist-angle retention — `lead_wrist_hinge` @ P5 · `DSW-01`
- **Category:** Downswing & Plane
- **Why it matters:** Retaining the wrist angle deep into the downswing is where clubhead
  speed comes from. Casting — releasing it early from the top — is the most common amateur
  power leak there is.
- **Impact:** weight **75/100** · effort **5/5** (the hardest fix in the config)
- **How it's measured:** angle between the lead forearm (`elbow → wrist`) and the **club
  shaft** (`grip_center → club head`) at mid-downswing. Deliberately not forearm-vs-hand:
  measured that way it read 170–178° at every event, because the hand barely moves relative to
  the forearm — it's the *shaft* that angles away, which is what "hinge" means.
- **Ideal:** `60–100°`, falloff 25.
- **On the fixtures:** n-a / n-a / n-a / 32.6 / 10.3 / **147.1** / 39.8. Three clips have no
  club at P5 at all; swing1's 147.1° is outside anything anatomically sensible. **This check is
  club-tracking-limited, not golfer-limited** — it is the metric most likely to improve from
  better club data, and the one most worth not trusting today.

### 6. Spine forward bend at address — `spine_from_vertical` @ P1 · `SET-01`
- **Category:** Setup & Posture
- **Why it matters:** The address spine angle sets the swing plane. Too upright steepens
  everything downstream; too bent costs balance and turn. It's the cheapest fault to fix and it
  propagates into every later position.
- **Impact:** weight **70/100** · effort 2/5
- **How it's measured:** signed angle of `mid_hip → neck` from vertical, taken as the
  **median over the whole address hold**, not one frame — it's a static quantity, so averaging
  the hold rejects keypoint jitter (D28).
- **Ideal:** `35–45°`, falloff 10.
- **On the fixtures:** 14.1 / 13.1 / 16.4 / **37.0** / **39.6** / 15.0 / 14.2. Five of seven
  score **0**. Two clean clusters (~14° and ~38°) across seven clips of the same view is more
  consistent with a measurement/convention difference between shoots than with five golfers
  standing bolt upright. **Print the raw value against the picture before trusting this band.**

### 7. Loss of posture (whole downswing) — `spine_change_at_impact` · `FLT-10`
- **Category:** Downswing & Plane
- **Why it matters:** Standing up out of posture ("early extension" at the spine) is one of
  the highest-frequency amateur faults, and it forces compensations in the hands to save the
  strike.
- **Impact:** weight **70/100** · effort 3/5
- **How it's measured:** `spine_from_vertical` at Impact minus the address-hold median. Signed:
  negative = standing up, positive = diving in.
- **Ideal:** `−6 … +6°`, falloff 10.
- **On the fixtures:** −2.9 / −0.7 / −4.9 / −1.4 / −4.8 / −4.1 / +4.5 — **100 on all seven.**
- **⚠ Duplicate:** this reads the exact same field, with the exact same band, as #8. The two
  double-count 138 points of combined weight against a single number.

### 8. Posture maintained into impact — `spine_change_at_impact` · `DSW-04`
- **Category:** Downswing & Plane
- **Why it matters:** Same fault as #7, phrased as the positive. Retaining the address spine
  angle to the ball is what keeps low-point and face delivery repeatable.
- **Impact:** weight **68/100** · effort 3/5
- **How it's measured / Ideal / Fixtures:** identical to #7 in every respect.
- **⚠** See the duplicate note above — one of these two should be retired or re-pointed.

### 9. Chin over mid-foot plumb at address — `chin_over_midfoot_deg` @ P1 · `SET-06`
- **Category:** Setup & Posture
- **Why it matters:** Balance at setup. The plumb line a coach draws from the mid-foot up
  through the head is the single most-drawn line in golf instruction; being off it at address
  means starting the swing already leaning.
- **Impact:** weight 60/100 · effort 2/5
- **How it's measured:** angle from horizontal of the line joining the **mid-foot reference**
  (midpoint heel→toe, averaged over both feet) to the chin. **90° = stacked.** Median over the
  address hold. Reported alongside a ball-of-foot variant (0.75 along heel→toe).
- **Ideal:** `82–98°`, falloff 14 — i.e. within 8° of plumb either way.
- **On the fixtures:** 83.2 / 83.8 / 84.0 / 76.8 / 77.7 / 79.6 / 84.2.
- **⚠** Down the line the camera looks roughly along the toe line, so `heel → toe` is
  foreshortened onto a short, noisy segment and the 0.75-point inherits that noise. Both feet
  are averaged (halves it) and mid-foot is published beside ball-of-foot so a disagreement is
  visible rather than hidden.

### 10. Chicken wing — `lead_elbow_flex` @ P9 · `REL-04`
- **Category:** Follow-Through & Balance
- **Why it matters:** The lead elbow folding back in after impact is a classic loss-of-speed
  and face-control fault — the body stops rotating and the arms bail.
- **Impact:** weight 60/100 · effort 3/5
- **How it's measured:** `180 − interior angle` at the lead elbow (so 0° = straight arm) at
  P9, trail-arm-parallel through. **Guarded** on `lead_arm_in_plane ≥ 0.5` — an arm pointing
  at the lens foreshortens and reads folded when it's straight.
- **Ideal:** `0–20°`, falloff 20.
- **On the fixtures:** measurable on **1 of 7** (`pro_2`, 94.5° → 0). **P9 emits no arm angles
  on the other six.** Wired and correct; blocked upstream on checkpoint geometry.

### 11. One-piece takeaway — `lead_wrist_hinge` delta P2 vs P1 · `TKA-01`
- **Category:** Takeaway
- **Why it matters:** The first 18–24 inches sets the plane. Hinging early with the hands
  instead of turning with the body is what puts the club under- or over-plane before the
  backswing has really started.
- **Impact:** weight 58/100 · effort 3/5
- **How it's measured:** the **change** in forearm-vs-shaft angle between address and
  shaft-parallel-back — not the absolute. Deliberately a delta: the same physical position is a
  different absolute angle for every golfer's setup, but the added hinge is comparable.
  Confidence-gated on the **weaker** of the two checkpoints.
- **Ideal:** `0–45°` added, falloff 35.
- **On the fixtures:** 53.0 / **127.2** / 64.2 / 50.0 / 71.1 / 66.1 / **132.2**. Two clips add
  >125° of hinge by P2, which is not a takeaway — that's the P2 detection or the club angle,
  not the golfer.

### 12. Wrist hinge / set at top — `lead_wrist_hinge` @ P4 · `WRS-01`
- **Category:** Backswing & Top
- **Why it matters:** The stored power. ~90° of wrist set at the top is the lever the
  downswing releases; under-setting caps clubhead speed before the downswing even starts.
- **Impact:** weight 58/100 · effort 3/5
- **How it's measured:** forearm-vs-shaft angle (as #5) at Top.
- **Ideal:** `75–105°`, falloff 25.
- **On the fixtures:** 32.7 / 32.2 / 18.7 / 106.3 / 110.4 / 109.9 / 31.6. A clean split — the
  three 6-iron clips and swing2 read ~20–33° (score 0), the other three read ~106–110° (score
  78–95). Same two-cluster pattern as #6, and worth investigating as one question rather than
  two.

### 13. Posture type — `glossary.posture_type` · `SET-10`
- **Category:** Setup & Posture
- **Why it matters:** C-posture (rounded upper back) restricts thoracic rotation and shoulder
  turn; S-posture (over-arched lumbar) loads the low back and tends to produce early extension.
  Neutral is the athletic baseline.
- **Impact:** weight 58/100 · effort 3/5
- **How it's measured:** the only **categorical** check in the config. Signed sagitta of the
  `mid_hip → neck → head_center` chain — how far the shoulder midpoint sits off the straight
  line from hips to head, in torso lengths. `|value| < 0.03` → `neutral`; positive →
  `C-posture`; negative → `S-posture`. Anchored on the ear midpoint deliberately: the ears sit
  near the skull's rotation centre, so nodding barely moves them.
- **Ideal:** `neutral`. Categorical scoring is binary-ish: 100 if good, **40** if not.
- **On the fixtures:** C-posture ×5, neutral ×2 (`perfect` 0.011, `swing2` 0.0211).
- **⚠ The 0.03 threshold is an explicit placeholder, not a tuned rubric** (D27). Four trunk
  keypoints give exactly one curvature value — it cannot separate thoracic rounding from lumbar
  flexion, and the scale has never been validated against a known-good posture assessment. It
  is also only clean at address: once the torso rotates, the shoulder midpoint moves for
  reasons that have nothing to do with the spine's shape.

### 14. Lead hip hinge at address — `lead_hip_hinge` @ P1 · `ANG-06`
- **Category:** Setup & Posture
- **Why it matters:** Hinging from the hips rather than the waist is what separates a golf
  posture from a squat. The same knee flex with a different hip hinge is a completely different
  setup, and the hinge is what allows the shoulders to turn on plane.
- **Impact:** weight 55/100 · effort 2/5
- **How it's measured:** **interior** angle at the lead hip between the torso (`hip → neck`)
  and the femur (`hip → knee`). Bolt upright approaches 180°; bending forward closes it. Median
  over the address hold. DTL-only — face-on the forward bend points at the lens and it
  degenerates.
- **Ideal:** `130–150°`, falloff 15.
- **On the fixtures:** 155.6 / 156.4 / 152.3 / **132.6** / 121.8 / 162.6 / 158.1. This one
  *does* discriminate: scores range 16.0 → 100 across the set.

### 15. Lead arm structure at top — `lead_arm_angle` @ P4 · `BKS-01`
- **Category:** Backswing & Top
- **Why it matters:** Width. A lead arm that collapses at the top shortens the radius and
  costs both speed and consistency of low point.
- **Impact:** weight 55/100 · effort 3/5
- **How it's measured:** the raw 2D interior angle shoulder-elbow-wrist (180° = straight),
  **guarded** on `lead_arm_in_plane ≥ 0.5`.
- **Ideal:** `150–180°`, falloff 20.
- **On the fixtures:** 143.3 / 139.7 / 130.9 / 168.5 / 139.5 / **117.5** / 151.9.
- **⚠ Heavily projection-sensitive**, and the guard is doing real work: `lead_arm_in_plane` at
  Top runs 0.51–0.82 across the fixtures, i.e. several are only just clearing the 0.5 gate.
  On swing1 this angle runs 174° at address → 59° at mid-backswing → 171° at impact *at
  confidence 1.00* — that dip is geometry, not tracking.

### 16. Trail elbow flex at top — `trail_elbow_flex` @ P4 · `TOP-02`
- **Category:** Backswing & Top
- **Why it matters:** The trail elbow folded to ~90° and pointing down is the connected
  backswing; a "flying elbow" that stays straight and lifts away is a plane and sequencing
  fault.
- **Impact:** weight 55/100 · effort 3/5
- **How it's measured:** `180 − interior angle` at the trail elbow (0° = straight), guarded on
  `trail_arm_in_plane ≥ 0.5`.
- **Ideal:** `75–105°` of flex, falloff 20.
- **On the fixtures:** 149.8 / 147.8 / 151.6 / 128.5 / 165.9 / 151.3 / 127.8 — **0 on all
  seven.** 149° of *flex* means an interior angle of 31°, which is a fully-closed elbow.
  Anatomically most of these are implausible, and the guard is not catching it. **This is the
  most likely genuinely-broken scored check in the config** — the trail arm points down the
  barrel in a DTL view, exactly the foreshortening case `*_arm_in_plane` exists to flag.

### 17. Trail wrist extension at impact — `trail_wrist_deviation` @ P7 · `WRS-03`
- **Category:** Impact
- **Why it matters:** The "waiter's tray" — a stable, extended trail wrist at impact — is the
  mirror of the flat lead wrist. Flipping it through the ball throws loft on and loses
  compression.
- **Impact:** weight 55/100 · effort 4/5
- **How it's measured:** same wrist geometry as #1, trail side, at Impact.
- **Ideal:** `150–195°`, falloff 25.
- **On the fixtures:** 174.7 / 164.8 / 176.3 / 165.2 / **127.5** / 167.3 / 163.2. Six score
  100; `pro_2` scores 10 — the same clip that misfires on #1, which points at that swing's
  Impact frame rather than at both checks independently.

### 18. Shaft lean at impact (driver) — `shaft_from_vertical_at_impact` · `ANG-57`
- **Category:** Impact
- **Why it matters:** Opposite of the iron case: with a driver you want to stay behind the
  ball and deliver the shaft near-vertical or slightly back, to launch high with low spin.
- **Impact:** weight 55/100 · effort 4/5
- **How it's measured:** identical to #2; `abs_value: true`, so it grades the magnitude of
  deviation from vertical either way.
- **Ideal:** `|value| ≤ 8°`, falloff 12.
- **On the fixtures:** **skipped on all seven** — three are recorded as irons, four have no
  club type recorded at all. Pass `--club-type driver|irons` to `burnin.py` to activate the
  club-aware bands.

### 19. Stance width vs shoulder width, driver — `stance_width_ratio` @ P1 · `BAL-03`
- **Category:** Setup & Posture
- **Why it matters:** The base. Too narrow with a driver costs stability through a
  higher-speed swing; too wide restricts the turn.
- **Impact:** weight 55/100 · effort 1/5 (cheapest fix in the config)
- **How it's measured:** `‖left_ankle − right_ankle‖ / ‖left_shoulder − right_shoulder‖`.
- **Ideal:** `1.0–1.4×` shoulder width, falloff 0.3.
- **On the fixtures:** **skipped on all seven.** Face-on only *and* driver only. Down the line
  the camera looks along the stance line, both ankles foreshorten onto each other, and the
  ratio is meaningless — swing2 reported 0.59× against a real-world 1.0–1.4×, so `metrics.py`
  now publishes `null` there rather than a number the scorer would grade.

### 20. Extension through impact — `lead_elbow_flex` @ P9 · `REL-03`
- **Category:** Follow-Through & Balance
- **Why it matters:** Both arms extending down the target line past the ball is the signature
  of a released, fully-rotated strike. It's the positive framing of #10.
- **Impact:** weight 55/100 · effort 3/5
- **How it's measured / Ideal:** as #10, band `0–25°`, falloff 20.
- **On the fixtures:** measurable on **1 of 7** (`pro_2`, 94.5° → 0). Blocked on P9 geometry.

### 21. Lead knee flex at address — `lead_knee_flex` @ P1 · `ANG-07`
- **Category:** Setup & Posture
- **Why it matters:** Athletic flex. Locked-straight legs kill the ability to load and turn;
  over-flexed turns the setup into a squat.
- **Impact:** weight 50/100 · effort 1/5
- **How it's measured:** `180 − interior angle` at the knee (hip-knee-ankle), 0° = straight.
  Median over the address hold.
- **Ideal:** `15–30°`, falloff 10.
- **On the fixtures:** 16.3 / 15.5 / 21.1 / 32.1 / 18.8 / 25.3 / **8.9**.
- **Note:** knee flex alone can't tell "knee travelled forward over the foot" from "sat back" —
  read it with `lead_shin_from_vertical` (#40).

### 22. Trail knee flex at address — `trail_knee_flex` @ P1 · `ANG-08`
- **Category:** Setup & Posture
- **Why it matters:** Should roughly match the lead knee. Asymmetry at address usually means
  weight already leaning one way before the swing starts.
- **Impact:** weight 50/100 · effort 1/5
- **How it's measured / Ideal:** as #21, band `15–30°`, falloff 10.
- **On the fixtures:** 29.7 / 31.0 / 31.4 / 36.2 / 19.7 / 27.6 / 11.8.

### 23. Lead arm hang from vertical at address — `lead_arm_hang` @ P1 · `SET-05`
- **Category:** Setup & Posture
- **Why it matters:** Arms hanging naturally under the shoulder sockets is what puts the hands
  in a repeatable place. Reaching out or pulling in changes the club's delivery path before
  anything moves.
- **Impact:** weight 50/100 · effort 2/5
- **How it's measured:** signed angle of `wrist → shoulder` from vertical (0° = hands directly
  under the socket), median over the address hold. DTL-only, and **setup-only** —
  `ANGLE_FIELDS` marks it `when: "setup"` precisely because at the top the lead arm is above
  the shoulder and this reads ~140°, arithmetically correct and coaching-meaningless.
- **Ideal:** `−10 … +10°`, falloff 15 (`abs_value: true`).
- **On the fixtures:** −8.9 / −10.6 / −7.6 / 4.3 / 2.8 / −7.6 / **−25.8**.

### 24. Trail knee flex retained at top — `trail_knee_flex` @ P4 · `LOW-01`
- **Category:** Backswing & Top
- **Why it matters:** Holding trail-knee flex through the backswing is what keeps the lower
  body a stable base to coil against. Straightening it lets the hips over-turn and the coil
  leak away.
- **Impact:** weight 50/100 · effort 2/5
- **How it's measured:** as #22, sampled at Top.
- **Ideal:** `10–35°`, falloff 15.
- **On the fixtures:** 26.6 / 25.7 / 30.3 / 34.0 / 20.6 / 29.3 / 5.3 — 100 on six of seven.

### 25. Stance width vs shoulder width, irons — `stance_width_ratio` @ P1 · `BAL-04`
- **Category:** Setup & Posture
- **Why it matters:** Roughly shoulder-width is the iron baseline; the club is shorter and the
  swing narrower than with a driver.
- **Impact:** weight 50/100 · effort 1/5
- **How it's measured / Ideal:** as #19, band `0.9–1.15×`, falloff 0.3.
- **On the fixtures:** **skipped on all seven** — face-on only, and every fixture is DTL.

### 26. Downswing duration — `tempo.downswing_ms` · `SEQ-04`
- **Category:** Transition & Tempo
- **Why it matters:** Absolute downswing time is a direct proxy for how hard the club is being
  accelerated into the ball. Real swings live in a tight window.
- **Impact:** weight 48/100 · effort 3/5
- **How it's measured:** `(impact_frame − top_frame) / fps × 1000`.
- **Ideal:** `180–380 ms`, falloff 150.
- **On the fixtures:** 333 / 317 / 300 / *skipped* / 250 / 383 / **483**.
- **Slow-motion gate:** skipped when `backswing_ms > 2000` (`perfect` at 3267 ms is slow-motion
  footage baked into the pixels — the container reports an ordinary 30 fps). Deliberately **not**
  gated on `tempo.implausible`, which also fires for a genuinely slow golfer: swing2 is flagged
  but its 750 ms backswing is ordinary, so its slow downswing is a real fault and is still
  scored.

### 27. Head lateral movement at impact — `head_sway` @ P7 · `ANG-44`
- **Category:** Impact
- **Why it matters:** Staying behind the ball. Sliding the head toward the target through
  impact steepens the strike and moves low point forward unpredictably.
- **Impact:** weight 45/100 · effort 2/5
- **How it's measured:** horizontal displacement of `head_center` from its address position,
  in **body-heights** (so it's camera-distance independent), at Impact.
- **Ideal:** `−0.03 … +0.06 bh`, falloff 0.04.
- **On the fixtures:** 0.011 / 0.023 / 0.026 / −0.021 / −0.013 / −0.02 / 0.032 — **100 on all
  seven.** Non-discriminating on this set; either the band is loose or these are all clean.

### 28. Backswing duration — `tempo.backswing_ms` · `SEQ-03`
- **Category:** Transition & Tempo
- **Why it matters:** ~0.85 s is the tour norm; a rushed or dragged backswing is the most
  common source of an inconsistent transition.
- **Impact:** weight 45/100 · effort 3/5
- **How it's measured:** `(top_frame − address_frame) / fps × 1000`.
- **Ideal:** `550–1150 ms`, falloff 300.
- **On the fixtures:** 883 / 917 / 933 / *skipped (3267 ms, slow-mo)* / 617 / 800 / 750 —
  100 on all six measured.
- **⚠** Inherits D49's early-Top problem (see #4): every backswing duration here is measured
  short.

---

# Tier 2 — Measured and displayed, but not scored

These are real numbers in `analysis.json`, rendered in the Advanced metric explorer, the
ten-checkpoint angle table, the "Metrics at this frame" panel, or the club/face panels. None
has an authored band yet, so none moves the score. Ordered by how much a coach would use them.

### 29. Early extension — `glossary.early_extension` / `hip_sway`
- **Category:** Downswing & Plane
- **Why it matters:** The pelvis thrusting toward the ball during the downswing is one of the
  top-three amateur faults — it forces the hands to lift, blocks the arms, and is the root
  cause of both the block and the flip. **This is the highest-value unscored metric in the
  pipeline.**
- **How it's measured:** the largest signed `hip_sway` (mid-hip horizontal displacement in
  body-heights) between Top and Impact. Down the line the camera looks along the target line,
  so the thrust is horizontal in frame and this measures it directly. Face-on it's depth, which
  one view cannot see at all → `null`.
- **Sign is resolved** from `glossary.ball_direction` (#50): positive = pelvis moved toward the
  ball.
- **Ideal (unvalidated):** near 0; toward-ball movement is the fault.
- **On the fixtures:** +0.036 / +0.037 / +0.054 / −0.028 / +0.013 / −0.008 / −0.021 bh. The
  three 6-iron clips all move toward the ball; the others move away. That's a real,
  discriminating signal sitting unbanded.

### 30. Coil / X-factor (tilt form) — `xfactor_estimated`
- **Category:** Backswing & Top
- **Why it matters:** Upper body wound against lower body is where the swing stores energy.
- **How it's measured:** `shoulder_tilt − hip_tilt`, both being image-plane angles of the
  shoulder and hip lines from horizontal. Explicitly labelled *estimated*: real X-factor is 3D
  and a single 2D view cannot resolve it.
- **Ideal (unvalidated):** ~40–45° at the top.
- **On the fixtures at Top:** 15.0 / 17.0 / 14.1 / 24.6 / 25.3 / 23.4 / 12.7. Under-reads
  badly, as expected for a projected quantity.
- **Note:** this is a *different quantity* from the deferred `xfactor_rotation_est` (#52),
  which is built from projected widths rather than line tilts. Both are published; neither is
  scored.

### 31. Neck angle — `neck_angle` (+ `neck_angle_delta`, `neck_angle_src`)
- **Category:** Setup & Posture / Head
- **Why it matters:** Head carried in line with the spine at address, and *staying* there, is
  the posture reference the whole swing rotates around. Chin-into-chest at address blocks the
  shoulder turn.
- **How it's measured:** interior angle at the neck between the torso (`neck → mid_hip`) and
  the head anchor. 180° = head in line with the spine.
- **Anchor chain, and it matters:** `nose_bridge → head_center → chin → nose`, first tracked
  one wins, and **which one answered is published per frame**. The anchors are not
  interchangeable — the nose sits forward of the ear, so the same posture reads a different
  absolute angle through each. `compute` refuses to difference two frames whose anchors
  disagree, which is why `neck_angle_delta` is sometimes null.
- **Ideal (unvalidated):** stable through the swing; the *delta* is the coaching quantity.
- **On the fixtures at address:** 130.6 / 128.1 / 133.0 / 153.1 / 148.4 / 127.6 / 143.2.

### 32. Head turn — `head_turn` / `head_turn_delta`
- **Category:** Head
- **Why it matters:** Distinguishes a golfer who **slides** from one who merely **turns** to
  watch the club. `head_center` is an ear midpoint and cannot tell those apart — both move it.
- **How it's measured:** signed imbalance of the two chin→jaw distances,
  `(d_left − d_right) / (d_left + d_right)`, range −1…+1. Under yaw the jaw contour
  foreshortens asymmetrically about the chin, so this tracks rotation and is blind to
  translation.
- **Deliberately NOT in degrees** — the mapping from this ratio to real yaw needs face geometry
  and camera intrinsics the pipeline doesn't have.
- **Ideal (unvalidated):** small delta from address through the backswing.
- **On the fixtures (peak |delta|):** 0.132 / 0.124 / 0.123 / 0.210 / 0.224 / **0.013** / 0.164.

### 33. Head / face sway and lift — `head_sway`, `face_sway`, `head_lift`, `face_lift`
- **Category:** Head
- **Why it matters:** Peak head movement across the whole swing (as opposed to #27's snapshot
  at impact) is the stability signal a coach reads first on a face-on view.
- **How it's measured:** displacement from the address position in body-heights. `head_*` is
  the ear midpoint, `face_*` is `nose_bridge` — a **single observed point**, where the ear
  midpoint silently redefines itself to one ear when the other drops out. **Both are published
  so a gap between them is visible**; a gap means the anchor moved for a reason other than the
  golfer moving, and you should read `max_head_turn` next to it.
- **Ideal (unvalidated):** minimal, especially lateral, before impact.
- **On the fixtures (peak):** head_sway 0.028–0.063 bh; face_sway 0.026–**0.122** bh;
  face_lift 0.027–**0.169** bh. The `perfect`/`pro_2` face figures are 4× the others, which is
  exactly the anchor-disagreement case above.

### 34. Forearm roll — `lead_forearm_roll_delta`, `trail_forearm_roll_delta`
- **Category:** Impact / Face
- **Why it matters:** Supination/pronation of the forearms is **the motion that opens and
  closes the clubface**. This is the body-measured half of the face story, and the closest
  video legitimately gets to face rotation.
- **How it's measured:** image-plane angle of the knuckle line (`pinky_mcp → index_mcp`),
  which is perpendicular to the forearm's long axis. Published only as a **delta against this
  golfer's own address frame** — the absolute is camera-dependent and meaningless. Wrapped to
  −180…180 so the branch-cut crossing mid-swing doesn't report a 360° jump.
- **⚠ This is never a face angle in degrees.** The club-tracking spec reserves that number for the
  simulator impact image. Nothing in the pipeline is allowed to fabricate it from video.
- **On the fixtures at impact:** −13.0 / −16.3 / −46.9 / −21.2 / n-a / **−114.6** / n-a.

### 35. Lead / trail wrist deviation (through-swing series) — `*_wrist_deviation`
- **Category:** Impact / Backswing
- **Why it matters:** #1, #3 and #17 sample this at three frames; the full series shows *when*
  the wrist changes condition, which is where the actual fault lives.
- **How it's measured:** interior angle, forearm vs third metacarpal, 180° = straight. Falls
  back to the four-MCP centroid when no wholebody model ran — the centroid sits across the
  knuckle line, so forearm roll moves it and contaminates the angle, which is why the third
  metacarpal is preferred and why roll lives in its own field (#34).

### 36. Lead wrist hinge (through-swing series) — `lead_wrist_hinge`
- **Category:** Backswing / Downswing
- **Why it matters:** The full hinge/release curve. Where the angle is *given up* is the
  casting diagnosis; checks #5, #11 and #12 only sample three points of it.
- **How it's measured:** forearm vs club shaft, per frame. **Requires club data at that frame
  with `conf ≥ 0.3`** — this is why the metric is null on so many downswing frames.

### 37. Shaft from vertical (through-swing series) — `shaft_from_vertical` + `shaft_plane`
- **Category:** Club
- **Why it matters:** The club's angle through the whole swing — the closest thing to a plane
  trace the pipeline publishes per frame.
- **How it's measured:** `grip_center → club head` off the **downward plumb**, aspect-corrected.
  Recomputed here rather than reused from `club.frames[].shaft_angle_deg`, which is measured
  from horizontal in raw normalised coordinates and carries aspect distortion on portrait clips.
- **`shaft_plane` tells you what you're reading:** `"shaft lean"` face-on,
  `"in-plane angle (lean not visible)"` down the line. Same field, two different quantities.

### 38. Chin / shoulders / hips over the foot — `{chin,shoulders,hips}_over_{midfoot,ball_of_foot}_deg`
- **Category:** Setup & Posture
- **Why it matters:** These are the three vertical lines a coach draws on a DTL still, and they
  answer different questions: **chin** = balance and head position, **shoulders** = posture,
  **hips** = whether the pelvis is set back over the feet.
- **How it's measured:** angle from horizontal of foot-reference → body point. **90° =
  stacked.** Two foot references are published: mid-foot (0.5 along heel→toe) and ball-of-foot
  (0.75 — the metatarsal heads, where pressure actually sits). A signed form
  (`*_signed`, positive = toward the ball, 0 = stacked) is published wherever
  `ball_direction` resolved.
- **Three stated limits:** the foot reference is noisy DTL (foreshortened toe line); an image
  plumb line is only a world plumb line for points at the same depth, and nothing measures
  camera tilt; and the signed form is null wherever the ball direction couldn't be read.
- **Only #9 (chin over mid-foot) is scored.** The other five are measured and displayed.

### 39. Shoulder tilt / hip tilt — `shoulder_tilt`, `hip_tilt`
- **Category:** Setup & Posture (face-on)
- **Why it matters:** Secondary axis tilt — trail shoulder lower than lead at address — is
  what pre-sets an upward strike with a driver. Hip tilt is the pelvis's equivalent.
- **How it's measured:** angle from horizontal of `left_shoulder → right_shoulder` and
  `left_hip → right_hip`.
- **Face-on only.** Computed in DTL (the geometry is defined) but the number doesn't mean what
  its name says there — `ANGLE_FIELDS` marks it `view: "face_on"` and the UI tags the row
  "View limited". No face-on fixture exists yet, which is why criteria SET-03/04 are unwired.

### 40. Lead / trail shin from vertical — `*_shin_from_vertical`
- **Category:** Setup & Posture
- **Why it matters:** Disambiguates knee flex. The same knee angle can come from the knee
  travelling forward over the foot (shin leans) or from sitting back (shin stays plumb) —
  completely different setups, and #21/#22 alone can't tell them apart.
- **How it's measured:** signed angle of `ankle → knee` from vertical, pointing up so it shares
  the spine's sign convention.

### 41. Lead / trail hip hinge, trail side — `trail_hip_hinge`
- **Category:** Setup & Posture
- **Why it matters:** The trail-side pair to #14. A large asymmetry between the two at address
  means the pelvis isn't square.
- **How it's measured:** as #14, trail side. DTL-only.
- **On the fixtures at address:** 144.6 / 145.1 / 137.5 / 113.5 / 125.2 / 139.7 / 160.6.

### 42. Lead / trail elbow flex (through-swing) — `*_elbow_flex`
- **Category:** Backswing / Follow-Through
- **Why it matters:** The arm-structure curve. #10, #15, #16 and #20 sample it at two frames;
  the series is where "when did the lead arm break down" gets answered.
- **How it's measured:** `180 − interior angle` at the elbow, 0° = straight. **Read
  `*_arm_in_plane` from the same frame before trusting it** (#49).
- **On the fixtures, lead elbow at Top:** 36.7 / 40.3 / 49.1 / 11.5 / 40.5 / 62.5 / 28.1.

### 43. Trail / lead heel lift — `*_heel_lift`
- **Category:** Lower Body
- **Why it matters:** Trail-heel lift through impact and lead-heel lift in the backswing are
  real technique markers — they're how the ground gets used. Peak trail-heel lift is the
  cleanest "did the lower body actually work" signal available from keypoints.
- **How it's measured:** vertical separation of heel above big toe, in body-heights. Reported
  as **peak positive excursion**, not peak magnitude — a heel pressed hard into the ground would
  otherwise report as a lift.
- **On the fixtures (peak trail):** 0.091 / 0.085 / 0.104 / **0.172** / 0.151 / 0.059 /
  **0.008**. Strongly discriminating and completely unscored — swing2's 0.008 vs perfect's
  0.172 is a 20× spread.

### 44. Lead / trail ankle lean — `*_ankle_lean` + `ankle_lean_plane`
- **Category:** Lower Body
- **Why it matters:** Pressure direction. Which plane it reads depends on the view, and they're
  not the same quantity: **face-on = roll** (pronation/supination), **down-the-line = fore/aft
  lean** (pressure toward toes or heels). `ankle_lean_plane` says which.
- **How it's measured:** signed angle of `heel → ankle` from vertical.
- **⚠ The baseline is not 0.** The heel keypoint sits behind the ankle joint, so a neutral foot
  already reads ~40°. **Only the change from address is portable.**

### 45. Lead / trail foot flare — `*_foot_flare`
- **Category:** Setup & Posture (face-on)
- **Why it matters:** Flaring the lead foot out allows the hips to clear through impact;
  flaring the trail foot allows more backswing turn but reduces resistance.
- **How it's measured:** image-plane angle of `heel → foot_index` (big toe).
- **Face-on and setup-only.** The flare-direction convention has **never been checked against a
  visibly-flared stance**, which is why criteria BAL-05/06 are unwired.

### 46. Foot width ratio / sole roll — `*_foot_width_ratio` + `_delta`
- **Category:** Lower Body
- **Why it matters:** With only heel + big toe a foot is a line and roll is invisible. The
  outer edge closes the triangle: as the foot rolls about its long axis the projected width
  collapses while the length holds, so the ratio moves.
- **How it's measured:** `‖foot_index → small_toe‖ / ‖heel → foot_index‖`. Published raw per
  frame and as a **delta against this golfer's address frame** — the absolute depends entirely
  on camera angle.

### 47. Head pitch — `head_pitch`
- **Category:** Head
- **Why it matters:** Nodding down into the ball or lifting early. Separate from #31's neck
  angle, which can change from the torso moving.
- **How it's measured:** signed angle of the **face axis** (`chin → nose_bridge`) from
  vertical. Both are single observed points on the profile, so this is rotation of the skull
  about the ear axis and is blind to the golfer translating — the same reasoning behind #32.
- **DTL-only.**

### 48. Spine curvature — `spine_curvature`, `spine_curvature_delta`
- **Category:** Setup & Posture
- **Why it matters:** The raw number behind #13's categorical verdict. Displayed so a reader
  can see how close to the 0.03 neutral threshold a swing sat.
- **How it's measured:** signed perpendicular offset of the shoulder midpoint from the
  `mid_hip → head_center` chord, in chord lengths. `spine_mid` is **useless** for this — it's
  defined as the midpoint of neck and mid_hip, so it's collinear by construction and can never
  show a curve.
- **⚠ Read the address value as posture; read the delta only alongside shoulder turn.** Once
  the torso rotates the shoulder midpoint moves for reasons unrelated to the spine's shape. On
  swing2 it runs 0.009 at address → 0.089 at the top, and most of that rise is rotation.
- **On the fixtures (address):** 0.0875 / 0.1008 / 0.0791 / 0.011 / 0.0399 / 0.0889 / 0.0211.

### 49. Arm-in-plane guard — `lead_arm_in_plane`, `trail_arm_in_plane`
- **Category:** Data quality (but published as a metric)
- **Why it matters:** **This is the guard that makes every 2D arm angle readable rather than
  merely present.** An arm pointing at the lens foreshortens onto itself and its interior angle
  collapses, so the joint reads fully folded when it is straight. On swing2 the trail elbow
  reads 172° of flex at P3 — anatomically impossible, and exactly where the trail arm points
  down the barrel in a DTL view.
- **How it's measured:** `min(1.0, (‖upper arm‖ + ‖forearm‖) / (0.42 × body_height))`. Near 1.0
  the arm lies in the image plane and the angle is trustworthy.
- **Used as a hard gate** by checks #10, #15, #16, #20 at `guard_min = 0.5`.
- **On the fixtures, lead arm at Top:** 0.53 / 0.56 / 0.51 / 0.82 / 0.51 / 0.63 / 0.67 — most
  are barely clearing the gate.

### 50. Ball direction — `glossary.ball_direction`
- **Category:** Frame of reference
- **Why it matters:** Several measurements are only half-useful without it. "Chin over the ball
  of the foot" needs to know whether being off it means toward the toes or the heels; early
  extension needs to know whether the pelvis moved toward the ball or away. It is what turns
  magnitudes into signed, directional coaching statements.
- **How it's measured:** **observed, not configured.** At address the golfer bends from the
  hips and the arms hang out over the ball, so the hands sit toward the ball of the hip line;
  down the line that offset is horizontal in frame, and its **sign is the ball direction**.
  Taken as a median over the whole address hold, with a confidence from the offset magnitude.
- **Null** face-on (the hands sit near the centre line there) and null where the hold is too
  short or the offset too small to distinguish from jitter.
- **On the fixtures:** resolved on all seven, conf 1.0, offsets 0.17 bh and up.

### 51. Body facing — `body_facing`, `facing_conf`, `facing_agrees_hips`
- **Category:** Frame of reference
- **Why it matters:** A golfer finishes facing the target, so the side of the body presented to
  the lens **inverts during every swing**. The front end needs to know which, and it's what
  signs the rotation estimates.
- **How it's measured:** directly observable — shoulders are a left-right ordered pair, so the
  **sign** of `left_shoulder.x − right_shoulder.x` flips with facing. `facing_conf` is the
  projected shoulder width normalised, so a consumer can tell "facing away" from "cannot tell"
  instead of reading a coin flip as fact. Hips corroborate (they turn later, so agreement is
  meaningful rather than redundant).
- **On the fixtures:** anterior at address, posterior at finish, on all seven — as expected.

---

# Tier 3 — Measured but abstaining (deferred in `v2.json`)

These 10 checks are authored, validated against real pipeline output, and **deliberately
abstain on every swing.** The underlying values are still computed and shown in the angle
table; they carry `deferred: true` and their full reason, and the UI renders them as
"not scored yet" rather than "not measured" — the distinction matters, because one is our gap
and the other is the golfer's clip.

They are grouped here rather than ranked into tier 1 because a metric you can't trust isn't an
important metric, however important the underlying golf concept is. Combined authored weight:
**637** — this is the largest single block of missing scoring capability in the product.

### 52. The rotation family — `shoulder_turn_from_address`, `hip_turn_from_address`, `xfactor_rotation_est`
Nine checks: `ROT-01` X-factor at top (w72), `ROT-02` X-factor stretch (w75), `ROT-03` shoulder
turn at top (w68), `ROT-04` hip turn at top (w62), `ROT-05` hip turn at impact (w65),
`ROT-06` shoulder turn at impact (w55), `DSW-03` hip clearing near impact (w70),
`IMP-05` hip openness at impact (w60), `FIN-02` full rotation at finish (w40).

- **Category:** Backswing & Top / Transition / Downswing / Impact / Follow-Through
- **Why it matters:** Shoulder turn ~90°, hip turn ~45°, and the X-factor separation between
  them, are the canonical power metrics of the golf swing. Almost every "turn more" or "resist
  with the hips" instruction reduces to these.
- **How it's measured today:** `arccos(width / this clip's widest projected width)`, where
  width is the projected shoulder or hip line normalised by body height, and the reference is
  the p95 widest the line ever projects (not address — down the line the shoulders *start*
  near edge-on and widen into the backswing).
- **Why it's deferred — four separate defects, any one of which is disqualifying:**
  1. It measures **degrees away from the widest projection**, not degrees of turn.
  2. Down the line it goes **negative across the entire backswing** (−41.1 / −41.8 / −36.7
     against a `[75,105]` band). Fixing the sign is not sufficient.
  3. `arccos` is **even**, so the estimate is V-shaped through square and cannot tell open from
     closed. A line 30° open and 30° closed project identically.
  4. The projection **under-reads true turn by roughly half** (~41° recovered where the real
     figure is ~90°).
- **`ROT-06` is included in the deferral even though it scored 100/100/94.5 in v1** — that was
  the V-shape landing in-band by luck, not correctness. It is the concrete proof that a check
  scoring well is not evidence the check works.
- **Signed forms exist** (`*_facing_signed`, using #51's facing) but are left null wherever
  `facing_conf < 0.5` — exactly the edge-on zone where the ordering is a coin flip. A wrong
  sign is worse than an absent one.
- **On the fixtures, shoulder turn at Top:** −59.7 and similar negatives — the sign inversion,
  visible.
- **Unblocking this is the single highest-value metrics work left.**

### 53. Shaft plane at first parallel — `shaft_from_vertical` @ P2 · `ANG-30` (w60)
- **Category:** Takeaway
- **Why it matters:** Whether the club works inside, outside or on plane in the takeaway sets
  up everything after it.
- **Why it's deferred:** `shaft_from_vertical` at P2 is **~±90° by definition** — P2 *is* the
  shaft-parallel checkpoint. The check was scoring checkpoint detection, not swing quality. And
  true shaft plane (inside/outside the target line) **is not observable down the line at all**;
  `metrics.shaft_plane` reports `"in-plane angle (lean not visible)"` for DTL.

### 54. Swing plane — `glossary.swing_plane`
- **Category:** Downswing & Plane
- **Why it matters:** The plane the club actually travels on is the headline club metric.
- **Status:** **always `null`.** A plane *is* fitted inside `club.py` (`fit_plane_from_hands` /
  `fit_swing_plane`, an ellipse through the head path, used as a prior in the pass-2 solve),
  but it is used internally to constrain tracking and is not surfaced as a coaching number.

### 55. Club-head speed / kinematic sequence
- **Category:** Transition & Sequencing
- **Why it matters:** Peak-velocity ordering — pelvis → thorax → arm → club — is the single
  highest-weight unbuilt criterion in the whole triage (`SEQ-01` alone carries weight 92).
- **Status:** **not computed at all.** Needs velocity/peak-timing code over the per-frame series
  plus the club module's shaft-angle series threaded into scoring input. Named here because its
  absence is the biggest structural gap in tier 1, not because a number exists.

### 56. Face angle in degrees
- **Category:** Impact
- **Status:** **deliberately never computed from video, and never will be.** The club-tracking spec is a
  non-negotiable project constraint: at 60 fps the clubhead at impact is a blur streak. What
  *is* published is `analysis.face.checkpoints[event]` — a **classification**
  (square/open/closed) with its own confidence and, where the silhouette resolves, a
  `head_to_shaft_deg`. The authoritative degrees source is the simulator impact image
  (the simulator spec, unbuilt). The Advanced face panel says this on screen.

---

# Tier 4 — Pipeline quality metrics

Displayed on the Advanced tab. These don't describe the swing; they tell you whether to believe
anything above.

### 57. Scoring coverage — `coverage.{scored, skipped_this_swing, deferred_in_config, total_checks}`
- **Why it matters:** Without it the headline score is unfalsifiable — a reader can't tell a
  well-covered 65 from one resting on four checks. v1 reported 37.5 with no way to tell that
  nine of its checks were abstaining-by-bug.
- **Split by cause on purpose:** "skipped for this clip" (wrong club, wrong view, low
  confidence) vs "not scored yet in v2" (our gap) mean opposite things to a golfer.
- **On the fixtures:** 20–24 scored / 4–8 skipped / **10 deferred** / 38 total.

### 58. Pose quality — `quality.detection_coverage`, `quality.overall_mean_conf`, `quality.per_joint[]`
- **How it's measured:** fraction of frames with a detection, mean keypoint confidence, and
  per-joint coverage bars for `grip_center`, `nose_bridge`, `head_center`, wrists, elbows,
  knees, ankles, `mid_hip`.
- **On the fixtures:** detection 100% on all seven; mean confidence 0.59–0.63.
- **⚠ Confidence numbers recorded before 2026-08-04 are not comparable to these** — they
  measured a clamp on SimCC peak magnitudes rather than the model's opinion (D26). Regenerate
  rather than compare.
- Rendered against `quality_mediapipe` as a grey under-bar, so RTMPose vs MediaPipe coverage is
  visible per joint.

### 59. Club coverage — `club.coverage.{backswing, downswing, followthrough, swing}` + `club_len`
- **How it's measured:** fraction of frames in each phase with a *measured* (not interpolated)
  club head. `club_len` is the calibrated club length as a fraction of frame height.
- **Quality gate:** below **50% swing coverage** the trace toggle is disabled with a tooltip and
  club-dependent scores read "not scored — club not trackable." The swing still succeeds.
- **On the fixtures:** 0.98–1.00 swing coverage on all seven.
- **⚠ Coverage has overstated club quality three separate times.** Always run
  `scripts/checkclub.py` and look at the club drawn on the real frame before believing it. And
  note the drawn **trace** and the per-frame **club** are different products that fail
  differently — `checkclub.py` judges the first, `checktrace.py` the second.

### 60. Frame-sync drift — `drift.{n, mean, max}`
- **Why it matters:** Gate 2 of the verification strategy — sync proved *without* pose. Overlay
  drift during scrubbing is the #1 perceived-quality issue, and it has a completely different
  cause from a wrong joint position.
- **How it's measured:** live in the browser during playback, comparing the frame the browser
  reports as presented (`requestVideoFrameCallback` mediaTime) against our computed index.
  Non-zero mean drift means the overlay would slip.
- **Ideal:** 0. Flagged amber above 0.5 mean / 1.0 max.

### 61. Checkpoint detection confidence — `checkpoints[].conf`
- **Why it matters:** Every tier-1 check anchored at a P-position is gated on this. A confident
  read of a wrongly-detected frame is worse than no read.
- **How it's measured:** per-checkpoint, from the event detector, clamped to **0.35** by
  `checkpoints.py` when an ordering violation is detected.
- **Gate:** `DEFAULT_MIN_CHECKPOINT_CONF = 0.3` — set just *below* the 0.35 clamp floor so a
  checkpoint at the floor still scores and only genuinely worse confidence is skipped. Gating
  at 0.5 would silently exclude every backswing-top check on every swing, since both original
  fixtures read Top at exactly 0.35.

---

# Cross-cutting: how the numbers become a score

**Band scoring.** 100 inside the band; decays **linearly to 0** over `falloff` units past the
nearer edge. Never a hard pass/fail. Categorical checks are 100 / 40.

**Leverage Score** (shown on every Overview check card, with its breakdown in the tooltip).
Equal thirds, disclosed rather than tuned:

| Component | What it is | Scale |
|---|---|---|
| **Severity** | how far off target this swing measured | `100 − score` |
| **Impact** | how much this check matters to the shot | `criteria.md`'s own weight, 1–100 |
| **Ease** | how quick a fix it is | `(6 − effort) × 20`, from the authored 1–5 effort |

`leverage = (severity + impact + ease) / 3`. The coach's tip on Overview is simply the
highest-leverage check with actionable advice.

**Aggregation.** `overall` is weighted over the individual **measured checks**, not an
unweighted mean of the seven category scores — the mean-of-categories form let a 2-check
category move the headline as much as an 8-check one. `n_total` per category excludes deferred
checks, so a category can't advertise "2 of 2 measurable" while both are structurally broken.

**Bands.** Elite ≥90 · Pure ≥75 · Solid ≥60 · Building ≥40 · Reset <40. Defined once in
`swingsage/scoring.py`, mirrored in `lib/scoreDisplay.ts` (both sides must render the same
grade for the same number).

**Reproducibility.** Every report stores `scoring_model_version`. `v1.json` stays frozen on
disk so v1-stamped reports remain reproducible; it should not be used for new runs. Stage 8 is
a **pure function** of `analysis.json` + the config, so a scoring change needs
`scripts/rescore.py`, never a `burnin.py` re-run.

---

# Signal check: which of these actually discriminate?

Across the seven fixtures, several tier-1 checks return the **same score on every swing**. A
check with no variance carries no information, whichever direction it's stuck in — and the
project's own standing rule (D42) is that a check scoring well is not evidence it works.
Recorded here as the most actionable output of this audit:

| Check | Weight | All-fixture behaviour | Read |
|---|---|---|---|
| `TOP-02` trail elbow flex @ top | 55 | **0 on all 7** (127.8–165.9° vs a 75–105° band) | Most likely genuinely broken. 149° of *flex* = a 31° interior angle. The trail arm points down the barrel in DTL — the `trail_arm_in_plane` guard is not catching the case it exists for. |
| `TOP-01` lead wrist @ top | 78 | **100 on all 7** (167–177°) | Band may be too wide, or the metric is saturating. Highest-weight non-discriminating check. |
| `ANG-44` head sway @ impact | 45 | **100 on all 7** | Band (−0.03…+0.06 bh) may be loose relative to real variation (measured 0.011–0.032). |
| `DSW-04` + `FLT-10` posture | 68 + 70 | **100 on all 7**, and they are the **same field with the same band** | Genuine duplicate: 138 combined weight against one number. Retire or re-point one. |
| `SET-01` spine bend @ address | 70 | **0 on 5 of 7**, two clean clusters (~14° vs ~38°) | Convention or shoot difference, not five upright golfers. Verify against the picture. |
| `WRS-01` wrist set @ top | 58 | Same two-cluster split (~20–33° vs ~106–110°) | Same question as SET-01; investigate together. |
| `ANG-56` shaft lean @ impact | 84 | **0 on all 3** measurable (29–31° vs a 5–16° band) | The DTL caveat is biting — down the line this field is in-plane angle, not lean. |

**Also worth naming:** `DSW-01` (lag, w75) is unmeasurable on 3 of 7 and returns 147° on a
fourth; `REL-03`/`REL-04` are unmeasurable on 6 of 7 because P9 emits no arm angles; and
`BAL-03`/`BAL-04`/`ANG-57` are unmeasurable on **all** 7 (no face-on fixture, no club type
recorded). Of the 38 configured checks, the number producing a real, varying number on a
typical swing is closer to **14** than to 28.

---

## Provenance

| Source | What it defines |
|---|---|
| [services/analyzer/swingsage/metrics.py](../services/analyzer/swingsage/metrics.py) | Every per-frame measurement, the 28-entry `ANGLE_FIELDS` catalogue, the glossary/summary layers |
| [services/analyzer/scoring_config/v2.json](../services/analyzer/scoring_config/v2.json) | All 38 checks: bands, weights, effort, advice, deferral reasons |
| [services/analyzer/swingsage/scoring.py](../services/analyzer/swingsage/scoring.py) | Band scoring, gating, Leverage, aggregation, bands |
| [services/analyzer/scoring_config/COVERAGE.md](../services/analyzer/scoring_config/COVERAGE.md) | Exactly which `criteria.md` rows are wired vs deferred vs unbuilt, and why |
| [docs/GLOSSARY.md](GLOSSARY.md) | The vocabulary — angle conventions §6–7, lead/trail, the P-system |
| [docs/DECISIONS.md](DECISIONS.md) | D20 (no club position-error metric), D26 (confidence rescale), D27 (spine curvature limits), D28 (address-hold medians), D42 (the "a check that scores well isn't evidence" rule), D49 (Top is a hand landmark) |
| `apps/web/src/components/views/` | What is actually rendered: `OverviewView`, `CoachView`, `AdvancedView`, `CriteriaBreakdown`, `CheckpointAngles` |

**Regenerate this document** whenever `scoring_config/build_config.py`'s `CHECKS` table or
`metrics.py`'s `ANGLE_FIELDS` changes — otherwise it drifts into aspirational documentation,
which is exactly the failure mode `COVERAGE.md` exists to prevent.
