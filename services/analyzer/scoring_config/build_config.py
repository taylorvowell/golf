"""Generates scoring_config/<VERSION>.json from a compact, reviewable Python table.

Why generated rather than hand-typed JSON: ~70 check definitions is large enough that a plain
JSON file becomes error-prone to review (every id/field/band pair looks the same at a glance).
This table is the source of truth; `v1.json` is its committed, versioned output — the same
"generator script + committed artifact" shape as `drizzle-kit generate`'s migrations. Re-run
this and `validate_scoring_config.py` after any edit; bump VERSION for a material band/weight
change per CLAUDE.md's non-negotiable ("every coach report stores scoring_model_version").

Each row maps one `instructions/criteria.md` row (bucket A or B per
`docs/SCORING-CRITERIA-TRIAGE.md`) onto a field the analyzer already computes
(`swingsage/metrics.py`, `checkpoints.py`, `events.py`). Coverage is intentionally NOT
exhaustive over all 207 criteria.md rows — see COVERAGE.md in this directory for exactly which
ids are wired here versus deferred, and why. Silently dropping a row was the thing to avoid,
not attempting all 207 in one pass with unverified sign conventions.

Field naming: `checkpoint` values are the P-codes from `checkpoints.py` (P1 Address ... P10
Finish). `source` says where the value comes from:
  "checkpoint"       -> checkpoints[checkpoint].values[field]        (per-frame geometry)
  "checkpoint_delta" -> the same field's CHANGE between `ref_checkpoint` and `checkpoint`
  "summary"          -> metrics.summary[field]                       (pre-aggregated)
  "glossary"         -> metrics.glossary[field]                      (coach-vocabulary layer)
  "tempo"            -> analysis.tempo[field]                        (top-level, not under metrics)
`abs_value: True` compares |value| to the band — for signed from-vertical/sway fields where
criteria.md's ideal is stated as a magnitude and the sign flips with camera side (metrics.py's
own documented convention, e.g. `spine_from_vertical`).

`advice_under`/`advice_over` are the DIRECTIONAL, plain-language instructions a golfer sees
instead of the technical `label` — "what to do differently", not the name of the measurement.
Which one fires depends on which side of the band the measured value fell on
(`scoring.py::score_check`), so getting the direction right matters: telling someone to "bend
the knees more" when they're already over-flexed is actively wrong coaching, not just
unhelpful. Where the underlying sign convention isn't resolved yet (bow-vs-cup lead wrist
direction, shaft-plane inside/outside — see COVERAGE.md), both directions carry the same
direction-neutral text rather than guessing. `effort` is a 1 (quick conscious fix) .. 5
(deep pattern change, needs sustained practice) authored rating — not measured, an editorial
judgment call like the weights in `criteria.md` itself, feeding the Leverage score's "ease"
term (`scoring.py`).

`deferred="<reason>"` marks a check that is authored but MUST NOT score. It is skipped with
that reason as its `skip_reason`, exactly like an untracked field, and it is excluded from the
category's `n_total` (counted in `n_deferred` instead) so a category does not advertise
coverage it does not have. This exists because the alternative is worse: v1 scored nine
rotation checks off `*_turn_from_address`, a quantity that DECREASES as a down-the-line golfer
turns (see the ROT block below), so every swing floored those nine at 0 and every golfer was
told to "turn your shoulders more" regardless of what they did. A check that cannot be measured
honestly has to abstain, not guess — the same rule doc 04 §6 applies to face angle. Un-defer a
row by deleting the argument once its metric is trustworthy; nothing else needs to change.
"""
import json
from pathlib import Path

# v2: v1's nine rotation checks + ANG-30 are deferred rather than scored, TKA-01 is remeasured
# as a delta, and the two absolute-duration tempo checks abstain on an implausible-tempo clip.
# v1.json stays frozen on disk so reports stamped `v1` remain reproducible (CLAUDE.md).
VERSION = "v2"

