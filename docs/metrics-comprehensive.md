# Golf Swing Analysis Master Metric Specification

## Deliverable

I rebuilt the metric system into a single implementation-oriented master specification, using your current app inventory as the starting point and then expanding it for **DTL, face-on, silhouette, club, clubface, timing, sequencing, repeatability, and measurement-quality analysis**. Your current document contains 61 scored/measured/deferred/quality entries and also identifies several known problems, including duplicate posture scoring, DTL shaft lean being mislabeled, unreliable DTL trail-elbow geometry, and invalid monocular rotation/X-factor estimates. fileciteturn0file0

The resulting master catalog contains **192 distinct metric families/checks**:

| Area | Metrics |
|---|---:|
| Setup and address | 33 |
| Takeaway, backswing and top | 34 |
| Transition and downswing | 26 |
| Impact | 32 |
| Release | 12 |
| Finish | 16 |
| Timing, sequencing and repeatability | 19 |
| Measurement quality and reference frame | 20 |
| **Total** | **192** |

It explicitly marks every entry as **EXISTING**, **EXISTING • UPDATE**, **EXISTING • BUILD**, **NEW**, **NEW • PRO-REFERENCE**, or **REQUIRES EXTERNAL/3D**. Each metric includes its camera view, swing checkpoint or interval, why it matters, how to calculate it from the pose/silhouette/club model, how it should be compared with Pro 1, a validity grade, and supporting research.

**[Download the complete 192-metric Markdown specification](sandbox:/mnt/data/SwingSage_Master_Ideal_Swing_Metrics.md)**

The most important conceptual change is that I would **not define an ideal swing as a single universal set of joint angles**. Single-camera golf research has found proficiency-related characteristics such as forward-tilt stability, while simultaneously finding substantial individual characteristics in club trajectory. Skilled golfers can also use different pelvis/thorax movement strategies while progressively converging toward low-variability hand and clubhead delivery near contact. Pelvis-thorax coordination research likewise reports substantial inter-individual variability. citeturn10search3turn10search2turn11search2

That makes your proposed **Pro 1 comparison system** a strong architecture, provided the reference is matched for club, camera view, handedness, and ideally shot type. Club matching matters particularly because recent 3D research found significant biomechanical swing-plane differences between driver and 7-iron. citeturn10search1

## What the research changes

### Pro 1 should be a reference distribution, not one frozen swing

Instead of storing one angle from one Pro 1 video as "the ideal," the stronger implementation is to capture approximately **3 to 5 good Pro 1 swings for each relevant club/view combination** and store:

`pro_mean`  
`pro_sd`  
`pro_curve`  
`pro_curve_sd`  
`measurement_floor`  
`required_view`  
`directionality`  
`confidence_threshold`

The suggestion to use multiple Pro 1 swings is an engineering recommendation rather than a published biological requirement. It follows from research showing both meaningful individual movement strategies and skill-related reductions in variability near impact. In particular, skilled golfers progressively reduced hand and clubhead trajectory variability as contact approached, and a large R&A study found lower-handicap golfers had lower shot-to-shot variability in clubhead speed, efficiency, impact location, attack angle, club path, and face angle. citeturn10search2turn12search3

This means the app can legitimately say:

> **"Your pelvis depth at impact was 0.036 body-heights closer to the ball than Pro 1's mean."**

or:

> **"Your lead-arm flex increased 11° more than Pro 1 between P3 and P5."**

That is much more defensible than:

> **"Every golfer should have exactly X degrees here."**

### Match the professional by club

This is a major gap in many swing-comparison systems. Ball position itself changes whole-body address geometry, clubface aim, lie, club path and attack behavior, while the 2026 driver-versus-7-iron study found significant swing-plane and body-mechanics differences between the clubs. citeturn11search0turn10search1

At minimum, reference buckets should therefore distinguish:

`driver`  
`fairway_wood`  
`hybrid`  
`long_iron`  
`mid_iron`  
`short_iron`  
`wedge`

Exact-club matching is even better when you have sufficient Pro 1 data.

### Repeatability deserves its own score

One of the largest additions in the new document is a complete **repeatability family** rather than evaluating only whether one swing happens to resemble the pro.

That includes impact body-position variance, hand-path variance, clubhead-trace variance, clubface repeatability, per-joint trajectory repeatability, and an **impact-window convergence** metric measuring whether variability decreases as the golfer moves from P5 toward P7. The underlying rationale is unusually strong for a video analysis metric: skilled golfers can differ in torso and pelvis strategies while still progressively reducing hand and clubhead variability toward ball contact, and lower-handicap golfers exhibit lower club-delivery variability shot to shot. citeturn10search2turn12search3

