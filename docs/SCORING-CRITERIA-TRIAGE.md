# Scoring Criteria Triage — instructions/criteria.md classified against what we can build

**Date:** 2026-08-04
**Source:** [instructions/criteria.md](../instructions/criteria.md) — 143 MAIN TAB rows (DAT/SEQ/ROT/
GRP/SET/ALN/BAL/TKA/BKS/TOP/TRN/DSW/IMP/REL/FIN/GRF/LOW/HED/FLT/WRS/PHY/MNT) + 64 ANGLES TAB rows
(ANG-01–64), all weighted 1–100, drawn from TrackMan/TPI/Swing Catalyst/HackMotion research.
**Purpose:** classify every row against what SwingSage can actually measure, so
`scoring_config.json` (doc 05 C1) gets built against reality instead of against the spreadsheet's
optimism. `criteria.md` stays as delivered — this file is the triage layered on top of it, kept
in `docs/` per the DECISIONS.md/STATUS.md convention (instructions/ is the user's source
material, docs/ is where we reason about it).

This is a category-level triage verified against the current field set in `metrics.py`,
`checkpoints.py`, `events.py` and `face.py` (2026-08-04), not an independent re-derivation of
every one of 207 rows. Where a row maps cleanly onto an existing field it is cited by name;
where it doesn't, the bucket is a judgment call and should be revisited when the item is
actually built.

## The constraint that shapes everything below

**One view per swing, chosen at upload — never both.** Doc 01 §upload: view is DTL or Face-On,
selected once. There is no simultaneous two-camera capture and no overhead. That single fact
eliminates or degrades more rows than any data gap:

- Rows tagged `OH` in the source (X-Factor, pelvis/thorax rotation) get a **DTL- or FO-projected
  estimate**, never the true overhead number. `metrics.py` already names this honestly —
  `xfactor_rotation_est`, `shoulder_turn_from_address` — and every video-derived rotation number
  in this triage inherits that same "_est" honesty, whether the field name says so or not.
- Rows tagged `FO` (secondary axis tilt, stance width, hip/knee sway, foot flare) are buildable
  in code but **untestable today** — both current fixtures are DTL. They stay in their bucket,
  flagged `FO-gated`.
- Rows needing both at once (e.g. a DTL spine-bend check cross-referenced against an FO sway
  check on the same swing) can't be fused until a golfer is filmed twice, which nothing in doc 01
  currently asks for.

Two more constraints worth stating once instead of on every row:

- **Doc 04 §6's face-angle honesty policy generalizes.** `face.py` will not report a face-angle
  *degree* number from video at all, and deliberately refuses to classify face at Impact —
  *"the frame the golfer most wants and the one video cannot honestly answer."* Any row asking
  for a precise impact-condition number in degrees or mph inherits that same refusal.
- **No ball tracking, no force plates, anywhere in the spec.** The swing clip is the golfer, not
  the ball flight, and nothing in doc 00–08 ingests a pressure plate. Both are structural gaps,
  not oversights to code around.

## Bucket legend

| Code | Meaning |
|---|---|
| **A** | Already computed — an existing field in `metrics.py` / `checkpoints.py` / `events.py` / `face.py`, cited by name |
| **B** | Buildable now — new code, same pose+club data already in `analysis.json`, no new capture/AI/hardware |
| **C** | Needs AI/LLM visual judgment — a gestalt call better asked of a vision model on a keyframe than reduced to a threshold |
| **D** | Needs simulator or impact-image ingestion — doc 06's screenshot-parse flow, specced but not built |
| **E** | Needs force/pressure-plate data — no ingestion path exists anywhere in the spec |
| **F** | Not obtainable from any camera or currently-planned data source |
| **G** | Coaching hint only — never its own score; surfaced when a related *scored* check fails |

`B` items carry real effort variance — some are a one-line reuse of an existing signal at a
different frame, others are a new signal from scratch. Treat `B` as "no new data source needed,"
not "cheap."

---

## MAIN TAB

### DAT — Measured Ball & Swing Data (31 rows)

The highest-causal-weight category in the source doc (up to 100) and the one video answers
worst. Almost the entire bucket is either a ball-flight outcome the camera never sees, or an
impact-condition number in degrees/mph that doc 04 §6 already forbids fabricating from 2D video.

