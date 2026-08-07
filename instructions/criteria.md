# Golf Full-Swing Analysis & Scoring — Research Dataset for AI Spreadsheet

## TL;DR

- This report delivers two spreadsheet-ready datasets: a **MAIN TAB** of 165+ weighted, scoreable full-swing elements and an **ANGLES TAB** of 64 joint/club angles by phase and camera view — all tagged Driver/Irons/Both, with tour-level quantitative ideals drawn from TrackMan, TPI, Swing Catalyst, HackMotion, and peer-reviewed biomechanics.
- The **highest-weight scoring items are impact-zone measurements** — clubface angle at impact (which contributes ~87% of a driver's launch direction and ~81% for a 6-iron/PW per TrackMan Academy), centeredness of strike/smash factor, club path, and attack angle — because these are the direct causal drivers of strike quality, distance, and accuracy. Cosmetic style points are weighted low.
- Tour benchmarks anchor every "ideal": PGA driver ≈113 mph club speed / 167 mph ball / 1.48 smash / 275 yds carry; PGA 6-iron ≈92 mph / 127 mph / −4.1° attack / 183 yds; tempo ≈3:1 (0.847 s backswing / 0.264 s downswing); X-Factor ~45° with ~5° stretch; impact weight ~80–90% lead foot.

## Naming Scheme

Every item has a stable ID: a 2–4 letter category prefix + two-digit number, so the AI can reference items by fixed ID. Prefixes: **GRP** (Grip), **SET** (Setup/Posture), **ALN** (Alignment/Aim), **BAL** (Ball Position/Stance Width), **TKA** (Takeaway), **BKS** (Backswing), **TOP** (Top of Backswing), **TRN** (Transition), **DSW** (Downswing), **IMP** (Impact), **REL** (Release/Extension), **FIN** (Follow-through/Finish), **SEQ** (Kinematic Sequence/Tempo), **GRF** (Ground Forces/Pressure), **WRS** (Wrist/Clubface), **PLN**/**DAT** subsumes Swing Plane/Path data, **ROT** (Body Rotation/Separation), **LOW** (Lower Body/Footwork), **HED** (Head/Eye), **FLT** (Faults), **PHY** (Physical/Mobility), **MNT** (Mental), **DAT** (Measured Swing Data), **BDT/DAT** (Measured Ball Data — merged into DAT prefix). The Angles tab uses **ANG-##**. Where an ideal differs meaningfully between clubs, two rows share the concept with a `(Driver)` and `(Irons)` label and club-specific ideal values. Weights are 1–100 (100 = most impact on strike quality, distance, accuracy).

> **Data-vintage note:** The complete club-by-club grid with land angle + apex below reflects TrackMan's classic/full-column tour-average dataset (driver 113 mph CHS, 167 mph ball, 275 yds carry). TrackMan's updated 2023/24 release reports slightly higher driver numbers (≈115 mph CHS, 171 mph ball, ≈282 yds carry; **300.2 yds total driving on the PGA Tour in 2024** per Golf Monthly citing TrackMan) but does not publish land angle/apex in the same complete grid. One internal TrackMan discrepancy to flag: the "What is Spin Rate?" blog lists PGA driver **2,545 rpm** and 6-iron **6,204 rpm**, while the interactive Tour Averages PDF lists **2,686 rpm** and **6,231 rpm** (optimizer at 94 mph/0° attack = 2,772 rpm). Use the PDF grid as the primary but treat driver spin as a ~2,500–2,700 rpm band.

---

## TrackMan Tour Averages — Master Reference Table (PGA / men's)

| Club   | Club Speed (mph) | Attack Angle (°) | Ball Speed (mph) | Smash | Launch (°) | Spin (rpm) | Apex (yds) | Land Angle (°) | Carry (yds) |
| ------ | ---------------- | ---------------- | ---------------- | ----- | ---------- | ---------- | ---------- | -------------- | ----------- |
| Driver | 113              | −1.3             | 167              | 1.48  | 10.9       | 2,686      | 32         | 38             | 275         |
| 3-wood | 107              | −2.9             | 158              | 1.48  | 9.2        | 3,655      | 30         | 43             | 243         |
| 5-wood | 103              | −3.3             | 152              | 1.47  | 9.4        | 4,350      | 31         | 47             | 230         |
| Hybrid | 100              | −3.5             | 146              | 1.46  | 10.2       | 4,437      | 29         | 47             | 225         |
| 3-iron | 98               | −3.1             | 142              | 1.45  | 10.4       | 4,630      | 27         | 46             | 212         |
| 4-iron | 96               | −3.4             | 137              | 1.43  | 11.0       | 4,836      | 28         | 48             | 203         |
| 5-iron | 94               | −3.7             | 132              | 1.41  | 12.1       | 5,361      | 31         | 49             | 194         |
| 6-iron | 92               | −4.1             | 127              | 1.38  | 14.1       | 6,231      | 30         | 50             | 183         |
| 7-iron | 90               | −4.3             | 120              | 1.33  | 16.3       | 7,097      | 32         | 50             | 172         |
| 8-iron | 87               | −4.5             | 115              | 1.32  | 18.1       | 7,998      | 31         | 50             | 160         |
| 9-iron | 85               | −4.7             | 109              | 1.28  | 20.4       | 8,647      | 30         | 51             | 148         |
| PW     | 83               | −5.0             | 102              | 1.23  | 24.2       | 9,304      | 29         | 52             | 136         |

**LPGA driver reference:** 94 mph CHS / +3.0° attack / 140 mph ball / 1.48 smash / 13.2° launch / 2,611 rpm / 218 yds carry. **Average male amateur driver ≈ 93 mph** (optimal launch ~16° at ~2,550 rpm for that speed). This table is the source for all DAT/DAT-club ideals below.

---

## DELIVERABLE 1 — MAIN TAB

Columns: **ID | Name | Category | Club | Weight | Description | Why | Ideal | Bad | Fix**

### MEASURED BALL & SWING DATA (highest causal weight)

**DAT-01 | Clubface Angle at Impact | Wrist/Clubface | Both | 100** — Horizontal pointing direction of the face at impact relative to target. _Why:_ Face angle contributes ~87% of a driver's launch direction and ~81% for a 6-iron/PW (TrackMan Academy) — the single biggest accuracy factor. _Ideal:_ Within ±1° of intended start line; tour players deliver face within ~1° of path. _Bad:_ Face 3–5° open = slices/pushes; closed = hooks/pulls. _Fix:_ Grip check, lead-wrist flexion in transition, alignment-gate face-awareness drills.

**DAT-02 | Smash Factor / Centeredness of Strike | Impact | Both | 99** — Ball speed ÷ club speed; proxy for center contact and energy transfer. _Why:_ At equal club speed, a tour 1.49 driver smash vs. amateur 1.42 is ~6–7 mph ball speed (~15 yds). _Ideal:_ Driver 1.48–1.50; 6-iron 1.38; 7-iron 1.33; PW 1.23. _Bad:_ Off-center toe/heel strikes drop smash and add gear-effect curve. _Fix:_ Foot-spray face check, tee-gate drills.

**DAT-03 | Club Head Speed | Kinematic | Both | 95** — Clubhead speed at impact. _Why:_ Primary determinant of potential distance. _Ideal:_ PGA driver ≈113 mph, 6-iron ≈92 mph, PW ≈83 mph; LPGA driver ≈94 mph. _Bad:_ Amateur ≈93 mph driver, ~20 mph short of tour. _Fix:_ Improve sequence, speed training, ground force.

**DAT-04 | Ball Speed | Ball Data | Both | 94** — Ball speed immediately post-impact. _Why:_ Strongest single correlate of carry. _Ideal:_ PGA driver ≈167 mph, 6-iron ≈127, 7-iron ≈120, PW ≈102. _Bad:_ Amateur driver 125–145 mph. _Fix:_ Raise club speed and smash together.

**DAT-05 | Attack Angle (Driver) | Impact | Driver | 92** — Vertical clubhead direction at impact. _Why:_ Positive AoA optimizes launch/spin for max carry. _Ideal:_ +1° to +5° up (fitter target); classic table shows −1.3° but optimal is positive. _Bad:_ Amateurs −2° to −4°, adding spin, losing 20+ yds. _Fix:_ Ball off lead heel, tilt spine away, tee higher.

**DAT-06 | Attack Angle (Irons) | Impact | Irons | 92** — Vertical clubhead direction for irons. _Why:_ Descending blow compresses ball (ball-first-then-turf). _Ideal:_ 6-iron −4.1°, 7-iron −4.3°, PW −5.0°. _Bad:_ Hitting up = thin/fat, floaty. _Fix:_ Ball center/back, forward shaft lean, pressure forward.

**DAT-07 | Club Path | Swing Plane/Path | Both | 88** — Horizontal clubhead travel direction at impact vs target. _Why:_ With face, sets curvature. _Ideal:_ Irons −2° to +2°; driver often +1° to +4° in-to-out to match upward AoA. _Bad:_ Out-to-in + open face = slice; large in-to-out + closed = hook. _Fix:_ Shallowing, transition sequencing.

**DAT-08 | Face-to-Path | Wrist/Clubface | Both | 90** — Difference between face angle and path; governs curve. _Why:_ The gradient creates draw/fade; small predictable curve beats "straight." _Ideal:_ Keep within 1–3°. _Bad:_ 4°+ gap = big slice/hook, two-way miss. _Fix:_ Match face and path directions.

**DAT-09 | Dynamic Loft (Driver) | Impact | Driver | 78** — Actual loft at impact. _Why:_ Drives launch/spin balance. _Ideal:_ PGA driver ≈12.8°. _Bad:_ Too high balloons; too low drops. _Fix:_ Loft/shaft fit, AoA.

**DAT-10 | Dynamic Loft (Irons) | Impact | Irons | 80** — Delivered loft for irons. _Why:_ Determines compression/trajectory. _Ideal:_ 6-iron ≈20.2°. _Bad:_ Flip adds loft, weak flight. _Fix:_ Forward shaft lean, flat/bowed lead wrist.

**DAT-11 | Spin Loft | Impact | Both | 82** — Dynamic loft minus attack angle; controls compression/spin. _Why:_ Small spin-loft = efficient transfer, lower spin. _Ideal:_ Driver ~11–13°, keeping driver spin ~2,000–2,600 rpm. _Bad:_ Steep + high loft = excess spin. _Fix:_ Shallow driver AoA, cover the ball on irons.

**DAT-12 | Spin Rate (Driver) | Ball Data | Driver | 85** — Backspin rpm. _Why:_ Governs lift/carry. _Ideal:_ PGA driver ~2,545–2,686 rpm (optimizer ~2,200–2,600). _Bad:_ Amateur >3,000 rpm, losing 15–25 yds. _Fix:_ Lower spin loft, center/high-face strike.

**DAT-13 | Spin Rate (Irons) | Ball Data | Irons | 78** — Backspin rpm for irons. _Why:_ Controls stopping power. _Ideal:_ 6-iron ≈6,231, 7-iron ≈7,097, PW ≈9,304 rpm. _Bad:_ <5,500 (7i) floaty; >7,500 balloons. _Fix:_ Clean strike, proper spin loft.

**DAT-14 | Launch Angle (Driver) | Ball Data | Driver | 84** — Vertical launch. _Why:_ With spin sets carry-optimal trajectory. _Ideal:_ PGA driver ≈10.9° (optimizer ~13–14° at 94 mph; ~16° for average amateur). _Bad:_ Low launch + high spin = short. _Fix:_ Ball forward, positive AoA.

**DAT-15 | Launch Angle (Irons) | Ball Data | Irons | 76** — Vertical launch for irons. _Ideal:_ 6-iron ≈14.1°, 7-iron ≈16.3°, PW ≈24.2°. _Bad:_ Too high (flip)/too low (deloft). _Fix:_ Correct dynamic loft.

**DAT-16 | Swing Plane | Swing Plane/Path | Both | 60** — Vertical plane angle of clubhead path. _Why:_ Consistent plane aids centered strike. _Ideal:_ Player-dependent (driver flatter, irons steeper); prioritize consistency. _Bad:_ Varying plane = dispersion. _Fix:_ Plane board.

**DAT-17 | Swing Direction | Swing Plane/Path | Both | 55** — Horizontal orientation of swing plane. _Why:_ On a ~45° plane, AoA + path relate to swing direction. _Ideal:_ Match to intended shape. _Fix:_ Sequencing.

**DAT-18 | Low Point (Irons) | Impact | Irons | 80** — Arc bottom vs ball. _Why:_ Low point 2–4 inches ahead = ball-first. _Ideal:_ Divot starts after ball. _Bad:_ Low point behind = fat/thin. _Fix:_ Pressure forward, towel-behind-ball drill.

**DAT-19 | Low Point (Driver) | Impact | Driver | 72** — Arc bottom for driver. _Ideal:_ Behind teed ball so club ascends into it. _Bad:_ Ahead = downward hit, high spin. _Fix:_ Ball off lead heel, stay behind.

**DAT-20 | Impact Location — Horizontal (toe/heel) | Impact | Both | 86** — Left-right face contact. _Why:_ Gear effect + smash loss. _Ideal:_ Center/slightly toward center, consistent. _Bad:_ Chronic heel (shank/slice) or toe. _Fix:_ Foot-spray, gate drills, setup distance.

**DAT-21 | Impact Location — Vertical (high/low) | Impact | Both | 82** — High vs low on face. _Why:_ Vertical gear effect on driver changes spin/launch. _Ideal:_ Driver slightly above center (low-spin/high-launch); irons center. _Bad:_ Low-face driver strikes balloon. _Fix:_ Tee height, AoA.

**DAT-22 | Lie Angle at Impact | Impact | Irons | 55** — Dynamic sole angle (toe up/down). _Why:_ Affects face pointing/start direction. _Ideal:_ Sole roughly level; club fit to lie. _Bad:_ Toe-down pulls; toe-up pushes. _Fix:_ Lie fitting, posture.

**DAT-23 | Shaft Lean at Impact (Irons) | Impact | Irons | 84** — Forward shaft lean vs vertical. _Why:_ Delofts face, compresses ball. _Ideal:_ 7-iron ~6–9° forward; PW ~10–14°. _Bad:_ Backward lean/flip = thin/fat, weak. _Fix:_ Pressure forward, flat/bowed wrist, impact-bag drill.

**DAT-24 | Shaft Lean at Impact (Driver) | Impact | Driver | 60** — Shaft angle at impact. _Ideal:_ Near-vertical or slightly behind (for positive AoA). _Bad:_ Big forward lean delofts, kills launch. _Fix:_ Ball forward, stay behind.

**DAT-25 | Carry Distance | Ball Data | Both | 75** — Airborne distance. _Ideal:_ PGA driver ≈275 yds, 6-iron ≈183, 7-iron ≈172, PW ≈136; LPGA driver ≈218. _Bad:_ Well short of speed potential = poor launch/strike. _Fix:_ Optimize launch conditions.

**DAT-26 | Total Distance | Ball Data | Both | 60** — Carry + roll. _Ideal:_ PGA driver ~300.2 yds total (2024). _Bad:_ Excess spin cuts roll. _Fix:_ Launch optimization.

**DAT-27 | Apex / Peak Height | Ball Data | Both | 55** — Max trajectory height. _Ideal:_ PGA driver ≈32 yds, 6-iron ≈30, 7-iron ≈32, PW ≈29. _Bad:_ Ballooning or knuckleball. _Fix:_ Spin/loft control.

**DAT-28 | Descent / Land Angle | Ball Data | Both | 58** — Descent angle to ground. _Why:_ Stopping power on approach. _Ideal:_ PGA driver ≈38°, 6-iron ≈50°, 7-iron ≈50°, PW ≈52°. _Bad:_ Shallow iron descent won't hold greens. _Fix:_ Raise launch/spin.

**DAT-29 | Spin Axis / Curvature | Ball Data | Both | 70** — Tilt of spin axis governing curve. _Ideal:_ Near 0° or small controlled tilt (±3–5°). _Bad:_ Large tilt from off-center/big face-to-path. _Fix:_ Center strike, face-to-path control.

**DAT-30 | Offline / Side Distance | Ball Data | Both | 62** — Finish left/right of target. _Ideal:_ Tight, minimal offline. _Bad:_ Large offline from face/path errors. _Fix:_ Face-control priority.

**DAT-31 | Dispersion (Shot Pattern) | Ball Data | Both | 68** — Spread/consistency. _Why:_ Consistency beats one perfect shot. _Ideal:_ Tight left-right and distance clustering. _Bad:_ Two-way miss. _Fix:_ Repeatable face/path, tempo.

### KINEMATIC SEQUENCE & TEMPO

**SEQ-01 | Kinematic Sequence Order | Kinematic | Both | 92** — Downswing peak-speed order pelvis → thorax → lead arm → club. _Why:_ Proximal-to-distal sequencing transfers energy for max speed; every tour pro shares it. _Ideal:_ Each segment peaks faster and later, decelerating to pass energy on. _Bad:_ Amateurs peak arm before thorax (arms-first), over-the-top. _Fix:_ Pump/step-change drills, 3D/pressure feedback.

**SEQ-02 | Tempo Ratio | Kinematic | Both | 78** — Backswing:downswing time ratio. _Why:_ 3:1 keeps sequence smooth, accelerating at impact; universal among great ball strikers. _Ideal:_ ~3:1 (≈0.75 s back / 0.25 s down; total ~1 s). _Bad:_ Amateurs 4:1–5:1, jerky transition. _Fix:_ Metronome/Tour Tempo tones, count "1-2-3 / 1."

**SEQ-03 | Backswing Time | Kinematic | Both | 45** — Backswing duration. _Ideal:_ Per TPI's 3D database, PGA driver backswing averages **0.847 s (±0.111 s SD)**. _Bad:_ >1 s slow/snatchy. _Fix:_ Tempo training.

**SEQ-04 | Downswing Time | Kinematic | Both | 48** — Transition-to-impact duration. _Ideal:_ ≈0.264 s (Tour Tempo/Grober research). _Bad:_ Rushed <0.2 s or slow. _Fix:_ Tempo tones.

**SEQ-05 | Transition Sequence | Transition | Both | 85** — Lower body initiates while upper body finishes backswing. _Why:_ Creates X-Factor stretch; ~70% of tour players rotate hips first. _Ideal:_ Pelvis reverses first, then thorax, arm, club. _Bad:_ Upper-body/arm-first = over the top. _Fix:_ Pump drill, pressure shift.

**SEQ-06 | Total Swing Time | Kinematic | Both | 30** — Address to impact. _Ideal:_ ~1.0–1.1 s. _Bad:_ Highly variable. _Fix:_ Rhythm work.

**SEQ-07 | Pelvis Peak Rotational Velocity | Body Rotation | Both | 65** — Peak hip angular speed in downswing. _Why:_ First/foundational peak; pelvic velocity at impact differentiates pros (reduced in amateurs, p=0.019). _Ideal:_ Peaks early in downswing then decelerates; highly repeatable (downswing pelvic COV=0.079 in pros). _Bad:_ Low/late, high variability. _Fix:_ Ground force, lower-body drills.

**SEQ-08 | Thorax Peak Rotational Velocity | Body Rotation | Both | 62** — Peak torso angular speed. _Why:_ Second peak; in pros peaks after impact in follow-through (upper-torso COV=0.086). _Ideal:_ Higher and later than pelvis. _Bad:_ Reduced/early in amateurs. _Fix:_ Separation drills.

**SEQ-09 | Lead Arm Peak Velocity | Body Rotation | Both | 55** — Peak arm angular speed. _Ideal:_ Peaks after thorax, before club. _Bad:_ Arm peaks before thorax (casting). _Fix:_ Sequencing.

**SEQ-10 | Hand Speed Peak | Kinematic | Both | 55** — Hand-speed timing. _Ideal:_ Overall peak velocity near impact. _Bad:_ Peak too early. _Fix:_ Lag drills.

**SEQ-11 | Clubhead Speed Peak Timing | Kinematic | Both | 70** — When club reaches max speed. _Ideal:_ Peak at impact. _Bad:_ Peak before ball (cast). _Fix:_ Release timing, lag.

### BODY ROTATION & SEPARATION (X-FACTOR)

**ROT-01 | X-Factor at Top | Body Rotation | Both | 72** — Shoulder-minus-hip turn differential at top. _Why:_ Stretches obliques (stretch-shortening cycle), stores power. _Ideal:_ ~40–45° (tour avg 45°; TPI ~42°). _Bad:_ Too little = no coil; excessive = injury with no benefit. _Fix:_ Resist hips, full shoulder turn.

**ROT-02 | X-Factor Stretch | Body Rotation | Both | 75** — Increase in separation at start of downswing. _Why:_ Per Cheetham et al. (2000), skilled golfers increased X-Factor at downswing initiation by **19% vs 13%** for less-skilled (group × position interaction F₁,₁₇=6.90, p=0.02), while X-Factor at top differed only 11% (not significant, p=0.326) — stretch matters more than the static value. _Ideal:_ ~5° increase (hips lead, shoulders stay). _Bad:_ ~0.5° (unwind together). _Fix:_ Hips-first, pump drill.

**ROT-03 | Shoulder (Thorax) Turn at Top | Body Rotation | Both | 68** — Upper-body rotation at top. _Ideal:_ ~90° for a full turn. _Bad:_ <80° restricted; over-rotation loses control. _Fix:_ Thoracic mobility.

**ROT-04 | Hip (Pelvis) Turn at Top | Body Rotation | Both | 62** — Pelvis rotation at top. _Ideal:_ ~45° (enables ~45° X-Factor). _Bad:_ Over-turning loses coil. _Fix:_ Trail-leg stability.

**ROT-05 | Hip Turn at Impact | Body Rotation | Both | 65** — Pelvis open to target at impact. _Why:_ Cleared hips create room/speed. _Ideal:_ ~35–45° open. _Bad:_ Stalled/closed = flip/blocks. _Fix:_ Hip clearing.

**ROT-06 | Shoulder Turn at Impact | Body Rotation | Both | 55** — Chest orientation at impact. _Ideal:_ ~20–30° open. _Bad:_ Too open (spin-out) or closed. _Fix:_ Sequencing.

**ROT-07 | Pelvis Sway (lateral) | Lower Body | Both | 60** — Lateral pelvis translation. _Ideal:_ Small trail-side load (<1–2 inches; early loading <1 inch). _Bad:_ Excessive slide off ball. _Fix:_ Rotate not slide.

**ROT-08 | Pelvis Thrust / Early Extension | Faults | Both | 78** — Pelvis toward ball in downswing. _Why:_ TPI's most common amateur fault; ruins path, causes blocks/hooks. _Ideal:_ Pelvis moves back/up. _Bad:_ Hips thrust toward ball, hands trapped. _Fix:_ Maintain hinge, chair drill, glutes.

**ROT-09 | Pelvis Lift (vertical) | Lower Body | Both | 50** — Vertical pelvis rise. _Ideal:_ Controlled late-downswing rise (extension for speed). _Bad:_ Early stand-up (loss of posture). _Fix:_ Posture retention.

**ROT-10 | Thorax Sway/Lift | Body Rotation | Both | 45** — Upper-body lateral/vertical shift. _Ideal:_ Minimal, stays over ball. _Bad:_ Reverse spine or hang-back. _Fix:_ Centered turn.

### GRIP

**GRP-01 | Grip Strength (Hand Rotation) | Grip | Both | 80** — Neutral/strong/weak hand orientation. _Why:_ Sets clubface tendency; a first-fix for ball flight. _Ideal:_ Neutral to slightly strong; ~2–2.5 knuckles of lead hand visible, both V's toward trail shoulder/right ear. _Bad:_ Weak (1 knuckle, V's to chin) = slice; overly strong = hook. _Fix:_ Reset in mirror.

**GRP-02 | Grip Placement (Fingers vs Palm) | Grip | Both | 65** — Club across fingers of lead hand. _Why:_ Enables hinge/control. _Ideal:_ Diagonal across base of fingers, pad on top, hold mostly in last three fingers. _Bad:_ In palm = restricted hinge. _Fix:_ Re-seat in fingers.

**GRP-03 | Grip Pressure | Grip | Both | 55** — Firmness of hold. _Why:_ Tension restricts speed/release. _Ideal:_ ~4–5/10, firm but tension-free. _Bad:_ 9–10 tension; 1–2 unstable face. _Fix:_ "Baby bird" feel, pressure ladder.

**GRP-04 | Grip Type (Vardon/Interlock/10-finger) | Grip | Both | 30** — How hands link. _Ideal:_ Overlap or interlock; hands as a unit. _Bad:_ Gap/battle. _Fix:_ Connect hands.

**GRP-05 | Hand Unity / Lifeline | Grip | Both | 35** — Trail palm lifeline covers lead thumb, no gap. _Ideal:_ Snug/unified, trail thumb just left of center. _Bad:_ Separated hands. _Fix:_ Seat hands together.

### SETUP & ADDRESS POSTURE

**SET-01 | Spine Forward Bend at Address | Setup | Both | 70** — Forward tilt from vertical (hip hinge). _Why:_ Sets plane and rotation room; tour retain it. _Ideal:_ ~35–45° from vertical (tour ~40° forward shoulder tilt), bend from hips not waist. _Bad:_ Waist bend rounds back; too upright/bent. _Fix:_ Club-on-spine drill.

**SET-02 | Knee Flex at Address | Setup | Both | 55** — Knee bend. _Ideal:_ ~20–30°, weight on balls of feet. _Bad:_ Locked (no turn) or squatting. _Fix:_ Athletic "ready" feel.

**SET-03 | Secondary Axis Tilt (Driver) | Setup | Driver | 72** — Spine tilt away from target at address. _Why:_ Positions body behind ball for upward strike. _Ideal:_ Noticeable tilt (spine ~81° from horizontal — more than iron because stance is wider), trail shoulder lower, head behind ball. _Bad:_ No tilt = steep driver, low launch. _Fix:_ Bump hips toward target, drop trail shoulder ("reverse K").

**SET-04 | Secondary Axis Tilt (Irons) | Setup | Irons | 58** — Slight spine tilt away for irons. _Ideal:_ Slight tilt (~5–10°), spine ~89°/near neutral, sternum over/just behind ball. _Bad:_ Excess tilt = early release/fat. _Fix:_ Neutral setup.

**SET-05 | Arm Hang / Elbows Under Shoulders | Setup | Both | 50** — Arms hang beneath shoulders. _Ideal:_ Relaxed, hands under chin, slight elbow bend. _Bad:_ Reaching/too close. _Fix:_ Let arms hang from posture.

**SET-06 | Chin-Over-Midfoot Stacking (Plumb Line) | Setup | Both | 60** — Vertical alignment of chin/shoulders down through mid-foot/balls of feet. _Why:_ Balanced athletic stack over base of support. _Ideal:_ Plumb line from chin/shoulder line to balls of feet, ~90° to ground; weight on balls of feet. _Bad:_ Chin behind heels (too upright) or past toes (falling forward). _Fix:_ Balance/plumb-line mirror drill.

**SET-07 | Weight Distribution at Address (Irons) | Setup | Irons | 55** — Lead/trail split. _Ideal:_ ~55/45 favoring lead (some to 60/40). _Bad:_ Weight back = fat/thin/reverse pivot. _Fix:_ Slight lead pressure.

**SET-08 | Weight Distribution at Address (Driver) | Setup | Driver | 52** — Split for driver. _Ideal:_ ~55/45 favoring trail (or 60/40), head behind ball. _Bad:_ Too forward = downward hit. _Fix:_ Set behind ball.

**SET-09 | Head Position at Address | Setup/Head | Both | 45** — Head in line with spine, behind ball. _Ideal:_ Head behind ball, neck in line with spine. _Bad:_ Chin on chest restricts turn. _Fix:_ Chin up.

**SET-10 | Posture Type (avoid S/C) | Setup | Both | 58** — Neutral vs S-posture (excess lumbar arch) or C-posture (rounded). _Why:_ TPI faults limiting rotation, causing back stress and downstream faults. _Ideal:_ Neutral spine, slight lumbar curve. _Bad:_ S-posture (tail out/arch) or C-posture (rounded). _Fix:_ Core engagement, neutral pelvis.

### ALIGNMENT & AIM

**ALN-01 | Feet/Hip/Shoulder Alignment | Alignment | Both | 62** — Body lines parallel-left of target line. _Why:_ Sets swing direction. _Ideal:_ Feet/hips/shoulders parallel to target line. _Bad:_ Open (slices/pulls) or closed. _Fix:_ Alignment sticks.

**ALN-02 | Clubface Aim at Address | Alignment | Both | 55** — Face pointing at address. _Why:_ Influences (not controls) impact face. _Ideal:_ Square to start line. _Bad:_ Aimed off then compensating. _Fix:_ Aim face first, then body.

**ALN-03 | Shoulder Alignment (specific) | Alignment | Both | 58** — Shoulder-line direction. _Why:_ Most correlated with path/start; open shoulders cause over-the-top. _Ideal:_ Parallel to target line (slightly closed OK for draw). _Bad:_ Open = out-to-in/slice. _Fix:_ Club-across-chest check.

### BALL POSITION & STANCE WIDTH

**BAL-01 | Ball Position (Driver) | Ball Position | Driver | 72** — Front-back location. _Why:_ Forward position lets club ascend (positive AoA). _Ideal:_ Off inside of lead heel (up to lead big toe). _Bad:_ Central = steep, low launch, more curve. _Fix:_ Position off lead heel.

**BAL-02 | Ball Position (Irons) | Ball Position | Irons | 68** — Iron location. _Why:_ Governs low-point/descending strike. _Ideal:_ Short irons center; mid-irons ~1 ball forward; long irons ~2 inches inside lead heel. _Bad:_ Too forward = thin/pull; too far back = fat/low. _Fix:_ Progressive positioning.

**BAL-03 | Stance Width (Driver) | Stance | Driver | 55** — Feet spacing. _Ideal:_ Shoulder-width plus (trail heel just outside shoulder). _Bad:_ Too wide restricts rotation. _Fix:_ Widen slightly.

**BAL-04 | Stance Width (Irons) | Stance | Irons | 50** — Iron width. _Ideal:_ ~Shoulder-width (trail heel under trail shoulder), narrower for short irons. _Bad:_ Too wide/narrow. _Fix:_ Shoulder-width baseline.

**BAL-05 | Foot Flare (Lead) | Stance | Both | 40** — Lead toe turnout. _Why:_ Aids lead-hip clearance. _Ideal:_ ~15–20° open. _Bad:_ Square restricts clearing. _Fix:_ Flare open.

**BAL-06 | Foot Flare (Trail) | Stance | Both | 35** — Trail toe turnout. _Why:_ Controls turn/load. _Ideal:_ ~5–10° (near square helps resist over-turn). _Bad:_ Excess flare loses coil. _Fix:_ Near-square.

### TAKEAWAY

**TKA-01 | One-Piece Takeaway | Takeaway | Both | 58** — Hands/arms/shoulders/club move together first 18–24". _Why:_ Sets plane/width, syncs sequence. _Ideal:_ Triangle intact, clubhead outside hands, low and wide, minimal early wrist. _Bad:_ Snatchy inside/outside, early roll. _Fix:_ Takeaway gate.

**TKA-02 | Clubface in Takeaway | Wrist/Clubface | Both | 55** — Face when shaft parallel. _Ideal:_ Toe-up to slightly closed; leading edge ~parallel to spine angle. _Bad:_ Fanning open or shut. _Fix:_ Check at parallel.

**TKA-03 | Takeaway Path/Width | Takeaway | Both | 50** — Direction/width of club. _Ideal:_ Slightly inside on plane, wide arc. _Bad:_ Too inside (behind) or outside. _Fix:_ Plane board.

### BACKSWING

**BKS-01 | Lead Arm Structure | Backswing | Both | 55** — Lead arm relatively straight. _Why:_ Maintains radius/width. _Ideal:_ Comfortably extended (not locked). _Bad:_ Overly bent loses width. _Fix:_ Width drills.

**BKS-02 | Swing Plane in Backswing | Swing Plane | Both | 58** — Shaft plane going back. _Ideal:_ On plane at checkpoints, shaft parallel to target line. _Bad:_ Too flat/upright, crossing the line. _Fix:_ Plane board.

**BKS-03 | Width / Radius Maintenance | Backswing | Both | 52** — Hands/club distance from body. _Ideal:_ Maintained width, trail arm folds late. _Bad:_ Narrow/collapsed. _Fix:_ Wide-takeaway feel.

**BKS-04 | Connection (Arms-Body) | Backswing | Both | 55** — Arms connected to torso. _Ideal:_ Lead arm across chest, trail elbow in front. _Bad:_ Arms lift, flying elbow. _Fix:_ Towel-under-arm drill.

**BKS-05 | Trail Hip Load / Coil | Backswing | Both | 60** — Loading into trail hip. _Why:_ Real power source (deep coil). _Ideal:_ Load into inside of trail leg, glute engaged, minimal sway. _Bad:_ Sway to outside trail foot, reverse pivot. _Fix:_ Load-into-glute drill.

### TOP OF BACKSWING

**TOP-01 | Lead Wrist Condition at Top | Wrist/Clubface | Both | 78** — Flexion (bowed)/flat/extension (cupped). _Why:_ Whatever the wrist does, the face follows; flat/slightly bowed = square. _Ideal:_ Flat to slightly bowed; tour flexion avg ~ −14° (DJ extreme ~ −45°, not to be copied). _Bad:_ Cupped/extended = open face, slice. _Fix:_ Flatten/bow lead wrist, HackMotion feedback.

**TOP-02 | Trail Elbow Position at Top | Backswing | Both | 55** — Trail elbow flex/location. _Ideal:_ Points down, ~90° flex, in front of body. _Bad:_ Flying elbow (elevated) = across-the-line, steep. _Fix:_ Elbow-down feel.

**TOP-03 | Club at Top (Length/Cross) | Top | Both | 45** — Shaft position at top. _Ideal:_ ~Parallel to target line (or slightly short). _Bad:_ Across the line/laid off. _Fix:_ Checkpoints.

**TOP-04 | Completion of Backswing | Top | Both | 42** — Turn completes before transition. _Ideal:_ Full turn, brief change of direction. _Bad:_ Reversing before completion. _Fix:_ Tempo.

### TRANSITION

**TRN-01 | Lower-Body-First Sequencing | Transition | Both | 85** — Hips/pressure start down before arms. _Why:_ Creates X-Factor stretch and correct sequence. _Ideal:_ Pressure to lead foot and pelvis rotates while club finishing back. _Bad:_ Arms/shoulders first = over the top. _Fix:_ Pump/step drills.

**TRN-02 | Pressure Shift Timing | Ground Forces | Both | 80** — When pressure moves to lead foot. _Why:_ High-speed players shift to lead before club reaches top; sets low point forward. _Ideal:_ Moving forward in transition, ~52% off trail early down. _Bad:_ Hanging back, late/no shift. _Fix:_ Pressure-plate feedback, step drill.

**TRN-03 | Shallowing / Path from Top | Transition | Both | 72** — Club shallows onto plane. _Why:_ Prevents over-the-top; delivers from inside. _Ideal:_ Shaft shallows into slot, trail elbow in front. _Bad:_ Steepening/over-the-top = pull/slice. _Fix:_ Pump drill.

### DOWNSWING

**DSW-01 | Lag / Wrist Angle Retention | Wrist/Clubface | Both | 75** — Lead-arm-to-shaft angle retained. _Why:_ Stores speed for late release. _Ideal:_ Maintain lag deep, release late through impact. _Bad:_ Casting/early release = speed loss, high dynamic loft, scoop. _Fix:_ Pump drill, pressure-handle drill.

**DSW-02 | Delivery Position (Lead Arm Parallel) | Downswing | Both | 70** — Club/body at lead-arm-parallel down. _Ideal:_ Shaft on plane, trail elbow in front, face square-to-slightly-closed to path. _Bad:_ Steep/across, face open. _Fix:_ Slot drill.

**DSW-03 | Hip Clearing / Rotation | Lower Body | Both | 70** — Lead hip rotating open/back. _Why:_ Creates room, avoids early extension. _Ideal:_ Pelvis ~35–45° open at impact. _Bad:_ Hips stall/thrust = flip/blocks. _Fix:_ Wall drill.

**DSW-04 | Maintain Posture (Spine Angle) | Downswing | Both | 68** — Retaining address angles. _Why:_ Loss of posture/early extension is a top amateur fault. _Ideal:_ Retain forward bend + secondary tilt until post-impact. _Bad:_ Standing up = fat/thin/blocks. _Fix:_ Chair drill, glute activation.

### IMPACT / MOMENT OF TRUTH

**IMP-01 | Flat/Bowed Lead Wrist at Impact | Wrist/Clubface | Both | 88** — Wrist condition at strike. _Why:_ Controls face and shaft lean; flat-to-flexed = square face + compression. _Ideal:_ Flat to slightly flexed/bowed (HackMotion ~11–15° flexion feel). _Bad:_ Cupped = flip, added loft, thin/weak. _Fix:_ Impact-bag, flexion drills.

**IMP-02 | Hands Ahead of Ball (Irons) | Impact | Irons | 82** — Handle forward of clubhead. _Why:_ Ensures ball-first, compression, correct dynamic loft. _Ideal:_ Hands several inches ahead, 6–9° shaft lean (7-iron). _Bad:_ Hands behind (flip) = scoop, fat/thin. _Fix:_ Pressure forward, impact drills.

**IMP-03 | Head/Chest Behind Ball at Impact | Impact | Both | 55** — Upper body behind ball. _Ideal:_ Head behind ball (esp. driver), slight secondary tilt retained. _Bad:_ Head/chest past ball early = steep/weak. _Fix:_ Stay-behind feel.

**IMP-04 | Weight/Pressure at Impact | Ground Forces | Both | 78** — Lead-foot pressure. _Why:_ Forward pressure = ball-first, low point forward. _Ideal:_ ~80–90% lead foot (irons), pressure into lead heel/ball of foot. _Bad:_ Hanging back (<60% lead) = fat/thin/scoop. _Fix:_ Pressure-plate work, step drill.

**IMP-05 | Impact Hip/Shoulder Openness | Impact | Both | 60** — Body openness at impact. _Ideal:_ Hips ~35–45° open, shoulders ~20–30° open. _Bad:_ Square/closed (flip) or over-open (spin-out). _Fix:_ Rotation drills.

### RELEASE & EXTENSION

**REL-01 | Release Type / Timing | Release | Both | 65** — How face squares/rotates through impact. _Ideal:_ Full, late release; forearms rotate naturally, no manipulation. _Bad:_ Early release (cast/flip) or held-off block. _Fix:_ Swoosh drill.

**REL-02 | Clubface Closure Rate | Wrist/Clubface | Both | 62** — Rate face rotates closed through impact. _Why:_ Too fast = hooks, too slow = pushes/slices. _Ideal:_ Consistent, moderate closure matched to path. _Bad:_ Flippy fast closure or stalled. _Fix:_ Body-driven release, stable lead wrist.

**REL-03 | Extension Through Impact (Width) | Release | Both | 55** — Arms extend post-impact. _Why:_ Wide extended release = speed and centered strike. _Ideal:_ Both arms extend down the line, wide arc. _Bad:_ Chicken wing = loss of speed, open face, thin. _Fix:_ Extension drills.

**REL-04 | Chicken Wing (Fault) | Faults | Both | 60** — Lead elbow bending/pulling out post-impact. _Why:_ TPI fault; scoops, loss of width/speed. _Ideal:_ Absence; extended lead arm. _Bad:_ Bent lead elbow, cupped wrist. _Fix:_ Rotate body through.

### FOLLOW-THROUGH & FINISH

**FIN-01 | Balanced Finish | Finish | Both | 45** — Full balanced finish over lead side. _Ideal:_ ~95% lead foot, chest to target, trail toe down, held balance. _Bad:_ Falling back/off balance. _Fix:_ Hold-finish drill.

**FIN-02 | Full Rotation to Target | Finish | Both | 40** — Body fully rotated through. _Ideal:_ Belt buckle/chest facing target or beyond. _Bad:_ Incomplete = deceleration/blocks. _Fix:_ Rotate fully.

**FIN-03 | Trail Shoulder Toward Target | Finish | Both | 35** — Trail shoulder closest to target. _Ideal:_ Points at target, head up. _Bad:_ Hanging back. _Fix:_ Full through-rotation.

### WEIGHT SHIFT / PRESSURE & GROUND FORCES

**GRF-01 | Vertical Ground Reaction Force Peak | Ground Forces | Driver | 68** — Peak vertical force vs body weight. _Why:_ Late-downswing vertical GRF increases clubhead speed (long hitters "jump"). _Ideal:_ Peaks between lead-arm-parallel and shaft-parallel down; elite driver examples 150–280%+ body weight, but timing matters more than magnitude. _Bad:_ Peak at/after impact (mistimed) = speed leak; double-peaks linked anecdotally to back stress. _Fix:_ Force-plate feedback, jump/squat-sequence drills.

**GRF-02 | GRF Peak Timing / Sequence | Ground Forces | Both | 70** — Order of force peaks. _Why:_ Nearly identical order in best players. _Ideal:_ Horizontal (lateral shear) first, then rotational torque, then vertical — all before impact. _Bad:_ Forces peaking at/after impact. _Fix:_ Sequence adjustments (documented ~5 mph gains).

**GRF-03 | Horizontal / Lateral Shear Force | Ground Forces | Both | 60** — Horizontal push against ground. _Why:_ Among strongest predictors of clubhead speed. _Ideal:_ Strong toward-target shear in transition. _Bad:_ Weak/mistimed. _Fix:_ Pressure-shift/push drills.

**GRF-04 | Center of Pressure (COP) Path | Ground Forces | Both | 62** — Trace of pressure center. _Why:_ Smooth forward-moving trace = efficient sequencing/balance. _Ideal:_ Centered → trail (backswing) → smoothly to lead ball-of-foot by impact. _Bad:_ Erratic/backward trace, toward heels. _Fix:_ Pressure-plate visualization.

**GRF-05 | Pressure at Address | Ground Forces | Both | 48** — Foot split at setup. _Ideal:_ ~55/45 lead (irons); ~55/45 trail (driver). _Bad:_ Big trail bias with irons. _Fix:_ Slight lead pressure.

**GRF-06 | Pressure at Top | Ground Forces | Both | 55** — Trail-foot pressure at top. _Ideal:_ ~60–80% trail (inside of foot); mass stays more centered (~60% lead in some models). _Bad:_ To outside trail (sway) or reverse. _Fix:_ Load inside trail leg.

**GRF-07 | Pressure Early Downswing | Ground Forces | Both | 65** — Pressure at transition. _Ideal:_ From ~80% to ~52% trail quickly (moving to lead ball-of-foot). _Bad:_ Still on trail. _Fix:_ Start pressure forward before club completes.

**GRF-08 | COP Toe/Heel Position | Ground Forces | Both | 45** — Front/back pressure. _Why:_ Toward balls of feet enables vertical force. _Ideal:_ Toward balls of feet through impact. _Bad:_ On heels = low vertical force. _Fix:_ Balls-of-feet feel.

**GRF-09 | Free Moment / Torque | Ground Forces | Both | 42** — Rotational force into ground. _Why:_ Highly consistent in pros — peak free moment COV **6.8%** (Meister/Rose et al.). _Ideal:_ Well-timed torque before vertical peak. _Bad:_ Mistimed. _Fix:_ Rotate against ground.

### LOWER BODY & FOOTWORK

**LOW-01 | Trail Knee Flex Maintenance | Lower Body | Both | 50** — Retaining flex in backswing. _Ideal:_ Trail knee holds ~20° flex. _Bad:_ Straightens (sway/lift) or over-flexes. _Fix:_ Feel flex maintained.

**LOW-02 | Lead Leg Post / Extension at Impact | Lower Body | Both | 58** — Lead-leg straightening (triple extension) into impact. _Why:_ Braces and adds vertical force/speed. _Ideal:_ Ankle-knee-hip triple extension into/through impact. _Bad:_ Lead knee stays bent (no post) = speed leak. _Fix:_ Post-up drill.

**LOW-03 | Trail Heel Behavior | Lower Body | Both | 35** — Trail heel lifting. _Ideal:_ Releases up as pressure moves to lead, rolls to inside then toe. _Bad:_ Flat trail foot (no shift) or early spin. _Fix:_ Pressure sequencing.

**LOW-04 | Knee Shift (front view) | Lower Body | Both | 40** — Lateral knee movement. _Ideal:_ Small, mostly rotational. _Bad:_ Big lateral slide (sway/slide). _Fix:_ Rotate in a barrel.

### HEAD & EYE CONTROL

**HED-01 | Head Lateral Movement | Head/Eye | Both | 45** — Side-to-side head motion. _Ideal:_ Minimal (≤~2 inches; slight away-from-target OK). _Bad:_ Big slide toward target (early) or away (sway). _Fix:_ Head-against-wall/centered drill.

**HED-02 | Head Vertical Movement | Head/Eye | Both | 42** — Up/down head motion. _Ideal:_ Stable height; slight lowering OK, no early rise. _Bad:_ Standing up (early extension). _Fix:_ Maintain posture.

**HED-03 | Eyes on Ball / Chin Position | Head/Eye | Both | 30** — Eyes on ball, chin up off chest. _Ideal:_ Chin up enough for lead shoulder to pass under. _Bad:_ Chin buried restricts turn; lifting early. _Fix:_ Chin-up setup.

### COMMON FAULTS / COMPENSATIONS (TPI + ball-flight)

**FLT-01 | Over-the-Top | Faults | Both | 78** — Club moves outside/steep, out-to-in path. _Why:_ Leading cause of slices/pulls. _Ideal:_ Absence — in-to-square path. _Bad:_ Pull-slice. _Fix:_ Shallow, lower-body-first, pump drill.

**FLT-02 | Early Extension | Faults | Both | 80** — Hips/pelvis thrust toward ball, standing up. _Why:_ Most common amateur fault (TPI); traps arms, blocks/hooks, thin. _Ideal:_ Maintain hip hinge, pelvis back. _Bad:_ Loss of posture, hands stuck. _Fix:_ Chair/wall drill, glutes.

**FLT-03 | Reverse Spine Angle | Faults | Both | 70** — Upper body leans toward target at top. _Why:_ Cited by TPI as leading contributor to lower-back pain; poor sequence, hanging back. _Ideal:_ Trail-side tilt maintained at top. _Bad:_ Spine tilts toward target at top. _Fix:_ Proper tilt, core control.

**FLT-04 | Sway | Faults | Both | 62** — Excess lateral lower-body move away from target in backswing. _Ideal:_ Load without sway (<1–2"). _Bad:_ Slides off ball, fat/thin. _Fix:_ Rotate into trail hip, barrier stick.

**FLT-05 | Slide | Faults | Both | 58** — Excess lateral lower-body move toward target in downswing. _Ideal:_ Rotate not slide. _Bad:_ Hips slide past, flip/blocks. _Fix:_ Rotational clearing.

**FLT-06 | Hanging Back | Faults | Both | 62** — Weight stays on trail foot through impact. _Why:_ No forward shift = fat/thin/scoops. _Ideal:_ Pressure forward (~80–90% lead at impact). _Bad:_ Trail-foot weight at impact. _Fix:_ Step drill.

**FLT-07 | Casting / Early Release / Scooping | Faults | Both | 72** — Premature release of wrist angles. _Why:_ Wastes lag/speed, adds loft, weak/high. _Ideal:_ Retained lag, late release. _Bad:_ Cast from top, flip at ball. _Fix:_ Pump drill, pressure forward.

**FLT-08 | Flat Shoulder Plane | Faults | Both | 55** — Shoulders turn too horizontally (standing up). _Why:_ TPI fault; leads to over-the-top/steep. _Ideal:_ Shoulders turn on plane tilted to spine. _Bad:_ Level turn. _Fix:_ Turn under, maintain posture.

**FLT-09 | Flying Trail Elbow | Faults | Both | 50** — Trail elbow elevated/away at top. _Why:_ Across-the-line, steep, timing-dependent. _Ideal:_ Trail elbow down/in front. _Bad:_ Elevated elbow. _Fix:_ Connection drills.

**FLT-10 | Loss of Posture | Faults | Both | 70** — Any significant change from address body angles during the swing. _Why:_ Broad TPI fault; ruins consistency/strike. _Ideal:_ Retain setup angles until post-impact. _Bad:_ Standing up/dipping. _Fix:_ Posture-retention drills.

### WRIST MECHANICS & CLUBFACE CONTROL (additional)

**WRS-01 | Wrist Hinge / Set (radial) | Wrist | Both | 58** — Radial deviation setting club. _Ideal:_ Full hinge by top (~90° arm-shaft), set progressively. _Bad:_ No hinge (no lag) or early over-hinge. _Fix:_ Hinge drills.

**WRS-02 | Wrist Ulnar Deviation Release | Wrist | Both | 50** — Un-hinging through impact. _Ideal:_ Retained then released late through impact. _Bad:_ Early un-hinge (cast). _Fix:_ Lag drills.

**WRS-03 | Trail Wrist Extension at Impact | Wrist | Both | 55** — Trail wrist bent back at impact. _Why:_ Complements bowed lead wrist, keeps shaft lean/face square. _Ideal:_ Trail wrist extended ("waiter's tray") at impact. _Bad:_ Trail wrist flexing (flip). _Fix:_ Trail-wrist-back feel.

### PHYSICAL & MOBILITY (as manifested in swing)

**PHY-01 | Hip Mobility / Turn Capacity | Physical | Both | 45** — Ability to rotate/hinge hips. _Why:_ Limits cause early extension/sway (TPI body-swing link). _Ideal:_ Adequate hip rotation for full turn + stable hinge. _Bad:_ Limited → early extension, slide. _Fix:_ TPI screen, mobility work.

**PHY-02 | Thoracic Rotation | Physical | Both | 45** — Upper-back rotational range. _Why:_ Enables shoulder turn/X-Factor. _Ideal:_ Sufficient T-spine rotation for ~90° shoulder turn. _Bad:_ Restricted → flat plane/loss of posture. _Fix:_ T-spine drills.

**PHY-03 | Pelvic Tilt Control (Ant/Post) | Physical | Both | 42** — Setting/maintaining neutral pelvis. _Why:_ S/C-posture roots. _Ideal:_ Neutral pelvis maintained. _Bad:_ Excess anterior (S) or posterior (C) tilt. _Fix:_ Pelvic-tilt drills.

**PHY-04 | Ankle Dorsiflexion / Balance | Physical | Both | 35** — Ankle range and single-leg balance. _Why:_ Ground force and posture (TPI screens flag it). _Ideal:_ Adequate dorsiflexion + balance. _Bad:_ Limited → early extension, balance loss. _Fix:_ Mobility/balance work.

**PHY-05 | Wrist Mobility | Physical | Both | 33** — Wrist flexion/extension range. _Why:_ Enables hinge and bowing. _Ideal:_ Sufficient range. _Bad:_ Restricted → face-control compensation. _Fix:_ Wrist mobility.

### MENTAL / PRE-SHOT ROUTINE (brief)

**MNT-01 | Pre-Shot Routine Consistency | Mental | Both | 40** — Repeatable routine before each shot. _Why:_ Consistency, focus, tempo, pressure management. _Ideal:_ Same routine every time — target, rehearsal, commit. _Bad:_ Rushed/variable, indecision. _Fix:_ Build and repeat a fixed routine.

**MNT-02 | Commitment / Target Focus | Mental | Both | 35** — Clear target, committed swing. _Why:_ Reduces tentative, decelerating swings. _Ideal:_ Specific target, full commitment. _Bad:_ Steering, doubt. _Fix:_ Decide before setup, external focus.

---

## DELIVERABLE 2 — ANGLES TAB

Columns: **ID | Body Part/Segment | Swing Phase | View | Club | Weight | Description | Ideal (degrees ± tolerance) | Bad (degrees + consequence) | Fix**

Views: **FO** = Face-On/Front; **DTL** = Down-the-Line/Directly Behind; **REAR** = Rear/target-side; **OH** = Overhead. (Pressure %/foot rows are noted as FO + force/pressure plate.)

**ANG-01 | Spine forward bend | Address | DTL | Both | 70** — Forward tilt from vertical. Ideal: 35–45° (±5°); tour ~40°. Bad: <30° too upright (steep plane), >48° too bent (balance loss). Fix: Hip hinge, club-on-spine.

**ANG-02 | Spine forward bend retention | Impact | DTL | Both | 68** — Retention of address bend. Ideal: within ~5° of address. Bad: >10° change = early extension, fat/thin. Fix: Posture-retention drills.

**ANG-03 | Secondary axis tilt (spine from vertical, away from target) | Address | FO | Driver | 70** — Side tilt. Ideal: ~10–20° away (spine ~81° from horizontal). Bad: 0° = steep driver, low launch. Fix: Reverse-K setup.

**ANG-04 | Secondary axis tilt | Address | FO | Irons | 55** — Iron side tilt. Ideal: ~5–10° away (spine ~89°/near neutral). Bad: Excess = early release/fat. Fix: Neutral tilt.

**ANG-05 | Secondary axis tilt | Impact | FO | Both | 65** — Side bend at impact. Ideal: ~20–30° (increases from address; more for driver). Bad: Too little = steep; reverse = reverse-spine. Fix: Stay behind, side-bend feel.

**ANG-06 | Hip hinge angle | Address | DTL | Both | 55** — Flexion at hip joints. Ideal: ~30–45°. Bad: Squat/no hinge → posture loss. Fix: Push hips back.

**ANG-07 | Lead knee flex | Address | FO | Both | 50** — Lead knee bend. Ideal: ~20–25° (±5°). Bad: Locked/deep. Fix: Athletic flex.

**ANG-08 | Trail knee flex | Address | FO | Both | 50** — Trail knee bend. Ideal: ~20–25°. Bad: Straight/deep. Fix: Match lead.

**ANG-09 | Trail knee flex retention | Backswing-Top | DTL | Both | 52** — Flex held at top. Ideal: retain ~20° (lose ≤5°). Bad: Straightening = sway/lift. Fix: Hold flex.

**ANG-10 | Lead knee flex | Impact | FO | Both | 55** — Lead knee (posting). Ideal: extending toward straighter, ~10–20°. Bad: Deeply bent = no post, speed leak. Fix: Post-up drill.

**ANG-11 | Ankle dorsiflexion | Address | DTL | Both | 30** — Shin-to-foot angle. Ideal: slight dorsiflexion, weight balls of feet. Bad: Weight on heels. Fix: Balance.

**ANG-12 | Pelvic tilt (ant/post) | Address | DTL | Both | 45** — Pelvis orientation. Ideal: slight anterior/neutral. Bad: Excess anterior (S) or tucked (C). Fix: Neutral pelvis.

**ANG-13 | Pelvis rotation | Backswing-Top | OH | Both | 62** — Hip turn from address. Ideal: ~45° (±5°). Bad: >55° over-turn; <35° restricted. Fix: Allow/limit hip turn.

**ANG-14 | Pelvis rotation | Impact | OH | Both | 65** — Hips open at impact. Ideal: ~35–45° open. Bad: Square/closed = flip/block; over-open = spin-out. Fix: Hip clearing.

**ANG-15 | Thorax/shoulder rotation | Backswing-Top | OH | Both | 68** — Shoulder turn. Ideal: ~90° (±10°). Bad: <80° restricted; excessive loses control. Fix: T-spine turn.

**ANG-16 | Thorax rotation | Impact | OH | Both | 55** — Chest open at impact. Ideal: ~20–30° open. Bad: Closed/too open. Fix: Sequencing.

**ANG-17 | X-Factor (shoulder-hip separation) | Backswing-Top | OH | Both | 72** — Turn differential. Ideal: ~40–45°. Bad: <30° (no coil); excessive (injury). Fix: Resist hips.

**ANG-18 | X-Factor stretch | Downswing-Top | OH | Both | 72** — Increase in separation at transition. Ideal: +~5° from top value. Bad: ~0.5° (unwind together). Fix: Hips-first.

**ANG-19 | Shoulder plane / tilt vs horizontal | Address | DTL | Both | 55** — Shoulder-line inclination. Ideal: tilted to match spine (trail shoulder lower). Bad: Level = flat shoulder plane. Fix: Tilt with spine.

**ANG-20 | Shoulder plane | Backswing-Top | DTL | Both | 58** — Turn plane at top. Ideal: on plane, ~3° flatter than address, not flattened. Bad: Level/horizontal turn = steep down. Fix: Turn under.

**ANG-21 | Shoulder tilt | Impact | FO | Both | 55** — Shoulder inclination at impact. Ideal: trail shoulder lower (side bend), axis tilt 20–30°. Bad: Level/reversed. Fix: Side-bend.

**ANG-22 | Lead arm to chest/torso angle | Backswing-Top | DTL | Both | 50** — Connection. Ideal: across chest, connected. Bad: Disconnected/lifted. Fix: Connection drill.

**ANG-23 | Lead arm vs shoulder plane | Backswing-Top | DTL | Both | 48** — Arm relative to plane. Ideal: on/just above shoulder plane. Bad: Above (across line) or under (laid off). Fix: Plane checkpoints.

**ANG-24 | Trail elbow flex | Backswing-Top | DTL | Both | 52** — Trail elbow bend at top. Ideal: ~90° (±10°), pointing down/in front. Bad: Flying or fully folded across line. Fix: Elbow-down.

**ANG-25 | Lead wrist flexion/extension | Backswing-Top | DTL | Both | 78** — Cupped vs bowed at top. Ideal: flat to slightly bowed (tour avg ~ −14° flexion). Bad: Cupped/extended = open face, slice. Fix: Flatten/bow lead wrist.

**ANG-26 | Lead wrist flexion/extension | Impact | FO | Both | 85** — Wrist at impact. Ideal: flat to slightly flexed/bowed (~11–15° flexion feel). Bad: Cupped = flip, added loft. Fix: Impact-bag, flexion.

**ANG-27 | Wrist hinge (radial/ulnar) | Backswing-Top | DTL | Both | 55** — Radial cock. Ideal: full set (~90° lead-arm-to-shaft). Bad: No hinge (no lag)/over-cocked. Fix: Hinge drill.

**ANG-28 | Lag angle (lead arm to shaft) | Downswing-Middle | DTL | Both | 70** — Retained wrist angle at delivery. Ideal: retained ~90° deep into downswing at lead-arm-parallel. Bad: Widened/cast = speed loss. Fix: Pump drill.

**ANG-29 | Shaft plane | Address | DTL | Both | 55** — Shaft inclination. Ideal: on plane (fit to lie/height). Bad: Too upright/flat. Fix: Setup posture.

**ANG-30 | Shaft plane | Backswing-Bottom (takeaway, club parallel) | DTL | Both | 60** — Shaft at first parallel. Ideal: parallel to target line, on plane, clubhead outside hands. Bad: Inside/outside. Fix: Takeaway gate.

**ANG-31 | Shaft plane | Backswing-Top | DTL | Both | 55** — Shaft direction at top. Ideal: ~parallel to target line. Bad: Across the line/laid off. Fix: Checkpoints.

**ANG-32 | Shaft plane | Downswing-Middle (delivery) | DTL | Both | 68** — Shaft at lead-arm-parallel down. Ideal: on plane, pointing near ball-target line, shallowed. Bad: Steep/over-the-top or too shallow. Fix: Slot drill.

**ANG-33 | Clubface vs lead forearm/spine | Backswing-Middle (lead arm parallel) | DTL | Both | 60** — Face relative to forearm. Ideal: matches spine angle / square to plane. Bad: Open (fanned)/shut. Fix: Face-control drill.

**ANG-34 | Hand path angle | Downswing | DTL | Both | 45** — Direction hands travel. Ideal: inward/on-plane, not out toward ball. Bad: Out-and-over. Fix: Shallowing.

**ANG-35 | Hip sway/lateral shift | Backswing-Top | FO | Both | 55** — Pelvis lateral translation (in/cm). Ideal: ≤1–2 inches trail-side (early load <1"). Bad: >3 inches = sway. Fix: Rotate in barrel.

**ANG-36 | Hip lateral shift toward target | Downswing | FO | Both | 55** — Pelvis slide toward target. Ideal: small (few cm) then rotate. Bad: Big slide = slide fault. Fix: Rotational clear.

**ANG-37 | Knee shift L-R | Downswing | FO | Both | 42** — Lateral knee movement. Ideal: small, mostly rotational. Bad: Big lateral slide. Fix: Barrel feel.

**ANG-38 | Pressure/weight per foot | Address | FO + pressure plate | Both | 48** — %/foot. Ideal: ~55/45 lead (irons); 55/45 trail (driver). Bad: Heavy trail with irons. Fix: Slight lead pressure.

**ANG-39 | Pressure per foot | Backswing-Top | FO + pressure plate | Both | 55** — %/foot at top. Ideal: ~60–80% trail (inside foot). Bad: Outside trail (sway)/reverse. Fix: Inside-load.

**ANG-40 | Pressure per foot | Downswing-Middle | FO + pressure plate | Both | 62** — %/foot mid-down. Ideal: ~70–80% lead by shaft-parallel down. Bad: Still trail. Fix: Pressure shift.

**ANG-41 | Pressure per foot | Impact | FO + pressure plate | Both | 65** — %/foot at impact. Ideal: ~80–90% lead. Bad: <60% lead = hang-back. Fix: Step drill.

**ANG-42 | Hip slide vs turn ratio | Downswing | FO/OH | Both | 55** — Lateral vs rotational hip motion. Ideal: mostly rotational, small lateral. Bad: Slide-dominant. Fix: Rotate.

**ANG-43 | Head lateral movement | Backswing-Top | FO | Both | 45** — Head shift (in/cm). Ideal: minimal (≤~2"); slight away OK. Bad: Big shift = sway. Fix: Centered drill.

**ANG-44 | Head lateral movement | Impact | FO | Both | 45** — Head vs address. Ideal: behind ball, minimal target-ward drift. Bad: Head past ball = steep. Fix: Stay behind.

**ANG-45 | Head vertical movement | Downswing | FO/DTL | Both | 45** — Up/down head. Ideal: stable (slight drop OK), no early rise. Bad: Standing up. Fix: Posture.

**ANG-46 | Chin over mid-foot plumb line | Address | FO | Both | 60** — Vertical stacking of chin/shoulders over mid-foot/balls of feet. Ideal: plumb line from chin/shoulder to balls of feet, ~90° to ground. Bad: Chin behind heels (upright) or past toes (falling in). Fix: Balance/plumb-line mirror.

**ANG-47 | Chin-over-foot alignment change | Backswing-Top | FO | Both | 45** — Change in stacking at top. Ideal: stays within base of support. Bad: Chin drifts off trail foot (sway). Fix: Centered turn.

**ANG-48 | Posture angle change (loss of posture) | Downswing-Middle | DTL | Both | 68** — Change in spine/hip angles from address. Ideal: ≤~5° change. Bad: >10° (stand-up/early extension). Fix: Chair/wall drill.

**ANG-49 | Stance width vs shoulder width | Address | FO | Driver | 50** — Feet spacing ratio. Ideal: shoulder-width plus (heels ~outside shoulders). Bad: Too wide (no turn)/narrow. Fix: Widen for driver.

**ANG-50 | Stance width vs shoulder width | Address | FO | Irons | 48** — Iron width. Ideal: ~shoulder-width (trail heel under trail shoulder). Bad: Excess/narrow. Fix: Shoulder-width.

**ANG-51 | Lead foot flare | Address | FO/OH | Both | 40** — Lead toe turnout. Ideal: ~15–20° open. Bad: Square = restricted clearing. Fix: Flare open.

**ANG-52 | Trail foot flare | Address | FO/OH | Both | 35** — Trail toe turnout. Ideal: ~5–10° (near square). Bad: Excess flare loses coil. Fix: Near-square.

**ANG-53 | Ball position relative to lead heel | Address | FO | Driver | 60** — Ball location. Ideal: off inside lead heel (to big toe). Bad: Central = steep. Fix: Forward position.

**ANG-54 | Ball position relative to stance | Address | FO | Irons | 55** — Iron ball location. Ideal: center (short) to ~1 ball forward (mid) / 2" inside lead heel (long). Bad: Too forward/back. Fix: Progressive.

**ANG-55 | Shaft lean at address | Address | FO | Both | 50** — Handle vs vertical. Ideal: slight forward (hands ahead) irons; neutral/slightly back driver. Bad: Big lean (irons over-deloft)/backward. Fix: Hands slightly ahead (irons).

**ANG-56 | Shaft lean at impact (Irons) | Impact | FO | Irons | 84** — Forward lean at impact. Ideal: ~6–9° (7-iron); PW ~10–14°. Bad: Backward/flip = added loft, thin/fat. Fix: Pressure forward, bowed wrist.

**ANG-57 | Shaft lean at impact (Driver) | Impact | FO | Driver | 55** — Driver shaft at impact. Ideal: ~neutral to slightly behind vertical (positive AoA). Bad: Big forward lean delofts. Fix: Stay behind, ball forward.

**ANG-58 | Trail elbow position vs body | Downswing-Middle | DTL | Both | 55** — Elbow location at delivery. Ideal: in front of trail hip (in the slot). Bad: Behind body (stuck) or over (flying). Fix: Elbow-in-front feel.

**ANG-59 | Trail arm extension post-impact | Follow-Through-Middle (trail arm parallel) | DTL | Both | 50** — Extension after impact. Ideal: both arms extending wide; trail arm straightening. Bad: Chicken-wing (lead elbow bent out). Fix: Extension drill.

**ANG-60 | Lead arm/club line | Follow-Through-Middle | DTL | Both | 40** — Arm-shaft relationship post-impact. Ideal: full release, arms extended down line. Bad: Held-off or flip. Fix: Release drill.

**ANG-61 | Body rotation to target | Finish | FO | Both | 40** — Rotation at finish. Ideal: chest/belt past target, balanced on lead side. Bad: Incomplete/hanging back. Fix: Rotate through.

**ANG-62 | Weight distribution | Finish | FO + pressure plate | Both | 40** — %/foot at finish. Ideal: ~90–95% lead foot, balanced. Bad: On trail (fall-back). Fix: Hold-finish.

**ANG-63 | Neck/cervical angle | Address | DTL | Both | 35** — Head/neck in line with spine. Ideal: neck ~in line with spine. Bad: Chin buried/craned. Fix: Chin-up.

**ANG-64 | Wrist radial/ulnar at impact | Impact | DTL | Both | 55** — Deviation at impact. Ideal: slight ulnar release retaining shaft lean (irons). Bad: Full early un-hinge (cast). Fix: Lag retention.

---

## Recommendations (staged build plan for the app)

**Stage 1 — Ship the high-weight core first (weights ≥85).** Build scoring around the 12 items that carry the most causal weight: clubface angle at impact, smash/centeredness, club head speed, ball speed, face-to-path, club path, attack angle (Driver/Irons split), kinematic sequence, transition sequencing, lead-wrist condition at impact, and early-extension detection. These alone explain the majority of strike-quality, distance, and accuracy variance. Benchmark against the TrackMan master table. Threshold to expand: once the AI reliably scores these against a launch monitor within ±1 club-average unit.

**Stage 2 — Layer the measurable positional angles (ANGLES TAB weights ≥60).** Prioritize angles a phone/2-camera setup can actually measure: spine bend + retention (DTL), secondary axis tilt (FO), X-Factor/turn (OH proxy from FO+DTL), lead-wrist at top/impact, shaft lean at impact, and the chin-over-midfoot plumb line. Tag each row's required camera view so the AI only attempts angles the available footage supports. Threshold: add force/pressure rows (GRF-\*, ANG-38–41) only when a Swing Catalyst/BodiTrak feed exists — otherwise flag them "not measurable from video" rather than scoring them.

**Stage 3 — Personalize the "ideal."** Replace fixed ideals with speed- and club-scaled windows (e.g., driver launch/spin should scale to the player's club speed via a TrackMan-optimizer-style lookup, not a single tour number). Down-weight stylistic items (grip type, finish aesthetics) so the AI's improvement suggestions target causal faults (face, path, low point, sequence) before cosmetics.

**Improvement-suggestion logic:** Map each fault to its ball-flight symptom and the enrichment chain (e.g., cupped lead wrist at top → open face → slice → fix = flexion drill; early extension → blocks/hooks → fix = chair drill). Always resolve upstream causes (pressure shift, sequence, posture) before downstream symptoms (shaft lean, face) because, per the research, shaft lean and face are consequences of pressure/sequence, not independently forceable.

## Caveats

- **Face-angle start-direction percentages** vary by source and are approximations: TrackMan Academy assigns ~87% (driver) / ~81% (6-iron & PW); other TrackMan-derived teaching sources cite 75–85%. Treat as a strong directional rule, not a precise constant, and note it assumes a centered strike.
- **Two competing "tour average" datasets exist.** The complete land-angle/apex grid is TrackMan's classic dataset (driver 113 mph / 275 yds); the 2023/24 update reports higher driver numbers (≈115 mph / ~282 yds carry / 300.2 yds total) but omits land angle/apex publicly. There is also an internal TrackMan spin discrepancy (driver 2,545 vs 2,686 rpm). Reconcile by treating driver spin as a ~2,500–2,700 rpm band and labeling the dataset vintage in the app.
- **Attack angle:** the classic table lists a slightly negative PGA driver AoA (−1.3°), but modern optimization and fitters target a positive driver AoA (+1° to +5°) for distance. The dataset uses the fitter/optimal target as the "ideal" for driver AoA and flags the classic-table value separately.
- **Biomechanics sample sizes are small.** Key rotational-velocity and X-Factor-stretch findings come from studies of ~5–20 golfers (e.g., Frontiers 2022 Swing Performance Index: 11 pros + 5 amateurs; Cheetham 2000; Meister/Rose). Sequencing direction (pelvis→thorax→arm→club) is robustly replicated, but exact peak-velocity magnitudes and COV figures should be treated as indicative benchmarks, not universal constants.
- **Vertical GRF magnitudes** (150–280%+ body weight) are individual elite examples; research (Swing Catalyst) is explicit that timing/sequence of force peaks matters more than raw magnitude, and that copying maximal vertical force can cause injury. Score GRF on timing/sequence first.
- **Dustin Johnson's −45° lead-wrist flexion** and similar outlier positions are illustrative extremes, not ideals — several rows note "not to be copied." Many tour players win with non-textbook positions offset by compensations; the app should score outcome-critical impact conditions above textbook backswing shapes.
- **Weights are expert-assigned** from the causal hierarchy in the research (impact conditions > sequence/pressure > positions > cosmetics), not from a single validated regression. They are a defensible starting prior for the AI and should be tuned against real scoring outcomes.