### Keep true 3D biomechanics separate from 2D proxies

This is the other major architectural correction.

Markerless systems can produce useful movement analysis, but validation work consistently shows that visible sagittal/in-plane kinematics are stronger than frontal and particularly transverse-plane rotations. One OpenCap validation study reported agreement above 0.94 for sagittal knee/hip movement but much poorer agreement for frontal and transverse planes. A newer 2026 validation similarly found strong sagittal trajectories but high normalized errors and variable correlations for out-of-plane kinematics. citeturn11search1turn11search4

So the app should **not** call a monocular projected shoulder-width calculation:

> `shoulder_turn_deg = 92°`

Instead, call it something such as:

> `shoulder_turn_projection_proxy`

and compare that projection against **the exact same Pro 1 camera view**.

True axial shoulder rotation, true pelvis rotation, true X-factor, true club path and face-to-path belong in a dual-camera 3D or external-sensor tier.

## Camera-view model

Your two-view system should not attempt to make every metric available from both views. It should deliberately exploit the geometry each camera actually sees.

| Motion or feature | DTL | Face-on | Recommended treatment |
|---|---|---|---|
| Spine forward bend | **Excellent** | Weak | Score DTL |
| Butt line / pelvis depth | **Excellent** | Not visible as depth | Score DTL |
| Early extension toward ball | **Excellent** | Poor | Score DTL |
| Hand depth | **Excellent** | Poor | Score DTL |
| Arm-to-torso gaps | **Strong** when unoccluded | Useful | View-gated |
| Backswing vs downswing trace | **Excellent** | Different quantity | Score DTL |
| Visible shaft plane/pitch | **Excellent** | Different quantity | Score DTL |
| Forward shaft lean | **Not directly visible** | **Excellent** | Score FO |
| Stance width | Foreshortened | **Excellent** | Score FO |
| Ball position lead/trail | Poor | **Excellent** | Score FO |
| Ball distance from body | **Excellent** | Weak | Score DTL |
| Pelvis movement toward target | Poor | **Excellent** | Score FO |
| Head relative to ball | Poor | **Excellent** | Score FO |
| Shoulder side tilt | Projection contaminated | **Excellent** | Score FO |
| Trail shoulder below lead at impact | Poor | **Excellent** | Score FO |
| Torso side-bend | Poor | **Excellent** | Score FO |
| Butt silhouette | **Excellent** | Not useful for depth | DTL silhouette |
| Top of head / head height | **Strong** | **Strong** | Both |
| Lead/trail knee flex | Conditional | Conditional | Score with projection gate |
| Elbow flex | Conditional | Conditional | Strong arm-plane gate |
| True axial hip turn | No | No | 3D only |
| True axial shoulder turn | No | No | 3D only |
| True X-factor | No | No | 3D only |
| True club path degrees | No | No | 3D/launch monitor |
| Face-to-path | No | No | 3D/launch monitor |
| Weight distribution / pressure | No | No | Force plate/insole |

This view separation is important because a mathematically correct screen angle is not necessarily the biomechanical quantity named by the UI. Your existing inventory has exactly this problem with DTL "shaft lean." fileciteturn0file0 Single-camera markerless research demonstrates that useful golf information can indeed be extracted from one camera, but it also reinforces why measurements have to remain tied to the plane actually visible to that camera. citeturn10search3turn11search1

The same principle applies to the feet. Foot-ground interaction is biomechanically important, but pressure, center of pressure and ground-reaction force require actual kinetic measurements. A 2026 study used plantar-pressure and force instrumentation to study those variables. A heel rising in your stick figure can therefore be called **trail heel lift**, but it should not be translated into "82% of weight is on the lead foot." citeturn12search1

## Your proposed metrics, validated and incorporated

Every requested concept is in the master file. Several are excellent additions. Several need their interpretation tightened.