| ID | Bucket | Note |
|---|---|---|
| DAT-01 Clubface angle at impact | **D** | `face.py` refuses this specifically — "requires launch monitor" is its own literal output string |
| DAT-02 Smash factor | **D** | needs both speeds, from a launch monitor |
| DAT-03 Club head speed | **B, caveated** | club head track + fps gives a **relative** speed (body-heights/sec, same normalization `events.py` already uses for hand speed); converting to mph needs a real-world scale reference we don't have. Report as a trend, never as tour-comparable mph |
| DAT-04 Ball speed | **D** | |
| DAT-05/06 Attack angle (driver/irons) | **D** | needs true 3D club-path geometry at a calibrated scale |
| DAT-07 Club path | **D** | |
| DAT-08 Face-to-path | **D** | depends on DAT-01 |
| DAT-09/10 Dynamic loft | **D** | |
| DAT-11 Spin loft | **D** | derived from two D-bucket numbers |
| DAT-12/13 Spin rate | **D** | |
| DAT-14/15 Launch angle | **D** | |
| DAT-16/17 Swing plane / direction | **B** | shaft-angle series already tracked; a consistency check (not a launch-monitor-grade plane) is buildable |
| DAT-18/19 Low point (irons/driver) | **B, caveated** | buildable using the **Address-frame club-head position as a ball-position proxy** — no ball detector exists, so this is inferred, not measured |
| DAT-20/21 Impact location (toe/heel, high/low) | **D** | *not* swing video — doc 06's **impact-image** parse (a photo of foot-spray/impact tape) is the specced path for exactly this. Distinct from the launch-monitor-screenshot half of doc 06 |
| DAT-22 Lie angle at impact | **B/C** | shaft-to-ground angle is trackable but the "true ground plane" needs camera calibration we don't have; treat as a rough estimate |
| DAT-23/24 Shaft lean at impact | **A**, caveated | `shaft_from_vertical` at the impact frame already exists — see ANG-56/57, same field |
| DAT-25–31 Carry/total/apex/land angle/spin axis/offline/dispersion | **D** | pure ball-flight; camera doesn't see it |

### SEQ — Kinematic Sequence & Tempo (11 rows)

The best-covered category already. Tempo is not just built — it now has its own plausibility
check.

| ID | Bucket | Note |
|---|---|---|
| SEQ-01 Kinematic sequence order | **B** | pelvis (hip line), thorax (shoulder line), lead arm, club head all have per-frame angular position already; peak-velocity ordering is new code over existing signals |
| SEQ-02 Tempo ratio | **A** | `events.py` `tempo.ratio`, now with a plausibility flag (D37) |
| SEQ-03/04 Backswing/downswing time | **A** | `tempo.backswing_ms` / `downswing_ms` |
| SEQ-05 Transition sequence | **B** | same signals as SEQ-01, windowed at Top→Transition |
| SEQ-06 Total swing time | **A** | `(impact.frame - address.frame) / fps`, one line over existing events |
| SEQ-07/08 Pelvis/thorax peak rotational velocity | **B, caveated** | *order/timing* is a clean B; the **absolute deg/s magnitude** is a 2D-projected proxy, worse on DTL where the rotation axis points toward the camera — report relative/session-trend, not a TPI-comparable number |
| SEQ-09 Lead arm peak velocity | **B** | same family |
| SEQ-10 Hand speed peak (timing) | **A/B** | `sg.speed` (grip speed) already exists in `events.py`; locating its peak relative to Impact is nearly free |
| SEQ-11 Clubhead speed peak timing | **B** | timing only, not magnitude — sidesteps DAT-03's mph problem entirely and is genuinely safe to ship |

### ROT — Body Rotation & Separation / X-Factor (10 rows)