# category slugs match doc 05 Part C1's seven scoring categories
SETUP = "setup_posture"
TAKEAWAY = "takeaway"
BACKSWING = "backswing_top"
TRANSITION = "transition_tempo"
DOWNSWING = "downswing_plane"
IMPACT = "impact"
FOLLOW = "follow_through_balance"

BOTH, DRIVER, IRONS = "both", "driver", "irons"
DTL, FACE_ON, ANY_VIEW = "dtl", "face_on", "both"


def band(id_, label, category, weight, club, view, source, field, checkpoint,
         lo, hi, falloff, fix, advice_under, advice_over, abs_value=False, unit="deg",
         guard_field=None, guard_min=None, min_checkpoint_conf=None, effort=3,
         ref_checkpoint=None, requires_plausible_tempo=False, deferred=None):
    return {
        "id": id_, "label": label, "category": category, "weight": weight,
        "club": club, "view": view, "kind": "band",
        "source": source, "field": field, "checkpoint": checkpoint,
        "ref_checkpoint": ref_checkpoint,
        "band": {"min": lo, "max": hi, "falloff": falloff}, "abs_value": abs_value,
        "unit": unit, "fix": fix, "advice_under": advice_under, "advice_over": advice_over,
        "guard_field": guard_field, "guard_min": guard_min,
        "min_checkpoint_conf": min_checkpoint_conf, "effort": effort,
        "requires_plausible_tempo": requires_plausible_tempo, "deferred": deferred,
    }


def categorical(id_, label, category, weight, club, view, source, field, checkpoint,
                 good_values, fix, advice, min_checkpoint_conf=None, effort=3,
                 deferred=None):
    return {
        "id": id_, "label": label, "category": category, "weight": weight,
        "club": club, "view": view, "kind": "categorical",
        "source": source, "field": field, "checkpoint": checkpoint,
        "ref_checkpoint": None,
        "good_values": good_values, "fix": fix, "advice": advice,
        "min_checkpoint_conf": min_checkpoint_conf, "effort": effort,
        "requires_plausible_tempo": False, "deferred": deferred,
    }


# One shared reason string for the nine checks built on `*_turn_from_address` /
# `xfactor_rotation_est`, so un-deferring them is one grep. What is wrong with that family, in
# full, because the numbers look superficially reasonable and this cost a day to find:
#
# `metrics.per_frame` derives `{shoulder,hip}_facing_est = arccos(width / max_projected_width)`
# — degrees away from the WIDEST this golfer's shoulder/hip line projects in this clip, not
# degrees of turn. Down the line the shoulders start near edge-on and widen into the backswing,
# so the quantity FALLS as the golfer turns: measured at the top it is 54.5 -> 13.4 (perfect),
# 59.3 -> 17.5 (swing1), 68.3 -> 31.6 (swing2). `*_turn_from_address` subtracts address from
# that, so it is NEGATIVE across the whole backswing (-41.1 / -41.8 / -36.7 against a [75,105]
# band) and every one of these checks scored 0 on every swing.
#
# Fixing the sign is not enough, and this is the part that makes it a deferral rather than a
# patch. Two further problems survive it:
#   1. arccos is even, so the estimate is V-shaped through square — it cannot tell 40 deg open
#      from 40 deg closed. `body_facing` is meant to sign it, but it reads "anterior" at BOTH
#      address and the top and only flips by P9, so the recovered sign is not stable within a
#      swing. swing1 reads +41.2 at impact where perfect reads -6.3.
#   2. The magnitude is a projection, and it compresses: it recovers ~41 deg of shoulder turn
#      at the top where the real figure is ~90. criteria.md's bands are anatomical ground
#      truth, so even a correctly-signed value is being scored on the wrong scale. build's own
#      `unit="deg (2D-projected estimate)"` admitted this while the band did not.
# Scoring these needs a turn estimate that is actually in degrees — depth-aware pose, or a
# calibrated shoulder-width model — not a re-band of this one. See COVERAGE.md.
ROTATION_DEFERRED = (
    "shoulder/hip turn is derived from a 2D projected width (arccos of shoulder width over "
    "this clip's widest), which is sign-unstable through square and under-reads true turn by "
    "roughly half — it cannot be scored against criteria.md's anatomical degree bands. Needs a "
    "real turn estimate first; see scoring_config/COVERAGE.md."
)