| Your proposed concept | Final treatment | Validity |
|---|---|---|
| **Trail foot hinged up on toe at finish** | `FIN-01 Trail foot toe-finish / heel height` | **Keep. NEW.** Excellent visible finish descriptor. Score primarily to Pro 1. |
| **Trail sole facing camera at finish** | `FIN-02 Trail sole orientation toward camera` | **Keep. NEW.** Use heel, big toe, small toe and shoe silhouette. Prefer a visibility/roll class over fake 3D degrees. |
| **Butt remains against original butt line** | `SET-24`, `BKS-08`, `BKS-26`, `DS-18`, `IMP-14`, `FT-07` | **Strong addition.** I converted it from one frame into an entire pelvis-depth curve. |
| **Hip remains against original depth line** | Included with skeletal hip midpoint and posterior silhouette edge | **Strong addition.** Use both because the silhouette is more directly related to the coaching line while hip keypoints are temporally stable. |
| **Neck and spine straight/aligned at address** | `SET-02 Neck-to-spine alignment` | **Keep with qualification.** Compare alignment to Pro 1 rather than insisting on exactly 180°. |
| **Spinal posture/C/S shape** | `SET-03 2D posture-shape proxy` | **Update existing.** Do not present a four-point 2D calculation as a clinical diagnosis. |
| **Finish hips level** | `FIN-07 Pelvis level at finish` | **Add, FO.** Score to Pro 1 rather than automatically demanding exactly 0°. |
| **Finish hips fully facing target** | `FIN-08 Pelvis facing target` | **Add, but true angle is 3D.** Monocular version is a body-facing/projection classification. |
| **Lead leg straight at finish** | `FIN-04 Lead leg straightness` | **Add.** Score excessive flex relative to Pro 1 rather than demanding anatomical knee lockout. |
| **Upper legs vertical / clean separation** | `FIN-05`, `FIN-06` | **Add.** DTL silhouette is particularly useful here. |
| **Finish spine angle** | `FIN-11`, plus FO `FIN-12` | **Add.** DTL measures forward finish angle; FO adds side-tilt/reverse-C appearance. |
| **Lead arm stays straight throughout** | `BKS-13`, `BKS-14`, `DS-14`, `IMP-03` | **Expand existing.** It becomes a full lead-elbow-flex curve instead of one or two snapshots. |
| **Lead forearm relative to spine at top** | `BKS-15` | **Excellent new DTL Pro-reference metric.** |
| **Hips compared with shoulders at finish** | `FIN-10` | **Add.** True axial angular difference needs 3D. Same-view projected Pro 1 comparison is acceptable as a proxy. |
| **Downswing below backswing** | `DS-08 Backswing-vs-downswing path separation` | **Excellent DTL addition.** Compare the traces at matched club/hand heights. |
| **Over-the-top if downswing is above backswing** | `DS-09 Over-the-top index` | **Good proxy with careful labeling.** Do not call it actual club path. |
| **Trail upper arm relative to spine at impact** | `IMP-06` | **Add.** Good DTL metric if the arm is sufficiently in-plane. |
| **Visible trail-arm gap at impact** | `IMP-07` | **Add.** Silhouette makes this substantially better than skeleton alone. |
| **Trail arm closer to torso than lead arm** | `IMP-05` | **Add.** Score the signed difference relative to Pro 1. |
| **Trail arm remains bent at impact** | `IMP-04` | **Add.** Strong foreshortening gate required. |
| **Hips already opening at impact** | `IMP-08` | **Keep concept.** Monocular output is a projected openness proxy, not authoritative axial degrees. |
| **Shoulders lag behind hips** | `DS-05`, `IMP-09`, `IMP-10` | **Strong sequencing concept.** Best implemented as pelvis-versus-torso phase/lead-lag behavior rather than one still-frame angle. |
| **Trail shoulder below lead at impact** | `IMP-11` | **Add, FO.** This is the correct camera for the relationship. |
| **Impact torso side-bend** | `IMP-12` | **Add.** More robust companion to shoulder-line tilt. |
| **Trail heel has begun lifting at impact** | `IMP-20`, `DS-22`, `FT-09` | **Track, but do not make universal.** Compare heel-lift timing with Pro 1 across the whole delivery. |

The **lead-arm concept** has some research support, but the evidence does not justify treating every degree closer to 180° as better. A 2024 study linked greater triceps capacity and straight-lead-arm mechanics with aspects of golf performance, while also emphasizing multifactorial performance relationships. That is why the new system treats arm collapse as a **curve and Pro-reference range**, not a binary straight/not-straight test. citeturn12search2

For the **downswing-under-backswing** idea, I agree with adding it. A modeling study found that placing the club below the golfer's swing plane early in downswing facilitated clubface squaring in that model, whereas above-plane positioning had the opposite effect. That supports measuring visible plane relationship, although it does not establish that every golfer needs one fixed amount of shallowing. citeturn11search3