| ID | Bucket | Note |
|---|---|---|
| ROT-01 X-Factor at top | **A**, caveated | `xfactor_rotation_est` — the `_est` suffix already admits this is DTL/FO-projected, not true OH |
| ROT-02 X-Factor stretch | **A/B** | delta of the same field at two frames |
| ROT-03 Shoulder turn at top | **A** | `shoulder_turn_from_address` |
| ROT-04 Hip turn at top | **A** | `hip_turn_from_address` |
| ROT-05 Hip turn at impact | **A** | same field, sampled at the impact frame |
| ROT-06 Shoulder turn at impact | **A** | same |
| ROT-07 Pelvis sway (lateral) | **B** | hip-center x-position delta; likely already partly captured by `max_hip_sway` — verify before rebuilding |
| ROT-08 Pelvis thrust / early extension | **A/B** | best signal is DTL, not FO — `spine_from_vertical` delta (exists) + hip vertical position delta. Duplicate of FLT-02 |
| ROT-09 Pelvis lift (vertical) | **B** | hip-center y-position delta |
| ROT-10 Thorax sway/lift | **B** | shoulder-center position delta |

### GRP — Grip (5 rows)

| ID | Bucket | Note |
|---|---|---|
| GRP-01 Grip strength (hand rotation) | **C** | a full-swing recording's address frame is too coarse to reliably count visible knuckles from pose keypoints alone; ask a vision model to look at the address frame instead of thresholding noisy knuckle keypoints |
| GRP-02 Grip placement (fingers vs palm) | **C** | same reasoning |
| GRP-03 Grip pressure | **F** | not visible to any camera; needs pressure-instrumented grips |
| GRP-04 Grip type | **C** | |
| GRP-05 Hand unity/lifeline | **C** | |

### SET — Setup & Address Posture (10 rows)

Nearly the whole category already exists.

| ID | Bucket | Note |
|---|---|---|
| SET-01 Spine forward bend | **A** | `spine_from_vertical` |
| SET-02 Knee flex | **A** | `lead_knee_flex` / `trail_knee_flex` |
| SET-03/04 Secondary axis tilt | **A**, FO-gated | `shoulder_tilt` / `hip_tilt` (view="face_on") |
| SET-05 Arm hang | **A** | `lead_arm_hang` |
| SET-06 Chin-over-midfoot plumb | **A** | `chin_over_ball_of_foot_deg` / `chin_over_midfoot_deg` |
| SET-07/08 Weight distribution at address | **E** | position ≠ pressure; a COM-over-base-of-support proxy from pose is possible but would be systematically unreliable — a golfer can look centered while loading asymmetrically |
| SET-09 Head position | **A** | `head_center`/`nose_bridge` already tracked |
| SET-10 Posture type (S/C) | **C, promising B** | current `spine_from_vertical` treats the spine as one segment; a genuine geometric check needs spine **curvature** (neck/`spine_mid`/mid_hip colinearity deviation) — all three points already exist as keypoints, worth prototyping as B before falling back to C |

### ALN — Alignment & Aim (3 rows)

| ID | Bucket | Note |
|---|---|---|
| ALN-01/02/03 | **B, blocked on a dependency** | the angle math is easy once a target line is known; nothing today establishes one. Needs either a manual UI input at upload or AI-vision detection of an alignment stick in frame (bucket C for that sub-problem specifically) |

### BAL — Ball Position & Stance Width (6 rows)

| ID | Bucket | Note |
|---|---|---|
| BAL-01/02 Ball position | **B, caveated** | same Address-frame-club-head proxy as DAT-18/19 |
| BAL-03/04 Stance width | **B**, FO-gated | ankle/foot keypoints vs shoulder width, straightforward |
| BAL-05/06 Foot flare | **A** | `lead_foot_flare` / `trail_foot_flare` already exist, FO-gated |

### TKA — Takeaway (3 rows)

| ID | Bucket | Note |
|---|---|---|
| TKA-01 One-piece takeaway | **B** | check wrist-hinge stays near address value through the first ~18–24" |
| TKA-02 Clubface in takeaway | **A, verify** | `face.py._checkpoints` already classifies at `toe_up` — this may already be computed; confirm before rebuilding |
| TKA-03 Takeaway path/width | **B** | club/hand trajectory vs a straight reference line from address |

### BKS — Backswing (5 rows)

| ID | Bucket | Note |
|---|---|---|
| BKS-01 Lead arm structure | **A** | `lead_elbow_flex` |
| BKS-02 Swing plane in backswing | **B** | shaft-angle series vs a defined reference plane |
| BKS-03 Width/radius maintenance | **B** | hand-to-shoulder distance across frames |
| BKS-04 Connection (arms-body) | **B/C** | elbow-to-torso proxy is buildable; "connection" as a gestalt is partly a vision call |
| BKS-05 Trail hip load/coil | **B** | same signal as ROT-07, inverted framing (load, not sway) |