CHECKS = [
    # ============================================================ SETUP & POSTURE (bucket A)
    band("SET-01", "Spine forward bend at address", SETUP, 70, BOTH, DTL,
         "checkpoint", "spine_from_vertical", "P1", 35, 45, 10,
         "Hip hinge, club-on-spine drill.",
         "Bend forward more from the hips at address — you're standing too upright, which "
         "tends to steepen the whole swing plane.",
         "Stand a little taller at address — you're bent too far forward, which can hurt your "
         "balance and posture through the swing.",
         abs_value=True, effort=2),
    band("ANG-07", "Lead knee flex at address", SETUP, 50, BOTH, ANY_VIEW,
         "checkpoint", "lead_knee_flex", "P1", 15, 30, 10, "Athletic flex.",
         "Add a little flex in your lead knee at address — it's too straight for an athletic "
         "stance.",
         "Ease up on the knee bend at address — you're sitting too low, more like a squat "
         "than a golf stance.", effort=1),
    band("ANG-08", "Trail knee flex at address", SETUP, 50, BOTH, ANY_VIEW,
         "checkpoint", "trail_knee_flex", "P1", 15, 30, 10, "Match lead knee flex.",
         "Add a little flex in your trail knee at address to match your lead knee.",
         "Straighten your trail knee slightly — it's over-flexed compared to a balanced "
         "stance.", effort=1),
    band("SET-05", "Lead arm hang from vertical at address", SETUP, 50, BOTH, DTL,
         "checkpoint", "lead_arm_hang", "P1", -10, 10, 15,
         "Let arms hang from posture.",
         "Let your arms hang more naturally from your shoulders at address.",
         "Let your arms hang more naturally at address — right now they're reaching away "
         "from, or pulled in too close to, your body.",
         abs_value=True, effort=2),
    band("SET-06", "Chin over mid-foot plumb at address", SETUP, 60, BOTH, DTL,
         "checkpoint", "chin_over_midfoot_deg", "P1", 82, 98, 14,
         "Balance / plumb-line mirror drill.",
         "Get your head balanced back over the middle of your feet at address — it's drifting "
         "off that line.",
         "Get your head balanced back over the middle of your feet at address — it's drifting "
         "off that line.", effort=2),
    categorical("SET-10", "Posture type (neutral vs S/C)", SETUP, 58, BOTH, DTL,
                "glossary", "posture_type", None, ["neutral"],
                "Core engagement, neutral pelvis.",
                "Work on a neutral spine at address — avoid over-arching your lower back "
                "(S-posture) or rounding your upper back (C-posture).", effort=3),
    band("ANG-06", "Lead hip hinge at address", SETUP, 55, BOTH, DTL,
         "checkpoint", "lead_hip_hinge", "P1", 130, 150, 15,
         "Push hips back, hinge from the hips not the waist.",
         "Hinge a bit less from the hips at address — stand a little taller through your "
         "upper body.",
         "Hinge more from the hips at address — your upper body is too upright/close to "
         "standing straight.", effort=2),
    band("BAL-03", "Stance width vs shoulder width (driver)", SETUP, 55, DRIVER, FACE_ON,
         "checkpoint", "stance_width_ratio", "P1", 1.0, 1.4, 0.3,
         "Widen slightly for driver.",
         "Widen your stance a little for the driver — it's narrower than ideal for a stable "
         "base with a longer club.",
         "Narrow your stance slightly for the driver — it's wider than it needs to be, which "
         "can restrict your turn.",
         unit="ratio", effort=1),
    band("BAL-04", "Stance width vs shoulder width (irons)", SETUP, 50, IRONS, FACE_ON,
         "checkpoint", "stance_width_ratio", "P1", 0.9, 1.15, 0.3,
         "Shoulder-width baseline.",
         "Widen your stance a touch for irons — roughly shoulder-width is the baseline.",
         "Narrow your stance a touch for irons — it's wider than the shoulder-width baseline.",
         unit="ratio", effort=1),

    # ============================================================ TAKEAWAY (bucket A/B)
    # Measured as the CHANGE in hinge from address, which is what the label always said and
    # what "one-piece" means — v1 banded the raw P2 angle at [150,180] while the field's own
    # scale runs 13-35 deg at address and 85-143 at P2, so no swing could ever score. The band
    # below is authored from the coaching definition (the triangle stays intact, so little
    # hinge is ADDED before the shaft reaches parallel), the same editorial basis as every
    # other band here — not fitted to the fixtures.
    band("TKA-01", "One-piece takeaway (wrist hinge added vs address)", TAKEAWAY, 58,
         BOTH, ANY_VIEW, "checkpoint_delta", "lead_wrist_hinge", "P2", 0, 45, 35,
         "Takeaway gate — keep the triangle intact through the first 18-24 inches.",
         # under-band means the hinge UNWOUND from address — rare, and a sign the hands are "
         # steering the club away rather than the body turning it back.
         "Let the club swing back with your body turn — your wrists are actually straightening "
         "out of their address angle in the takeaway rather than staying quiet.",
         "Keep your wrists out of it for the first 18-24 inches back — you're hinging them "
         "too early, instead of moving the clubhead, hands and shoulders together.",
         ref_checkpoint="P1", effort=3),
    # Deferred: `shaft_from_vertical` at P2 is ~+-90 BY DEFINITION — P2 is the checkpoint where
    # the shaft reaches parallel to the ground, so this measured -93.0 / +82.8 / +94.1 and the
    # [-35,35] band scored 0 on all three. It was scoring how well checkpoints.py found P2, not
    # how the golfer swung. Real shaft PLANE (is the shaft pointing inside/outside the target
    # line) is a different quantity and metrics.py explicitly cannot see it down the line —
    # it sets `shaft_plane = "in-plane angle (lean not visible)"` for dtl. The sign also flips
    # with camera side, per metrics.py's from-vertical convention.
    band("ANG-30", "Shaft plane at first parallel (takeaway)", TAKEAWAY, 60, BOTH, DTL,
         "checkpoint", "shaft_from_vertical", "P2", -35, 35, 20,
         "Takeaway gate.",
         "Work on keeping the shaft on-plane as it reaches parallel in the takeaway — see the "
         "target range below for where it should sit.",
         "Work on keeping the shaft on-plane as it reaches parallel in the takeaway — see the "
         "target range below for where it should sit.",
         abs_value=False, effort=3,
         deferred=(
             "`shaft_from_vertical` at P2 is ~+-90 by definition (P2 IS shaft-parallel), so "
             "this scored checkpoint detection rather than swing quality. True shaft plane "
             "(inside/outside the target line) is not observable down the line — metrics.py "
             "reports `shaft_plane` as 'in-plane angle (lean not visible)' for dtl.")),

    # ============================================================ BACKSWING & TOP (bucket A)
    band("BKS-01", "Lead arm structure at top (relatively straight)", BACKSWING, 55,
         BOTH, ANY_VIEW, "checkpoint", "lead_arm_angle", "P4", 150, 180, 20,
         "Width drills — comfortably extended, not locked.",
         "Keep your lead arm straighter through the backswing — it's breaking down more than "
         "it should by the top.",
         "Good width — your lead arm stays nicely extended into the top of the backswing.",
         guard_field="lead_arm_in_plane", guard_min=0.5, effort=3),
    band("TOP-02", "Trail elbow flex at top (~90 deg, in front of the body)", BACKSWING, 55,
         BOTH, ANY_VIEW, "checkpoint", "trail_elbow_flex", "P4", 75, 105, 20,
         "Elbow-down feel.",
         "Let your trail elbow fold a little less at the top — it's tucking in tighter than "
         "ideal.",
         "Fold your trail elbow more at the top — it's staying too straight and away from "
         "your body (a 'flying elbow').",
         guard_field="trail_arm_in_plane", guard_min=0.5, effort=3),
    band("WRS-01", "Wrist hinge / set (radial) at top", BACKSWING, 58, BOTH, ANY_VIEW,
         "checkpoint", "lead_wrist_hinge", "P4", 75, 105, 25, "Hinge drills.",
         "Set your wrists more in the backswing — you're not hinging enough by the top, "
         "which costs stored power.",
         "Ease off the wrist hinge a touch — you're over-cocking the wrists by the top.",
         effort=3),
    band("TOP-01", "Lead wrist condition at top (flat to slightly bowed)", BACKSWING, 78,
         BOTH, ANY_VIEW, "checkpoint", "lead_wrist_deviation", "P4", 165, 195, 20,
         "Flatten/bow the lead wrist; HackMotion-style feedback. Sign of bow-vs-cup not yet "
         "verified against a fixture (checkangles.py) — band is symmetric around straight "
         "until confirmed; see COVERAGE.md.",
         "Work on a flatter, more neutral lead wrist at the top — a cupped or heavily bowed "
         "wrist here changes how the clubface returns coming down.",
         "Work on a flatter, more neutral lead wrist at the top — a cupped or heavily bowed "
         "wrist here changes how the clubface returns coming down.",
         effort=4),
    band("ROT-03", "Shoulder turn at top (~90 deg)", BACKSWING, 68, BOTH, ANY_VIEW,
         "checkpoint", "shoulder_turn_from_address", "P4", 75, 105, 25,
         "Thoracic mobility, full shoulder turn.",
         "Turn your shoulders more going back — your shoulder turn at the top is coming up "
         "short.",
         "Ease back on the shoulder turn slightly — you're over-rotating at the top.",
         unit="deg (2D-projected estimate)", deferred=ROTATION_DEFERRED, effort=3),
    band("ROT-04", "Hip turn at top (~45 deg)", BACKSWING, 62, BOTH, ANY_VIEW,
         "checkpoint", "hip_turn_from_address", "P4", 35, 55, 20,
         "Trail-leg stability; don't over-turn the hips.",
         "Allow your hips to turn a little more going back — they're too restricted at the "
         "top.",
         "Resist your hips turning quite so much going back — you're over-turning them, "
         "which reduces the coil against your upper body.",
         unit="deg (2D-projected estimate)", deferred=ROTATION_DEFERRED, effort=3),
    band("ROT-01", "X-Factor at top (~40-45 deg shoulder-hip separation)", BACKSWING, 72,
         BOTH, ANY_VIEW, "checkpoint", "xfactor_rotation_est", "P4", 30, 55, 20,
         "Resist the hips, full shoulder turn.",
         "Create more separation between your shoulders and hips at the top — right now "
         "they're turning together rather than coiling against each other.",
         "Ease off the separation between shoulders and hips at the top — you're over-coiling, "
         "which can cost control.",
         unit="deg (2D-projected estimate)", deferred=ROTATION_DEFERRED, effort=4),
    band("LOW-01", "Trail knee flex retained at top (vs address)", BACKSWING, 50, BOTH,
         ANY_VIEW, "checkpoint", "trail_knee_flex", "P4", 10, 35, 15,
         "Feel the trail knee flex held, not straightened.",
         "Hold more flex in your trail knee at the top — it's straightening out too much "
         "during the backswing.",
         "Ease up on the trail knee bend at the top — it's over-flexed compared to a stable "
         "base.", effort=2),

    # ============================================================ TRANSITION & TEMPO (bucket A)
    band("SEQ-02", "Tempo ratio (backswing:downswing, ~3:1)", TRANSITION, 78, BOTH,
         ANY_VIEW, "tempo", "ratio", None, 2.2, 3.8, 1.2,
         "Metronome / Tour Tempo tones — count '1-2-3 / 1'.",
         "Slow your transition down — your downswing is rushing relative to your backswing "
         "(aim for roughly a 3:1 tempo).",
         "Quicken your downswing slightly relative to your backswing — your tempo is running "
         "slower than the ~3:1 that keeps a swing smooth and repeatable.",
         unit="ratio", min_checkpoint_conf=0.0, effort=3),
    band("SEQ-03", "Backswing duration (~0.85s)", TRANSITION, 45, BOTH, ANY_VIEW,
         "tempo", "backswing_ms", None, 550, 1150, 300,
         "Tempo training.",
         "Slow your backswing down a touch — it's happening quicker than a smooth, "
         "repeatable tempo wants.",
         "Speed your backswing up slightly — it's taking longer than a typical smooth tempo.",
         unit="ms", min_checkpoint_conf=0.0, effort=3,
         requires_plausible_tempo=True),
    band("SEQ-04", "Downswing duration (~0.26s)", TRANSITION, 48, BOTH, ANY_VIEW,
         "tempo", "downswing_ms", None, 180, 380, 150,
         "Tempo tones.",
         "Let the downswing happen a touch more smoothly — it's firing faster than ideal, "
         "which can cost control.",
         "Accelerate through the downswing a bit more — it's taking longer than ideal, which "
         "usually means losing speed into the ball.",
         unit="ms", min_checkpoint_conf=0.0, effort=3,
         requires_plausible_tempo=True),
    band("ROT-02", "X-Factor stretch (top -> transition)", TRANSITION, 75, BOTH, ANY_VIEW,
         "checkpoint", "xfactor_rotation_est", "P5", 30, 60, 20,
         "Hips-first transition, pump drill.",
         "Start the downswing with your hips before your shoulders — right now everything "
         "unwinds together instead of stretching further at the transition.",
         "You're creating a big stretch at the transition — make sure your upper body can "
         "still catch up smoothly through impact.",
         unit="deg (2D-projected estimate)", deferred=ROTATION_DEFERRED, effort=5),

    # ============================================================ DOWNSWING & PLANE (bucket A)
    band("DSW-01", "Lag / wrist angle retention (mid-downswing)", DOWNSWING, 75, BOTH,
         ANY_VIEW, "checkpoint", "lead_wrist_hinge", "P5", 60, 100, 25,
         "Pump drill, pressure-handle drill — retain the angle deep into the downswing.",
         "Hold your wrist angle longer coming down — you're releasing (casting) the club too "
         "early, which costs speed.",
         "Let the wrist angle start releasing a little sooner coming down — you're holding it "
         "a bit too long, which can block the club from squaring up.",
         effort=5),
    band("DSW-03", "Hip clearing / rotation near impact", DOWNSWING, 70, BOTH, ANY_VIEW,
         "checkpoint", "hip_turn_from_address", "P7", 25, 55, 20,
         "Wall drill — let the pelvis clear.",
         "Clear your hips more through impact — they're not opening up enough, which can "
         "trap your arms.",
         "Ease off how fast your hips are opening through impact — they're spinning out "
         "ahead of your arms.",
         unit="deg (2D-projected estimate)", deferred=ROTATION_DEFERRED, effort=4),
    band("DSW-04", "Posture maintained into impact (spine angle change)", DOWNSWING, 68,
         BOTH, DTL, "summary", "spine_change_at_impact", None, -6, 6, 10,
         "Chair drill, glute activation — retain the address spine angle.",
         "Keep your spine angle from address through impact — you're standing up out of your "
         "posture coming into the ball.",
         "Watch your posture into impact — you're bending down more than you started, rather "
         "than holding your address angle.", effort=3),
    band("FLT-10", "Loss of posture (spine change, whole downswing)", DOWNSWING, 70, BOTH,
         DTL, "summary", "spine_change_at_impact", None, -6, 6, 10,
         "Posture-retention drills.",
         "You're standing up out of your posture on the way down — work on holding your "
         "spine angle from address to impact.",
         "Your spine angle is changing more than it should into impact — focus on "
         "maintaining your set-up posture through the ball.",
         abs_value=False, effort=3),

    # ============================================================ IMPACT (bucket A)
    band("IMP-01", "Flat / bowed lead wrist at impact", IMPACT, 88, BOTH, ANY_VIEW,
         "checkpoint", "lead_wrist_deviation", "P7", 165, 195, 18,
         "Impact-bag, flexion drills. Bow-vs-cup sign not yet verified — see TOP-01 note.",
         "Work toward a flatter lead wrist at impact — a cupped wrist here adds loft and "
         "costs compression; an impact-bag drill builds the feel.",
         "Work toward a flatter lead wrist at impact — a cupped wrist here adds loft and "
         "costs compression; an impact-bag drill builds the feel.",
         effort=4),
    band("WRS-03", "Trail wrist extension at impact ('waiter's tray')", IMPACT, 55, BOTH,
         ANY_VIEW, "checkpoint", "trail_wrist_deviation", "P7", 150, 195, 25,
         "Trail-wrist-back feel, mirrors the lead-wrist checkpoint.",
         "Work on your trail wrist position at impact — a stable 'waiter's tray' feel "
         "(extended, not flipping) helps deliver a square, compressed strike.",
         "Work on your trail wrist position at impact — a stable 'waiter's tray' feel "
         "(extended, not flipping) helps deliver a square, compressed strike.",
         effort=4),
    band("ANG-56", "Shaft lean at impact (irons)", IMPACT, 84, IRONS, ANY_VIEW,
         "summary", "shaft_from_vertical_at_impact", None, 5, 16, 12,
         "Pressure forward, flat/bowed wrist, impact-bag drill.",
         "Get your hands further ahead of the clubhead at impact — your shaft isn't leaning "
         "forward enough, which usually means flipping or scooping at the ball.",
         "Ease off how far forward your hands are at impact — the shaft is leaning forward "
         "more than ideal, which can deloft the club too much.",
         effort=4),
    band("ANG-57", "Shaft lean at impact (driver)", IMPACT, 55, DRIVER, ANY_VIEW,
         "summary", "shaft_from_vertical_at_impact", None, -8, 8, 12,
         "Stay behind the ball, ball forward.",
         "Work on a more neutral shaft angle at impact with the driver — it's staying close "
         "to vertical, keep it there.",
         "Work on a more neutral shaft angle at impact with the driver — right now it's "
         "leaning noticeably forward or back rather than staying close to vertical, which "
         "affects your launch.",
         abs_value=True, effort=4),
    band("IMP-05", "Hip openness at impact", IMPACT, 60, BOTH, ANY_VIEW,
         "checkpoint", "hip_turn_from_address", "P7", 25, 55, 20,
         "Rotation drills.",
         "Open your hips more through impact — they're not clearing enough for the club to "
         "release freely.",
         "Your hips are opening too fast through impact — let your upper body and arms keep "
         "pace rather than spinning out early.",
         unit="deg (2D-projected estimate)", deferred=ROTATION_DEFERRED, effort=3),
    band("ROT-05", "Hip turn at impact (~35-45 deg open)", IMPACT, 65, BOTH, ANY_VIEW,
         "checkpoint", "hip_turn_from_address", "P7", 30, 50, 20,
         "Hip clearing.",
         "Rotate your hips more through the ball — they're not opening enough at impact.",
         "Rotate your hips a little less aggressively through the ball — they're opening "
         "faster than your arms can match.",
         unit="deg (2D-projected estimate)", deferred=ROTATION_DEFERRED, effort=3),
    band("ROT-06", "Shoulder turn at impact (~20-30 deg open)", IMPACT, 55, BOTH, ANY_VIEW,
         "checkpoint", "shoulder_turn_from_address", "P7", 15, 40, 20,
         "Sequencing.",
         "Rotate your shoulders through the ball a bit more — they're too square/closed at "
         "impact.",
         "Ease off your shoulder rotation into impact — they're opening too early, which can "
         "steepen your path.",
         unit="deg (2D-projected estimate)", deferred=ROTATION_DEFERRED, effort=3),
    band("ANG-44", "Head lateral movement at impact (vs address)", IMPACT, 45, BOTH, DTL,
         "checkpoint", "head_sway", "P7", -0.03, 0.06, 0.04,
         "Stay behind the ball.",
         "Keep your head from drifting too far away from the ball into impact — stay a touch "
         "more centered.",
         "Keep your head behind the ball longer through impact — it's moving toward the "
         "target too early, which tends to steepen the strike.",
         unit="body-heights", effort=2),

    # ============================================================ FOLLOW-THROUGH & BALANCE
    band("REL-03", "Extension through impact (lead elbow near straight at P9)", FOLLOW, 55,
         BOTH, ANY_VIEW, "checkpoint", "lead_elbow_flex", "P9", 0, 25, 20,
         "Extension drills — both arms extend down the line.",
         "Great extension through the ball — keep that feeling.",
         "Extend your lead arm more through impact and into the follow-through — it's "
         "staying bent rather than reaching out down the target line.",
         guard_field="lead_arm_in_plane", guard_min=0.5, effort=3),
    band("REL-04", "Chicken wing (lead elbow re-bends after extension)", FOLLOW, 60, BOTH,
         ANY_VIEW, "checkpoint", "lead_elbow_flex", "P9", 0, 20, 20,
         "Rotate the body through; avoid the lead elbow pulling out.",
         "No chicken wing here — your lead arm stays extended nicely through the release.",
         "Work on keeping your lead arm extended past impact — it's folding back in (a "
         "'chicken wing') instead of staying long through the release.",
         guard_field="lead_arm_in_plane", guard_min=0.5, effort=3),
    band("FIN-02", "Full rotation to target at finish", FOLLOW, 40, BOTH, ANY_VIEW,
         "checkpoint", "shoulder_turn_from_address", "P10", 80, 200, 30,
         "Rotate fully — belt buckle/chest facing target or beyond.",
         "Finish your rotation all the way to face the target — right now you're stopping "
         "short of a full finish.",
         "Great full rotation to the finish.",
         unit="deg (2D-projected estimate)", deferred=ROTATION_DEFERRED, effort=2),
]

CATEGORIES = [SETUP, TAKEAWAY, BACKSWING, TRANSITION, DOWNSWING, IMPACT, FOLLOW]


def main():
    ids = [c["id"] for c in CHECKS]
    dupes = {i for i in ids if ids.count(i) > 1}
    if dupes:
        raise SystemExit(f"duplicate check ids: {dupes}")
    unknown_cat = {c["id"] for c in CHECKS if c["category"] not in CATEGORIES}
    if unknown_cat:
        raise SystemExit(f"checks with unrecognised category: {unknown_cat}")

    config = {
        "version": VERSION,
        "generated_by": "scoring_config/build_v1.py",
        "categories": CATEGORIES,
        "checks": CHECKS,
    }
    out = Path(__file__).parent / f"{VERSION}.json"
    out.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {out} — {len(CHECKS)} checks across {len(CATEGORIES)} categories")


if __name__ == "__main__":
    main()