For **pelvis-before-shoulders sequencing**, the research basis is stronger than for many static pose rules. Professional rotational patterns show consistent pelvis and upper-torso timing, including peak pelvis velocity in the downswing, and pelvis-thorax coordination research supports studying their relative sequence. The exact pattern still varies enough between golfers that Pro 1 curve comparison is preferable to one universal checkpoint number. citeturn10search0turn11search2

For **trail heel/foot behavior**, I deliberately did not validate "heel must already be airborne at impact" as a universal ideal. Foot and stance manipulations can alter lower-body mechanics, and instrumented research links foot-ground behavior with energy transfer, but that does not make one visible heel position universally correct. Accordingly, the file treats heel lift, sole roll and toe-finish as time-series/Pro-reference metrics rather than hard laws. citeturn12search0turn12search1

## Major additions beyond your list

The comprehensive list adds a number of high-value measurements that were missing from both your current app and the proposed additions.

### Face-on setup and ball geometry

**Ball position along the stance** should be one of the first FO additions. Small changes in ball location have been shown to change elite golfers' trunk, hip, knee, ankle and arm setup geometry, club lie, clubface aim, club path and attack behavior. citeturn11search0

The file therefore adds:

`SET-13 Ball position along stance`  
`SET-14 Ball distance from body`  
`SET-20 Hand height`  
`SET-28 Address shaft lean`  
`SET-30 Clubface aim/orientation`

This is particularly important because a player can otherwise appear to have "wrong posture" while simply using a materially different ball position.

### Pelvis depth becomes a curve, not one early-extension number

This may be the single most useful enhancement for your silhouette capability.

Instead of just:

`early_extension = maximum hip sway`

the new specification tracks:

**P1:** initial posterior butt line  
**P2/P3:** takeaway depth  
**P4:** top depth  
**P4-P7:** continuous downswing depth  
**P7:** impact depth  
**P8/P9:** post-impact depth

and stores both:

`posterior_butt_silhouette_offset`

and:

`hip_midpoint_depth_offset`

This lets the app distinguish a golfer who loses depth early from one who maintains it until late delivery.

### The over-the-top score becomes a matched-height geometric measurement

Rather than visually deciding whether two traces cross, the new system specifies a more reproducible process:

At comparable **clubhead or hand heights**, compare the downswing horizontal/depth position with the corresponding backswing position.

For example:

`P5 depth - matched P3 depth`

`P6 depth - matched P2 depth`

Then combine that with shaft steepening and hand-depth movement into `DS-09 Over-the-top index`.

This is still a **DTL projection metric**, not a claim that the app has measured a TrackMan-style path angle. That distinction is important because launch-monitor club-delivery variables are instrumented quantities with their own measurement properties. citeturn11search3turn12search3

### Impact now has a complete body-delivery model

Your existing impact system is heavily wrist/shaft oriented. fileciteturn0file0 The new impact family adds:

**Body:** pelvis depth, pelvis targetward shift, projected pelvis openness, projected torso openness, pelvis-versus-torso separation, forward-bend retention and side-bend.

**Arms:** lead-arm straightness, trail-arm bend, trail-versus-lead torso spacing, trail upper-arm-to-spine angle and trail-elbow gap.

**Head:** head relative to ball plus head lift/dip.

**Legs and feet:** lead-leg extension, trail-knee flex, trail-heel lift and sole-roll proxy.

**Club:** FO shaft lean, DTL image shaft angle, handle ahead/behind ball, handle height, face orientation, face-to-shaft orientation and a 2D attack-direction proxy.

That gives you a far more meaningful "impact body position compared with Pro 1" model.

### Finish becomes measurable rather than cosmetic

The finish family now explicitly includes:

`FIN-01` Trail toe-finish / heel height  
`FIN-02` Trail sole orientation  
`FIN-03` Trail knee position relative to lead leg  
`FIN-04` Lead leg straightness  
`FIN-05` Trail leg verticality  
`FIN-06` Leg separation  
`FIN-07` Pelvis level  
`FIN-08` Pelvis facing target proxy  
`FIN-09` Chest facing target proxy  
`FIN-10` Hip-versus-shoulder finish relationship  
`FIN-11` DTL finish spine angle  
`FIN-12` FO finish side tilt  
`FIN-13` Head over lead support  
`FIN-14` Body-center balance proxy  
`FIN-15` Finish hold stability  
`FIN-16` Finish club position