### TOP — Top of Backswing (4 rows)

| ID | Bucket | Note |
|---|---|---|
| TOP-01 Lead wrist condition at top | **A** | `lead_wrist_deviation` — **weight 78, already built** |
| TOP-02 Trail elbow at top | **A/B** | `trail_elbow_flex` covers the angle; "flying" (spatial, not just flex) needs a body-relative distance check |
| TOP-03 Club at top (length/cross) | **B** | shaft direction at the Top frame, already tracked |
| TOP-04 Completion of backswing | **B** | turn angle still increasing right up to Top, no premature reversal |

### TRN — Transition (3 rows)

| ID | Bucket | Note |
|---|---|---|
| TRN-01 Lower-body-first sequencing | **B** | same family as SEQ-01/05 |
| TRN-02 Pressure shift timing | **E**, weak B-proxy possible | true answer needs pressure data; lateral hip-position trend is a poor stand-in — position can lead pressure |
| TRN-03 Shallowing/path from top | **B** | shaft-angle change from Top into the downswing |

### DSW — Downswing (4 rows)

| ID | Bucket | Note |
|---|---|---|
| DSW-01 Lag/wrist angle retention | **A/B** | `lead_wrist_hinge` exists at checkpoints; tracking it continuously through the downswing (not just one frame) is the new part |
| DSW-02 Delivery position | **A/B** | checkpoint machinery already locates the mid-downswing shaft-parallel frame |
| DSW-03 Hip clearing/rotation | **A** | `hip_turn_from_address` at/near impact |
| DSW-04 Maintain posture | **A** | `spine_from_vertical` delta |

### IMP — Impact (5 rows)

| ID | Bucket | Note |
|---|---|---|
| IMP-01 Flat/bowed lead wrist at impact | **A** | `lead_wrist_deviation` at the impact frame — **this is ANG-26, weight 85, the single highest-weight ANGLES TAB row, and it is already built** |
| IMP-02 Hands ahead of ball | **B, caveated** | needs the ball-position proxy again |
| IMP-03 Head/chest behind ball | **B, caveated** | head position is tracked; ball position is inferred |
| IMP-04 Weight/pressure at impact | **E** | a magnitude-of-force claim, not a position claim — no honest video proxy |
| IMP-05 Hip/shoulder openness at impact | **A** | existing turn fields at the impact frame |

### REL — Release & Extension (4 rows)

| ID | Bucket | Note |
|---|---|---|
| REL-01 Release type/timing | **B/C** | face.py's classification extended across a short post-impact window (new) is B; "manipulated vs natural" as a judgment is C |
| REL-02 Clubface closure rate | **B** | the *rate* of face.py's classification changing across frames — a genuine, previously-unconsidered extension of existing machinery |
| REL-03 Extension through impact | **A/B** | `lead_elbow_flex` through the release phase |
| REL-04 Chicken wing | **A** | same field — re-bending after extension is directly visible in the existing signal. Duplicate of FLT-04 |

### FIN — Follow-Through & Finish (3 rows)

| ID | Bucket | Note |
|---|---|---|
| FIN-01 Balanced finish | **E** for the %, **B** for stability | the literal 95%-lead-foot claim needs pressure data; a pose-stability-over-the-hold proxy is a reasonable B substitute for "held balance" |
| FIN-02 Full rotation to target | **A** | turn fields at the finish frame |
| FIN-03 Trail shoulder toward target | **A** | same family |

### GRF — Ground Forces (9 rows)

| ID | Bucket | Note |
|---|---|---|
| GRF-01 through GRF-09 | **E, all** | vertical GRF, horizontal shear, center-of-pressure, free moment/torque — none of this is visible to any camera. The cleanest, most unambiguous bucket in the whole document. Not fixable by doc 06 either — launch monitors don't report force-plate data; this would need a literal Swing Catalyst/BodiTrak/AMTI integration nothing currently specs |

### LOW — Lower Body & Footwork (4 rows)