I recommend keeping these at a **lower causal scoring weight** than P5-P8 delivery. That weighting is a product-design judgment, but it is consistent with evidence that skilled golfers prioritize highly repeatable hand and club delivery approaching contact even while displaying different segment strategies. citeturn10search2

## Scoring architecture I would use

For the specific **stick-figure/body score** you said you want to improve, the new document proposes this initial weighting:

| Family | Starting share |
|---|---:|
| Impact body delivery | **25%** |
| Transition and downswing | **22%** |
| Setup and posture | **15%** |
| Backswing and top | **14%** |
| Timing and smoothness | **10%** |
| Follow-through and finish | **8%** |
| Repeatability | **6%** |

Those percentages are intentionally labeled as **product-design starting weights**, not experimentally proven percentages.

I would keep **club delivery as a second score** rather than allowing clubface uncertainty to distort the body score.

A result might therefore read:

> **Body Motion: 82**
>
> **Club Delivery: 71**
>
> **Repeatability: 88**
>
> **Measurement Coverage: 93%**

That separation would be much more informative than one aggregate number.

The score should also compare **curves**, not just positions. Professional rotational research measures time-series patterns, and skilled-golfer variability research likewise shows why the behavior approaching impact matters rather than merely hitting arbitrary static poses. citeturn10search0turn10search2

For example, the lead arm should not be scored as only:

`lead_elbow_flex@P4 = 8°`

Instead score:

`P2 = 2°`  
`P3 = 4°`  
`P4 = 8°`  
`P5 = 7°`  
`P6 = 5°`  
`P7 = 4°`

against Pro 1's corresponding curve. The same idea applies especially well to **butt-line depth, spine bend, head movement, trail heel lift, knee flex, hand depth, shaft pitch and pelvis-versus-torso sequencing**.

A global **Pro 1 pose-curve similarity score** is also included, but it should never replace the explainable individual metrics. It should be a high-level summary of normalized joint trajectories after mirroring for handedness and phase-aligning the swing.

## Critical limits and implementation priorities

The master document deliberately identifies things the app should **refuse to pretend it knows**. True axial hip/shoulder rotation and X-factor need valid 3D reconstruction for authoritative degrees. True club path and face-to-path need 3D club delivery or launch-monitor data. Center of pressure, ground-reaction force and real "weight on lead foot" require pressure/force instrumentation. Markerless systems are useful, but current validation evidence strongly favors in-plane measurements over out-of-plane rotations. citeturn11search1turn11search4

That abstention behavior is especially important because your current system already demonstrates the failure mode: a valid image-plane shaft angle can be calculated in DTL, yet that angle is **not forward shaft lean**, and the existing rotation family can return numerical values even though the underlying monocular geometry cannot uniquely recover true axial rotation. fileciteturn0file0

For the current **DTL pipeline**, I would implement the new work in roughly this priority:

**First:** butt-line/pelvis-depth curve, backswing-versus-downswing matched-height path separation, over-the-top index, lead-arm structure curve, hand depth, trail-arm-to-spine angle, trail-elbow-to-torso gap, impact handle height, finish trail-foot geometry, finish leg separation and repeated-swing consistency.

**Then:** clubface-to-shaft/forearm checkpoints, improved shaft-shallowing curve, hand/club exit metrics and silhouette finish stability.

For the new **FO pipeline**, I would prioritize:

**First:** ball position, stance width and foot flare, pelvis targetward shift, shoulder and pelvis side tilt, head relative to the ball, trail-shoulder-low at impact, torso side-bend, lead-leg extension/posting, trail-heel progression, true visible shaft lean and handle-ahead-of-ball.

**Then:** finish balance, pelvis level, head/body center over lead support and clubface/address alignment.

The most important software-level addition is an explicit **observability layer**. Every metric should declare fields such as:

```text
required_view
required_keypoints
requires_silhouette
requires_ball
requires_club
requires_clubface
projection_risk
min_confidence
club_specific
pro_reference_only
can_score_monocular_2d
```

That is what prevents a measurement from becoming "correct math, wrong golf concept."

The completed specification, including all **192 metrics**, the requested additions, current-to-new status markings, validity grades, calculation definitions, Pro 1 target rules, research references and the external-data gap list, is here:

**[Download SwingSage_Master_Ideal_Swing_Metrics.md](sandbox:/mnt/data/SwingSage_Master_Ideal_Swing_Metrics.md)**