| ID | Bucket | Note |
|---|---|---|
| LOW-01 Trail knee flex maintenance | **A** | `trail_knee_flex` tracked across the backswing |
| LOW-02 Lead leg post at impact | **A** | `lead_knee_flex` at/after impact |
| LOW-03 Trail heel behavior | **B** | heel keypoints exist in the 48-point contract; lift-off is a position-threshold crossing |
| LOW-04 Knee shift (front view) | **B**, FO-gated | lateral knee position delta |

### HED — Head & Eye Control (3 rows)

| ID | Bucket | Note |
|---|---|---|
| HED-01 Head lateral movement | **A** | `max_head_sway` / `max_face_sway` already in the metrics summary |
| HED-02 Head vertical movement | **A/B** | head-center y-delta, same family |
| HED-03 Eyes on ball / chin position | **B for chin, F for gaze** | "chin clears for the shoulder to pass under" is geometric; actual eye-gaze direction is not visible in body pose at all |

### FLT — Common Faults / Compensations (10 rows)

Mostly *derived* flags over signals already classified above, not new raw measurements — and
the category that maps most directly onto coach-narrative fault language.

| ID | Bucket | Note |
|---|---|---|
| FLT-01 Over-the-top | **B** | shaft-direction change from Top into the downswing, same family as TRN-03 |
| FLT-02 Early extension | **A/B** | = ROT-08 |
| FLT-03 Reverse spine angle | **B** | spine-lean *direction* at top vs address, not just magnitude |
| FLT-04 Sway | **B** | = ROT-07 |
| FLT-05 Slide | **B** | lateral hip motion specifically in the downswing |
| FLT-06 Hanging back | **E** primary, **B** weak proxy | true answer is pressure; hip-center-vs-ball-position at impact is a rough stand-in |
| FLT-07 Casting/early release | **B** | wrist-hinge tracked across the whole downswing, same family as DSW-01 |
| FLT-08 Flat shoulder plane | **B** | `shoulder_tilt` at the top vs a plane reference |
| FLT-09 Flying trail elbow | **A/B** | trail elbow flex/position at top |
| FLT-10 Loss of posture | **A** | `spine_from_vertical` delta across the whole swing, not just one checkpoint |

### WRS — Wrist Mechanics & Clubface Control (3 rows)

| ID | Bucket | Note |
|---|---|---|
| WRS-01 Wrist hinge/set (radial) | **A** | `lead_wrist_hinge` at the top checkpoint |
| WRS-02 Ulnar deviation release | **A/B** | same field, tracked continuously — retention-then-release, same family as DSW-01/FLT-07 |
| WRS-03 Trail wrist extension at impact | **B** | no trail-wrist field exists yet; a direct mirror of the lead-wrist methodology already proven out |

### PHY — Physical & Mobility (5 rows)

| ID | Bucket | Note |
|---|---|---|
| PHY-01 through PHY-05 | **G, all** | the source document's own Fix column *never* proposes a video fix for these — it always says "TPI screen." These are root-cause context, not swing-instant measurements. This is the category that most literally is what you meant by "hints and tips when other things fail": surface a mobility note when SET-10, ROT-08, FLT-02 or FLT-03 fire repeatedly across a golfer's log, never as their own score |

### MNT — Mental / Pre-Shot Routine (2 rows)

| ID | Bucket | Note |
|---|---|---|
| MNT-01/02 | **F**, weak trend possible later | not observable in a single 3–15s swing clip at all — routine and commitment are either outside the recorded window or not a visual signal in the first place. A *multi-swing* pre-shot-timing consistency trend (doc 05 C3) is a distant, weak proxy — not a per-swing score |

---

## ANGLES TAB (ANG-01–64)

The same underlying geometry as MAIN TAB, organized by phase/view instead of by swing part —
most rows are direct reuse of the fields established above. Compressed by pattern; exceptions
called out individually.

| Pattern | IDs | Bucket | Field |
|---|---|---|---|
| Spine bend + retention | ANG-01, 02 | **A** | `spine_from_vertical` |
| Secondary axis tilt | ANG-03, 04, 05 | **A**, FO-gated | `shoulder_tilt` / `hip_tilt` |
| Hip hinge | ANG-06 | **A** | `lead_hip_hinge` / `trail_hip_hinge` |
| Knee flex (address/top/impact) | ANG-07, 08, 09, 10 | **A** | `lead_knee_flex` / `trail_knee_flex`, sampled at each frame |
| Ankle dorsiflexion | ANG-11 | **A** | `lead_ankle_lean` / `trail_ankle_lean` (proxy) |
| Pelvic tilt (ant/post) | ANG-12 | **C** | internal bone orientation, not an external 2D landmark angle — no keypoint captures this cleanly from any single view |
| Pelvis rotation (top/impact) | ANG-13, 14 | **A**, caveated | `hip_turn_from_address` — wants OH, gets a DTL/FO-projected estimate |
| Thorax/shoulder rotation | ANG-15, 16 | **A**, caveated | `shoulder_turn_from_address`, same caveat |
| X-Factor + stretch | ANG-17, 18 | **A**, caveated | `xfactor_rotation_est` |
| Shoulder plane/tilt | ANG-19, 20, 21 | **A/B** | `shoulder_tilt` plus a new shaft-relative-plane check for the backswing row |
| Lead arm to chest/plane at top | ANG-22, 23 | **B** | wrist/shoulder/elbow points relative to torso |
| Trail elbow flex at top | ANG-24 | **A** | `trail_elbow_flex` |
| **Lead wrist flexion at top** | **ANG-25** | **A** | `lead_wrist_deviation` — **weight 78, already built** |
| **Lead wrist flexion at impact** | **ANG-26** | **A** | same field at impact — **weight 85, the highest ANGLES TAB weight, already built** |
| Wrist hinge radial at top | ANG-27 | **A** | `lead_wrist_hinge` |
| Lag angle downswing | ANG-28 | **A/B** | same field tracked continuously |
| Shaft plane (address/takeaway/top/delivery) | ANG-29, 30, 31, 32 | **A/B** | shaft-angle series at each event frame, already tracked by `club.py` |
| Clubface vs lead forearm | ANG-33 | **B** | face.py-style classification extended to this checkpoint |
| Hand path angle | ANG-34 | **B** | grip-center trajectory direction |
| Hip/knee sway (backswing/downswing) | ANG-35, 36, 37 | **B**, FO-gated | lateral position delta |
| **Pressure per foot (all phases)** | **ANG-38, 39, 40, 41** | **E** | the source document's own View column already says `FO + pressure plate` — the doc admits this itself |
| Hip slide vs turn ratio | ANG-42 | **B** | combination of the sway and rotation signals above |
| Head lateral movement (top/impact) | ANG-43, 44 | **A** | `max_head_sway` |
| Head vertical movement | ANG-45 | **A/B** | head-center y-delta |
| Chin-over-midfoot plumb (address/top) | ANG-46, 47 | **A** | `chin_over_midfoot_deg` |
| Posture angle change (downswing) | ANG-48 | **A** | `spine_from_vertical` delta |
| Stance width vs shoulder | ANG-49, 50 | **B**, FO-gated | = BAL-03/04 |
| Foot flare | ANG-51, 52 | **A** | `lead_foot_flare` / `trail_foot_flare` |
| Ball position | ANG-53, 54 | **B**, caveated | Address-frame proxy, same as DAT-18/19/BAL-01/02 |
| Shaft lean (address/impact) | ANG-55, 56, 57 | **A**, caveated | `shaft_from_vertical` — a projected 2D angle, not launch-monitor-grade dynamic loft |
| Trail elbow vs body (downswing) | ANG-58 | **B** | position-relative check |
| Trail arm extension post-impact | ANG-59 | **A/B** | `trail_elbow_flex` through release |
| Lead arm/club line post-impact | ANG-60 | **B** | release/extension pattern |
| Body rotation to target (finish) | ANG-61 | **A** | turn fields at the finish frame |
| **Weight distribution (finish)** | **ANG-62** | **E** | pressure plate, no path today |
| Neck/cervical angle | ANG-63 | **A** | `neck_angle` |
| Wrist radial/ulnar at impact | ANG-64 | **A** | wrist hinge/deviation at the impact frame |

---

## Totals

Approximate, category-level — treat as directional, not a committed count.

| Bucket | ~Count | Share |
|---|---|---|
| **A** — already computed | ~75 | 36% |
| **B** — buildable now | ~85 | 41% |
| **C** — AI/LLM visual judgment | ~12 | 6% |
| **D** — simulator/impact-image (doc 06) | ~24 | 12% |
| **E** — needs pressure/force plate | ~19 | 9% |
| **F** — impossible from any camera | ~6 | 3% |
| **G** — coaching hints only | 5 | 2% |

(Some rows carry two bucket letters above — e.g. "A, caveated" or "B/C" — and are counted once
under the primary verdict, so the columns won't sum to 207 exactly.)

**The headline finding:** roughly three-quarters of the document (A+B) is buildable from the
pose and club data `analysis.json` already carries, with no new capture, no AI, and no new
hardware. `metrics.py` already covers the single highest-weight ANGLES TAB row (ANG-26, lead
wrist at impact, weight 85) and most of SET/DSW/IMP/FLT. The bucket that actually blocks the
document's own highest-weight MAIN TAB items — DAT-01 through DAT-15, the ball-flight and
true-impact-condition numbers — is D, and doc 06 already specs how to close it; it just isn't
built.

---

## Staged build plan

Layered onto the existing plan (doc 05 Part C) and this session's recommendation to build the
scoring engine next, not restructured around it.

**Stage 1 — Score bucket A directly.** No new measurement code. Wire the ~75 already-computed
fields into `scoring_config.json` bands and `swingsage/scoring.py`'s weighted-mean/soft-falloff
machinery (doc 05 C1). This alone covers SET almost entirely, most of DSW/IMP/FLT, and both of
the two highest-weight ANGLES TAB rows. Demoable in days, per this session's earlier estimate.

**Stage 2 — Build bucket B, prioritized by the source doc's own weights.** Not everything in B
is equally valuable — sort by the `criteria.md` weight column and build the top of that list
first. SEQ-01 (kinematic sequence order, weight 92) and TRN-01 (lower-body-first, weight 85) are
the standouts: doc 05 §B already lists sequencing as a scoring category and nothing in the
current pipeline computes it yet. FLT's derived-fault rows are the next tier — cheap, and they
map directly onto coach-narrative language ("early extension," "casting," "over the top").

**Stage 3 — doc 06, unlocking bucket D.** This was already next after upload/DB in the earlier
recommendation, and this triage sharpens *why*: it's not just simulator stats, it's the single
highest-causal-weight category in the entire scoring document. Building it also unlocks the
impact-image sub-path for DAT-20/21 (impact location), which is otherwise permanently stuck at
F.

**Stage 4 — bucket C, as a bounded AI assist.** Grip classification and posture-type on a single
keyframe fits the non-negotiables' existing AI use case (correction of low-confidence spans,
capped per swing) — a vision call on the address frame, schema-validated, never a hard
dependency. Cheap once `AIProvider` exists (this session's Recommendation #3).

**Stage 5 (parked, not scoped) — pressure/force plate integration for bucket E.** No path exists
today; GRF and the pressure-per-foot rows would need a literal Swing Catalyst/BodiTrak/AMTI
ingestion doc 06 doesn't cover. Worth a DECISIONS entry if it's ever prioritized, not before.

**Ongoing — bucket G folds into the coach narrative, not the scorecard.** PHY's five rows never
get their own score; they're conditional text the narrative attaches when a related bucket-A/B
check (SET-10, ROT-08/FLT-02, FLT-03) fails repeatedly across a golfer's swing log. This is
exactly doc 05 C2's `score_adjustments`-adjacent narrative role, not a new mechanism — and it's
worth noting that any **E-bucket item degrades gracefully into a G-bucket hint** in the absence
of pressure data, rather than just disappearing: "your weight looked like it stayed back at
impact — a pressure-plate session would confirm" is legitimate coaching text even without the
hardware to score it.

## Calibration warning (same trap as D37)

Every band in this triage — degree ranges, weight assignments — comes from `criteria.md`'s
published research, not from measurement on `swing1`/`swing2`. Two fixtures cannot calibrate
anything, and the source document says as much about its own weights: *"expert-assigned from
the causal hierarchy... not from a single validated regression... should be tuned against real
scoring outcomes."* Do not adjust any band so these two swings score well — that is fitting to
the sample, the exact mistake the tempo validator was built to catch. Version
`scoring_config.json` from day one so a real recalibration later is traceable, per CLAUDE.md's
non-negotiable.
