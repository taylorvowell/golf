"""Stage 6 — swing metrics (doc 05 Part B).

Time series per frame plus a snapshot at each of the 8 events, all normalised by the
golfer's own pixel height so they are comparable across camera distances (doc 03 §5).

Two things are newly measurable now that the wholebody model gives real hand keypoints:

  * **Wrist hinge** — doc 03 §5 lists this as a *proxy* needing club data. With knuckles it
    is direct: the angle between the forearm (elbow→wrist) and the hand (wrist→knuckles).
    That is the lag/casting signal, and it needs no club at all.
  * **Foot flare** — heel→toe gives each foot's axis, feeding stance width and flare, which
    doc 05 scores under Setup & Posture.

Every metric carries the confidence of the keypoints it derives from, so the scoring engine
can skip checks whose inputs are unreliable rather than quietly grading noise (doc 05 C1).

Angles come in three shapes here, and mixing them up is the easiest way to misread this file:

  * **Interior joint angles** (knee, elbow, hip hinge, neck) — the angle *at* a joint between
    its two bones. Camera-independent in the plane, so these are the most portable numbers we
    produce. Published as `_flex` where 0 = straight, and as `_hinge` where the interior angle
    itself is the coaching quantity.
  * **Angles from vertical** (spine, shin, arm hang, shaft) — signed, and the sign flips with
    which side of the golfer the camera sits on. Magnitude and change-from-address are the
    portable halves.
  * **Stack angles** (chin / shoulders / hips over the foot) — the angle a plumb line would
    make, so **90 deg means stacked**. These are what a coach draws on screen at address.
"""
from __future__ import annotations

import numpy as np

from .skeleton import IDX

MIN_CONF = 0.35

# Where along the foot (heel -> big toe) each stack reference sits. The **ball of the foot**
# is the metatarsal heads — the part that absorbs pressure — which sits roughly three
# quarters of the way from the heel to the toe tip in adult proportion, not at the toes
# themselves. Mid-foot is the midpoint by definition. Both are reported because the coaching
# line is usually drawn somewhere between them.
FOOT_REF = {"midfoot": 0.5, "ball_of_foot": 0.75}

# The angle catalogue: every degree-valued field published per frame, with the view it means
# something in, whether the delta from address is the usable form, and where in the swing it
# is worth reading. Emitted verbatim as `metrics.angle_fields`, so the UI table and the
# checkpoint deltas are both generated from this one list instead of repeating it.
#
#   view  — "dtl" / "face_on" fields are still computed in the other view (the geometry is
#           defined either way), but the number does not mean what its name says there.
#   delta — False where the field is already measured against address; a delta of a delta
#           is nonsense.
#   when  — "setup" fields are only interpretable at P1. Arm hang is the clear case: at the
#           top the lead arm is above the shoulder, so "hang from vertical" reads 140 deg
#           and is arithmetically correct and coaching-meaningless.
#
# Reference *bands* are deliberately absent. Doc 05 puts thresholds in a versioned
# scoring_config.json and nowhere else; what a good number looks like is documented in
# docs/GLOSSARY.md until that file exists. This list says what is measured, not what is good.
def _af(field, label, view="both", delta=True, when="swing"):
    return {"field": field, "label": label, "view": view, "delta": delta, "when": when}


ANGLE_FIELDS = [
    _af("spine_from_vertical", "spine from vertical", when="both"),
    _af("lead_hip_hinge", "lead hip hinge (leg to back)", view="dtl", when="both"),
    _af("trail_hip_hinge", "trail hip hinge (leg to back)", view="dtl", when="both"),
    _af("neck_angle", "neck angle (head to spine)", when="both"),
    _af("head_pitch", "head pitch", view="dtl", when="both"),
    _af("shoulder_tilt", "shoulder tilt", view="face_on", when="both"),
    _af("hip_tilt", "hip tilt", view="face_on", when="both"),
    _af("lead_knee_flex", "lead knee flex", when="both"),
    _af("trail_knee_flex", "trail knee flex", when="both"),
    _af("lead_shin_from_vertical", "lead shin from vertical", when="both"),
    _af("trail_shin_from_vertical", "trail shin from vertical", when="both"),
    _af("lead_elbow_flex", "lead elbow flex", when="both"),
    _af("trail_elbow_flex", "trail elbow flex", when="both"),
    _af("lead_arm_hang", "lead arm hang from vertical", view="dtl", when="setup"),
    _af("lead_wrist_hinge", "lead wrist hinge (to shaft)"),
    _af("lead_wrist_deviation", "lead wrist cup / bow"),
    _af("shoulder_turn_from_address", "shoulder turn", delta=False),
    _af("hip_turn_from_address", "hip turn", delta=False),
    _af("xfactor_rotation_est", "X-factor (coil)", delta=False),
    _af("chin_over_ball_of_foot_deg", "chin over ball of foot", view="dtl", when="both"),
    _af("chin_over_midfoot_deg", "chin over mid-foot", view="dtl", when="both"),
    _af("shoulders_over_ball_of_foot_deg", "shoulders over ball of foot", view="dtl",
        when="both"),
    _af("hips_over_ball_of_foot_deg", "hips over ball of foot", view="dtl", when="both"),
    _af("shaft_from_vertical", "shaft from plumb"),
    _af("lead_ankle_lean", "lead ankle lean", when="both"),
    _af("trail_ankle_lean", "trail ankle lean", when="both"),
    _af("lead_foot_flare", "lead foot flare", view="face_on", delta=False, when="setup"),
    _af("trail_foot_flare", "trail foot flare", view="face_on", delta=False, when="setup"),
]

# --- where each angle lives on the body, so the player can draw it over the video ---------
#
# The player already scales normalised coordinates onto a canvas; this is what turns a number
# in a table into two rays and an arc on the golfer. It is published rather than mirrored in
# TypeScript for the same reason `keypoint_names` is: the drawing must be of the geometry the
# number was measured from, and a second copy of that mapping would drift.
#
# **Aspect is not a problem here even though the angles are aspect-corrected.** Corrected
# space is (x*W/H, y), which is pixel space scaled by 1/H — a uniform scale, and uniform
# scales preserve angles. So the arc drawn at (x*w, y*h) is exactly the angle in the label.
#
# Every overlay is the same shape — a vertex, two rays, an arc, a label — and the kinds
# differ only in what the second ray is:
#
#   interior   both rays run to real keypoints. `supplement: true` replaces the first ray
#              with the *continuation* of that bone through the vertex, drawn dashed, because
#              a `_flex` field reports departure from straight (180 - interior) and the arc
#              has to be the angle the number names, not its supplement.
#   vertical   ray to a keypoint, reference ray straight up.
#   plumb      ... straight down. The club, which swings a full half-turn, is measured here.
#   horizontal ... along +x. Stack angles and the tilt/flare pair are measured from
#              horizontal, so this is their literal reference. `guide: "plumb"` adds a
#              fainter vertical line, since 90 deg = stacked is the thing being checked.
#   vectors    two vectors drawn from a shared origin. Only wrist hinge needs it: forearm and
#              shaft do not share an endpoint, so no single vertex is honest.
#
# Point expressions: a keypoint name, or {"chain": [...]} taking the first tracked one, with
# optional "src" naming the per-frame series field that records which anchor actually
# answered; {"feet": frac} for the stack references, which are a fraction along heel->toe
# averaged over both feet; {"club": "head"} for the tracked club head.
_HEAD_CHAIN = ["nose_bridge", "head_center", "chin", "nose"]
_STACK_CHAIN = ["chin", "nose_bridge", "head_center"]


def _angle_geometry(lead, trail):
    """field -> geometry spec, with lead/trail already resolved to anatomical keypoints.

    Resolved here rather than on the client because handedness is decided here (D29) and a
    consumer re-deriving it is exactly how a left-handed swing gets drawn on the wrong limb.
    Fields with no entry — the rotation estimates, which come from projected widths rather
    than from any two bones — are simply not drawable, and the player greys them out.
    """
    g = {
        "spine_from_vertical": {"kind": "vertical", "from": "mid_hip", "to": "neck"},
        "neck_angle": {"kind": "interior", "vertex": "neck", "a": "mid_hip",
                       "b": {"chain": _HEAD_CHAIN, "src": "neck_angle_src"}},
        "head_pitch": {"kind": "vertical", "from": "chin", "to": "nose_bridge"},
        "shoulder_tilt": {"kind": "horizontal", "from": "left_shoulder",
                          "to": "right_shoulder"},
        "hip_tilt": {"kind": "horizontal", "from": "left_hip", "to": "right_hip"},
        "shaft_from_vertical": {"kind": "plumb", "from": "grip_center",
                                "to": {"club": "head"}},
        # Forearm against shaft. The two vectors share no endpoint — the forearm ends at the
        # wrist, the shaft starts at the grip — so they are drawn from a common origin at the
        # hands rather than pretending to meet at a joint.
        "lead_wrist_hinge": {"kind": "vectors", "at": "grip_center",
                             "u": [f"{lead}_elbow", f"{lead}_wrist"],
                             "v": ["grip_center", {"club": "head"}]},
    }
    for side, role in ((lead, "lead"), (trail, "trail")):
        g[f"{role}_knee_flex"] = {"kind": "interior", "vertex": f"{side}_knee",
                                  "a": f"{side}_hip", "b": f"{side}_ankle",
                                  "supplement": True}
        g[f"{role}_elbow_flex"] = {"kind": "interior", "vertex": f"{side}_elbow",
                                   "a": f"{side}_shoulder", "b": f"{side}_wrist",
                                   "supplement": True}
        # Interior angle, not a flex — so no supplement, and the arc is the number.
        g[f"{role}_hip_hinge"] = {"kind": "interior", "vertex": f"{side}_hip",
                                  "a": "neck", "b": f"{side}_knee"}
        # No supplement despite reading like a flex: this field keeps an older convention
        # where 180 = straight (GLOSSARY §7), so the plain interior angle at the wrist IS
        # the number. Adding a supplement here drew its complement — caught by checking the
        # drawn arc against the published value on every frame, which is why that check exists.
        g[f"{role}_wrist_deviation"] = {
            "kind": "interior", "vertex": f"{side}_wrist", "a": f"{side}_elbow",
            "b": {"chain": [f"{side}_middle_mcp", f"{side}_hand"]}}
        g[f"{role}_shin_from_vertical"] = {"kind": "vertical", "from": f"{side}_ankle",
                                           "to": f"{side}_knee"}
        g[f"{role}_arm_hang"] = {"kind": "vertical", "from": f"{side}_wrist",
                                 "to": f"{side}_shoulder"}
        g[f"{role}_ankle_lean"] = {"kind": "vertical", "from": f"{side}_heel",
                                   "to": f"{side}_ankle"}
        g[f"{role}_foot_flare"] = {"kind": "horizontal", "from": f"{side}_heel",
                                   "to": f"{side}_foot_index"}
    for ref, frac in FOOT_REF.items():
        for key, to in (("chin", {"chain": _STACK_CHAIN, "src": "stack_anchor"}),
                        ("shoulders", "neck"), ("hips", "mid_hip")):
            g[f"{key}_over_{ref}_deg"] = {"kind": "horizontal", "from": {"feet": frac},
                                          "to": to, "guide": "plumb"}
    return g


def _p(kp, name):
    q = kp[IDX[name]]
    return (np.array([q[0], q[1]]), q[2]) if q[2] >= MIN_CONF else (None, 0.0)


def _angle_between(v1, v2):
    a = np.arctan2(v1[1], v1[0]) - np.arctan2(v2[1], v2[0])
    return float(abs((np.degrees(a) + 180) % 360 - 180))


def _from_vertical(v):
    """Signed angle of a vector from straight up, in degrees; y grows downward."""
    return float(np.degrees(np.arctan2(v[0], -v[1])))


def _from_plumb(v):
    """Signed angle of a vector from straight DOWN, in degrees; y grows downward.

    For the club, which is the one thing here that swings a full half-turn: measured off the
    downward plumb line, 0 is the head hanging directly below the hands and +-180 is the head
    directly above them, so the number rises monotonically through the backswing instead of
    wrapping through the branch cut in the middle of it.
    """
    return float(np.degrees(np.arctan2(v[0], v[1])))


def _body_height(frames):
    hs = []
    for fr in frames:
        head, ch = _p(fr["kp"], "head_center")
        la, ca = _p(fr["kp"], "left_ankle")
        ra, cb = _p(fr["kp"], "right_ankle")
        feet = [p for p in (la, ra) if p is not None]
        if head is not None and feet:
            hs.append(max(f[1] for f in feet) - head[1])
    return float(np.median(hs)) if hs else 0.4


def per_frame(frames, view="dtl", handedness="right", aspect=1.0, club_frames=None):
    """Compute every metric for one frame; None where inputs are missing.

    `aspect` is width/height of the source: x and y are normalised by different scales, so
    any angle or distance mixing the two must correct for it or a portrait video reports
    systematically wrong angles.
    """
    bh = _body_height(frames)
    # Lead = the side closest to the target; trail = the side furthest from it. Defined by
    # handedness, NOT by which side faces the camera. The two coincide for a right-handed
    # golfer filmed down the line from behind — the trail side is nearer the lens — but that
    # is a property of that camera setup, not the definition. It inverts for a left-handed
    # golfer and means nothing face-on, so anything keyed off camera-nearness would be
    # silently wrong for half of all golfers.
    lead = "left" if handedness == "right" else "right"
    trail = "right" if handedness == "right" else "left"
    # Every side-keyed *metric* is published as lead_/trail_. Keypoints stay anatomical
    # (left_wrist, right_heel) because those are model output and a fixed contract; the
    # coaching layer is where side becomes lead/trail, and mixing the two vocabularies in
    # one namespace is how a left-handed swing gets read against a right-handed rubric.
    SIDES = ((lead, "lead"), (trail, "trail"))
    out = []

    for fr in frames:
        kp = fr["kp"]
        m: dict = {"f": fr["f"]}

        def pt(a):
            """One keypoint in aspect-corrected space, or None below MIN_CONF."""
            pa, _ = _p(kp, a)
            return None if pa is None else np.array([pa[0] * aspect, pa[1]])

        def vec(a, b):
            pa, pb = pt(a), pt(b)
            return None if pa is None or pb is None else pb - pa

        def first_pt(*names):
            """First of `names` that is tracked, with its name — so a fallback is visible.

            Head anchors differ in coverage by a factor of four on our own fixtures
            (nose_bridge 100%, head_center 23.7% on swing1), so any head angle needs a chain.
            Which link answered is published, because the anchors are not interchangeable:
            the nose sits forward of the ear, so the same posture reads a different absolute
            angle through each, and only same-source values may be differenced.
            """
            for nm in names:
                p = pt(nm)
                if p is not None:
                    return p, nm
            return None, None

        # --- posture ---------------------------------------------------------------
        spine = vec("mid_hip", "neck")
        m["spine_from_vertical"] = round(_from_vertical(spine), 1) if spine is not None else None

        # --- thoracic rounding (rolled back) -------------------------------------------
        # Sagitta of the hip -> shoulders -> head chain: how far the shoulder line sits off
        # the straight line joining mid_hip to head_center, in torso lengths. A rounded
        # upper back protracts the shoulders off that chord; a flat back leaves them on it.
        #
        # Note `spine_mid` is useless for this — it is defined as the midpoint of neck and
        # mid_hip, so it is collinear with them by construction and can never show a curve.
        # `neck` is a measured shoulder midpoint, which is why the chain uses it instead.
        #
        # Deliberately anchored on head_center (the ear midpoint) rather than the nose or
        # chin: the ears sit near the skull's rotation centre, so nodding the head barely
        # moves them. That is what keeps this a back measurement and not a head-tilt one.
        #
        # HARD CEILING, stated so nobody reads more into the number: four trunk keypoints
        # give exactly one curvature value. It cannot separate thoracic rounding from
        # lumbar flexion, and it is only meaningful in a down-the-line view, where the
        # sagittal plane lies in the image. A real spine profile needs the back edge of a
        # silhouette, not keypoints — see docs/DECISIONS.md D27.
        #
        # And it is only clean at ADDRESS. Once the torso rotates, the shoulder midpoint
        # moves relative to the hip->head chord for reasons that have nothing to do with
        # the spine's shape, so the through-swing delta is confounded by turn. Measured on
        # swing2 it runs 0.009 at address to 0.089 at the top, and most of that rise is
        # rotation, not the back rounding. Read the address value as posture; read the
        # delta only alongside shoulder_turn_from_address.
        torso = vec("mid_hip", "head_center")
        shoulders = vec("mid_hip", "neck")
        if torso is not None and shoulders is not None:
            chord = float(np.linalg.norm(torso))
            if chord > 1e-6:
                t = torso / chord
                # Signed perpendicular offset. The sign flips with view and handedness, so
                # only its magnitude and its change from address are portable.
                m["spine_curvature"] = round(
                    float(shoulders[0] * t[1] - shoulders[1] * t[0]) / chord, 4)
            else:
                m["spine_curvature"] = None
        else:
            m["spine_curvature"] = None

        sh = vec("left_shoulder", "right_shoulder")
        hip = vec("left_hip", "right_hip")

        # --- which way the body faces the camera (anterior / posterior) -----------------
        # A golfer finishes facing the target, so the side of the body presented to the lens
        # inverts during every swing — down the line you see the back at address and the
        # front at the finish. The front end needs to know which, and it is directly
        # observable: shoulders are a left-right ordered pair, so the SIGN of
        # (left_shoulder.x - right_shoulder.x) flips with facing. Anatomical left appearing
        # on the viewer's right means the golfer is facing the camera.
        #
        # This is the same signal Stage 3's side-swap repair keys off (postprocess.
        # fix_side_swaps takes its majority), so the two agree by construction.
        #
        # Degenerate when the shoulders are edge-on: the ordering is a coin flip exactly
        # where the projected width collapses. `facing_conf` is that width normalised, so a
        # consumer can tell "facing away" from "cannot tell" instead of reading a coin flip
        # as fact. Hips corroborate — they turn later than the shoulders, so agreement
        # between the two is meaningful rather than redundant.
        if sh is not None and abs(sh[0]) > 1e-6:
            anterior = sh[0] < 0          # anatomical left drawn right of anatomical right
            width = abs(float(sh[0])) / bh if bh > 1e-6 else 0.0
            m["body_facing"] = "anterior" if anterior else "posterior"
            m["facing_conf"] = round(min(1.0, width / 0.18), 2)
            m["facing_agrees_hips"] = bool(hip is not None and (hip[0] < 0) == anterior)
        else:
            m["body_facing"] = None
            m["facing_conf"] = 0.0
            m["facing_agrees_hips"] = None

        m["shoulder_tilt"] = round(float(np.degrees(np.arctan2(sh[1], sh[0]))), 1) \
            if sh is not None else None
        m["hip_tilt"] = round(float(np.degrees(np.arctan2(hip[1], hip[0]))), 1) \
            if hip is not None else None
        # Apparent shoulder-vs-hip separation. Labelled estimated: real X-factor is 3D and a
        # single 2D view cannot resolve it (doc 03 §5 rotation caveat).
        if sh is not None and hip is not None:
            m["xfactor_estimated"] = round(m["shoulder_tilt"] - m["hip_tilt"], 1)
        else:
            m["xfactor_estimated"] = None

        # --- interior joint angles ----------------------------------------------------
        # The most portable numbers in this file: an angle *at* a joint between its own two
        # bones does not care where the camera is, only that both bones lie near the image
        # plane. Where they do not, both bones project short and roughly along one image
        # direction, the interior angle collapses, and the joint reads FOLDED when it is
        # straight — the same foreshortening caveat spelled out for `lead_arm_angle_2d`
        # below applies to every angle in this block. `*_arm_in_plane` measures how bad it
        # is for the arms; the hips have no equivalent guard yet.
        #
        # `_flex` is stated as departure from straight (0 = straight limb) so the direction
        # of "more" is the same for every joint. `_hinge` keeps the interior angle itself,
        # because that is the number a coach reads for the hips.
        for side, role in SIDES:
            # Knee: hip-knee-ankle.
            a = vec(f"{side}_knee", f"{side}_hip")
            b = vec(f"{side}_knee", f"{side}_ankle")
            m[f"{role}_knee_flex"] = round(180.0 - _angle_between(a, b), 1) \
                if a is not None and b is not None else None

            # Elbow: shoulder-elbow-wrist. Lead elbow straight through the backswing, trail
            # elbow folded to about a right angle at the top, are two of the checks doc 05 C1
            # names. Both are published for every frame; which one matters depends on where
            # in the swing you are reading.
            a = vec(f"{side}_elbow", f"{side}_shoulder")
            b = vec(f"{side}_elbow", f"{side}_wrist")
            m[f"{role}_elbow_flex"] = round(180.0 - _angle_between(a, b), 1) \
                if a is not None and b is not None else None

            # How much of the arm's length survived projection, per side. This is the guard
            # that makes the elbow angle above readable rather than merely present: an arm
            # pointing at the lens foreshortens onto itself and its interior angle collapses,
            # so the joint reads fully folded when it is straight. Measured on swing2, the
            # trail elbow reads 172 deg of flex at P3 — anatomically impossible, and exactly
            # where the trail arm points down the barrel in a down-the-line view.
            #
            # Near 1.0 the arm lies in the image plane and the angle is trustworthy; low
            # values mean the number is a projection, not a joint. Published for both arms
            # now that both elbows are, rather than only for the lead.
            if a is not None and b is not None:
                span = float(np.linalg.norm(a) + np.linalg.norm(b))
                # `bh`, not a fresh _body_height(frames) — that recomputed the median over
                # every frame of the clip once per frame, the whole series scanned n times
                # for a constant.
                m[f"{role}_arm_in_plane"] = round(min(1.0, span / (0.42 * bh)), 2)
            else:
                m[f"{role}_arm_in_plane"] = None

            # Hip hinge — the "leg to back" angle: torso (hip->neck) against femur
            # (hip->knee), measured at the hip. This is the interior angle, so a golfer
            # standing bolt upright approaches 180 and bending forward from the hips closes
            # it. It is what separates a golf posture from a squat: the same knee flex with a
            # different hip hinge is a completely different setup.
            #
            # Down-the-line is where it means what it says — that is the view in which the
            # sagittal plane lies in the image. Face-on it degenerates, because forward bend
            # points at the lens.
            a = vec(f"{side}_hip", "neck")
            b = vec(f"{side}_hip", f"{side}_knee")
            m[f"{role}_hip_hinge"] = round(_angle_between(a, b), 1) \
                if a is not None and b is not None else None

            # Shin from vertical, measured ankle->knee so the vector points up like the spine
            # and the two share a sign convention. Part of the same posture picture as knee
            # flex and hip hinge — flex can come from the knee travelling forward over the
            # foot (shin leans) or from sitting back (shin stays plumb), and the knee angle
            # alone cannot tell those apart.
            shin = vec(f"{side}_ankle", f"{side}_knee")
            m[f"{role}_shin_from_vertical"] = round(_from_vertical(shin), 1) \
                if shin is not None else None

            # Arm hang: wrist->shoulder from vertical, so 0 means the hands hang directly
            # under the shoulder socket (doc 03 §5's "arm hang at address"). Signed, and the
            # sign flips with camera side like every from-vertical angle here.
            hang = vec(f"{side}_wrist", f"{side}_shoulder")
            m[f"{role}_arm_hang"] = round(_from_vertical(hang), 1) \
                if hang is not None else None

        # --- neck and head pitch ---------------------------------------------------------
        # Neck angle: the interior angle at the neck between the torso (neck->mid_hip) and the
        # head. 180 = head carried in line with the spine; smaller = head off that line, which
        # at address is chin-into-chest and through the swing is the head dropping.
        #
        # Anchored on nose_bridge in preference to head_center for coverage (D25) — but the
        # two are NOT interchangeable, so the source is published per frame and `compute`
        # refuses to difference frames whose anchors disagree.
        head_p, head_src = first_pt("nose_bridge", "head_center", "chin", "nose")
        neck_p, hip_p = pt("neck"), pt("mid_hip")
        if head_p is not None and neck_p is not None and hip_p is not None:
            m["neck_angle"] = round(_angle_between(hip_p - neck_p, head_p - neck_p), 1)
            m["neck_angle_src"] = head_src
        else:
            m["neck_angle"] = None
            m["neck_angle_src"] = None

        # Head pitch off the face axis (chin->nose_bridge) rather than off a head centre.
        # Both are single observed points on the profile, so this is rotation of the skull
        # about the ear axis and is blind to the golfer translating — the same reason
        # `head_turn` below is built from the jaw contour rather than from head_center.
        face_axis = vec("chin", "nose_bridge")
        m["head_pitch"] = round(_from_vertical(face_axis), 1) if face_axis is not None else None

        # --- wrist hinge: lead forearm vs the CLUB SHAFT (doc 03 §5) ------------------
        # Not forearm-vs-hand. In golf the hand stays roughly in line with the forearm; it
        # is the *shaft* that angles away from it, which is what "hinge"/"cock" means.
        # Measured against the hand this read 170-178 deg at every event — no hinge, which
        # is impossible at the top — because it was measuring a joint that barely moves.
        fore = vec(f"{lead}_elbow", f"{lead}_wrist")
        shaft = None
        cf = (club_frames[fr["f"]] if club_frames and fr["f"] < len(club_frames) else None)
        if cf and cf.get("head") and cf.get("conf", 0) >= 0.3:
            gp, _ = _p(kp, "grip_center")
            if gp is not None:
                shaft = np.array([(cf["head"][0] - gp[0]) * aspect, cf["head"][1] - gp[1]])
        m["lead_wrist_hinge"] = round(_angle_between(fore, shaft), 1) \
            if fore is not None and shaft is not None else None

        # Shaft angle off the downward plumb line: 0 = head hanging directly below the hands,
        # +-180 = head directly above them, sign = which image side the head is on. Recomputed
        # here rather than reused from `club.frames[].shaft_angle_deg`, which is measured from
        # horizontal in raw normalised coordinates and so carries the aspect distortion on a
        # portrait clip; every angle in this module is aspect-corrected.
        #
        # WHAT IT MEANS DEPENDS ON THE VIEW, and the two readings are not the same quantity.
        # Face-on the target line runs across the image, so this is shaft lean. Down the line
        # the camera looks along the target line, so lean points at the lens and is invisible
        # — what is left is the shaft's angle in the swing plane. Read it with `shaft_plane`.
        m["shaft_from_vertical"] = round(_from_plumb(shaft), 1) if shaft is not None else None
        m["shaft_plane"] = "in-plane angle (lean not visible)" if view == "dtl" \
            else "shaft lean"
        # Kept as a secondary signal: hand deviation from the forearm (wrist cup/bow).
        # Measured along the third metacarpal (wrist -> middle knuckle), which is how wrist
        # flexion/extension is anatomically defined. The four-MCP centroid used previously
        # sits across the knuckle line, so rolling the forearm moved it and contaminated
        # this angle with rotation; `*_forearm_roll` below is where roll belongs. Falls
        # back to the centroid when no wholebody model ran.
        for side, role in SIDES:
            fo = vec(f"{side}_elbow", f"{side}_wrist")
            hd = vec(f"{side}_wrist", f"{side}_middle_mcp")
            if hd is None:
                hd = vec(f"{side}_wrist", f"{side}_hand")
            m[f"{role}_wrist_deviation"] = round(180.0 - _angle_between(fo, hd), 1) \
                if fo is not None and hd is not None else None

        # --- forearm roll: orientation of the knuckle line (doc 04 §6) ------------------
        # Pinky knuckle -> index knuckle, i.e. across the back of the hand. That line is
        # perpendicular to the forearm's long axis, so its rotation *is* supination /
        # pronation — the motion that opens and closes the clubface. Reported as a raw
        # image-plane angle: it is only meaningful as a delta against this golfer's own
        # address frame, which `compute` takes below. Never a face angle in degrees
        # (doc 04 §6) — video does not get to claim that number.
        for side, role in SIDES:
            kn = vec(f"{side}_pinky", f"{side}_index")
            m[f"{role}_forearm_roll"] = round(
                float(np.degrees(np.arctan2(kn[1], kn[0]))), 1) if kn is not None else None

        # --- lead arm straightness (shoulder-elbow-wrist) ----------------------------
        # PROJECTION-SENSITIVE. This is a 2D angle: when the arm swings out of the image
        # plane it foreshortens and reads bent even when it is straight. On swing1 it runs
        # 174 deg at address, down to a smooth 59 deg at mid-backswing, back to 171 deg at
        # impact — all at confidence 1.00, so that dip is geometry, not tracking. Trust it
        # only where the arm lies near the image plane (address, impact); doc 05 C1's
        # "lead arm straight at Top" check would be actively misled by it otherwise.
        a = vec(f"{lead}_elbow", f"{lead}_shoulder")
        b = vec(f"{lead}_elbow", f"{lead}_wrist")
        m["lead_arm_angle_2d"] = round(_angle_between(a, b), 1) \
            if a is not None and b is not None else None
        m["lead_arm_angle"] = m["lead_arm_angle_2d"]
        # `lead_arm_in_plane` — the projection guard for this angle — is computed once for
        # both arms in the joint-angle block above.

        # --- stance and feet ---------------------------------------------------------
        # Face-on only (doc 05 C1 marks it FO). Down-the-line looks along the stance line,
        # so both ankles foreshorten onto each other and the ratio is meaningless — swing2
        # reported 0.59x against a real-world 1.0-1.4x. Report None rather than a number
        # the scoring engine would grade.
        ank = vec("left_ankle", "right_ankle")
        shw = vec("left_shoulder", "right_shoulder")
        if view == "face_on" and ank is not None and shw is not None \
                and np.linalg.norm(shw) > 1e-6:
            m["stance_width_ratio"] = round(
                float(np.linalg.norm(ank) / np.linalg.norm(shw)), 2)
        else:
            m["stance_width_ratio"] = None
            m["stance_width_note"] = "face-on view only" if view != "face_on" else None
        for side, role in SIDES:
            foot = vec(f"{side}_heel", f"{side}_foot_index")
            m[f"{role}_foot_flare"] = round(float(np.degrees(np.arctan2(foot[1], foot[0]))), 1) \
                if foot is not None else None

            # Heel lift. y grows downward, so heel above the big toe is a positive value.
            # Expressed in body heights like the other displacements. Trail-heel lift
            # through impact and lead-heel lift in the backswing are both real technique
            # markers, and both are unmeasurable from heel+toe alone in a single line —
            # this needs the *vertical* separation, not the foot axis angle above.
            heel, _ = _p(kp, f"{side}_heel")
            toe, _ = _p(kp, f"{side}_foot_index")
            m[f"{role}_heel_lift"] = round(float(toe[1] - heel[1]) / bh, 4) \
                if heel is not None and toe is not None and bh > 1e-6 else None

            # How far the ankle leans off vertical above its own heel. VIEW-DEPENDENT, and
            # it measures a different thing in each: face-on this is the frontal plane, so
            # it reads roll (pronation/supination); down the line it is the sagittal plane,
            # so it reads fore/aft lean — pressure toward the toes or the heels. Both are
            # useful, they are just not the same quantity, so the name stays neutral.
            # Note the baseline is not 0: the heel keypoint sits behind the ankle joint, so
            # a neutral foot already reads ~40 deg. Only the change from address is portable.
            lean = vec(f"{side}_heel", f"{side}_ankle")
            m[f"{role}_ankle_lean"] = round(_from_vertical(lean), 1) \
                if lean is not None else None
            m["ankle_lean_plane"] = "frontal (roll)" if view == "face_on" \
                else "sagittal (fore/aft)"

            # Sole triangle. With only heel + big toe a foot is a line and roll is
            # invisible; the outer edge closes it. As the foot rolls about its long axis
            # the projected width collapses while the length holds, so the ratio moves.
            # Raw here — `compute` differences it against this golfer's address frame,
            # because the absolute value depends entirely on camera angle.
            wide = vec(f"{side}_foot_index", f"{side}_small_toe")
            long_ = vec(f"{side}_heel", f"{side}_foot_index")
            m[f"{role}_foot_width_ratio"] = round(
                float(np.linalg.norm(wide) / np.linalg.norm(long_)), 3) \
                if wide is not None and long_ is not None \
                and np.linalg.norm(long_) > 1e-6 else None

        # --- stack angles: what a coach draws as a vertical line --------------------------
        # "Chin stacked over the ball of the foot" is an angle question: take the line from
        # the foot reference up to the chin and ask how far it is from plumb. **90 deg is
        # stacked** — that is the whole convention, and every field in this block reports the
        # angle in the same 0-180 form so 90 always means the same thing.
        #
        # Three limits, all real, none of them fatal:
        #  1. The foot reference is the weak link down the line. The camera looks roughly
        #     along the toe line there, so heel->toe is foreshortened onto a short, noisy
        #     segment and the 0.75-of-foot-length point inherits that noise in x. Both feet
        #     are averaged, which halves it, and mid-foot is reported next to the ball so a
        #     disagreement between the two is visible rather than hidden.
        #  2. A plumb line in the image is only a plumb line in the world for points at the
        #     same depth. A camera tilted down at the feet skews this; nothing in the pipeline
        #     measures tilt, so the absolute value carries that error and the change from
        #     address does not.
        #  3. Which side of 90 is "toward the ball" depends on which side of the golfer the
        #     camera sits. `compute` resolves that from where the hands sit at address and
        #     publishes the signed form; unsigned is what is available here.
        def stack_deg(base_pt, top_pt):
            if base_pt is None or top_pt is None:
                return None
            v = top_pt - base_pt
            return round(float(abs(np.degrees(np.arctan2(-v[1], v[0])))), 1)

        def foot_ref(frac):
            """Mean over both feet of heel + frac*(toe - heel)."""
            pts = []
            for side in ("left", "right"):
                h, t_ = pt(f"{side}_heel"), pt(f"{side}_foot_index")
                if h is not None and t_ is not None:
                    pts.append(h + frac * (t_ - h))
            return np.mean(pts, axis=0) if pts else None

        chin_p, chin_src = first_pt("chin", "nose_bridge", "head_center")
        m["stack_anchor"] = chin_src
        m["stack_plane"] = "sagittal (toward / away from the ball)" if view == "dtl" \
            else "frontal (toward the lead / trail foot)"
        for ref_name, frac in FOOT_REF.items():
            base_pt = foot_ref(frac)
            m[f"chin_over_{ref_name}_deg"] = stack_deg(base_pt, chin_p)
            # The same line taken to the shoulders and the hips. Together with the chin these
            # are the three vertical lines a coach draws on a down-the-line still, and they
            # answer different questions: the chin is balance and head position, the
            # shoulders are posture, the hips are whether the pelvis is set back over the feet.
            m[f"shoulders_over_{ref_name}_deg"] = stack_deg(base_pt, pt("neck"))
            m[f"hips_over_{ref_name}_deg"] = stack_deg(base_pt, pt("mid_hip"))

        # --- head turn: rotation, so it can be told apart from translation -------------
        # `head_center` is an ear midpoint and cannot distinguish a golfer who slides from
        # one who merely turns to watch the club — both move it. Under yaw the jaw contour
        # foreshortens asymmetrically about the chin, so the signed imbalance of the two
        # chin->jaw distances tracks rotation and is blind to translation.
        #
        # Deliberately NOT reported in degrees. The mapping from this ratio to a real yaw
        # angle depends on face geometry and camera intrinsics we do not have; a signed
        # -1..1 asymmetry is what was actually measured (cf. doc 04 §6).
        jl = vec("jaw_left", "chin")
        jr = vec("jaw_right", "chin")
        if jl is not None and jr is not None:
            dl, dr = float(np.linalg.norm(jl)), float(np.linalg.norm(jr))
            m["head_turn"] = round((dl - dr) / (dl + dr), 3) if (dl + dr) > 1e-6 else None
        else:
            m["head_turn"] = None

        # --- torso rotation proxy (widths; `compute` turns them into angles) -----------
        # A shoulder or hip line that is square to the camera projects at full width and
        # foreshortens as it turns away, so width/address_width ~ cos(rotation). That gives
        # `xfactor_estimated` above an actual geometric basis instead of subtracting two
        # image-plane tilts. Stored raw per frame; the address reference lives in `compute`.
        m["shoulder_width"] = round(float(np.linalg.norm(sh)) / bh, 4) \
            if sh is not None and bh > 1e-6 else None
        m["hip_width"] = round(float(np.linalg.norm(hip)) / bh, 4) \
            if hip is not None and bh > 1e-6 else None

        # --- positions relative to address, in body heights ---------------------------
        # `face` is the nose bridge: a single observed point, where `head` is a midpoint
        # that silently redefines itself to one ear when the other drops out. Both are
        # reported so the two can be compared rather than one quietly replacing the other.
        for name, key in (("head_center", "head"), ("mid_hip", "hip"),
                          ("grip_center", "grip"), ("nose_bridge", "face")):
            p, c = _p(kp, name)
            m[f"{key}_x"] = round(float(p[0]), 4) if p is not None else None
            m[f"{key}_y"] = round(float(p[1]), 4) if p is not None else None

        out.append(m)

    # Sway/drift are only meaningful against Address, filled in by `compute`.
    return out, bh


def compute(frames, ev, view="dtl", handedness="right", aspect=1.0, fps=60.0,
            club_frames=None, checkpoints=None):
    series, bh = per_frame(frames, view, handedness, aspect, club_frames)
    lead_side = "left" if handedness == "right" else "right"
    trail_side = "right" if handedness == "right" else "left"
    geometry = _angle_geometry(lead_side, trail_side)
    addr_f = ev["events"]["address"]["frame"]
    base = series[addr_f] if addr_f < len(series) else series[0]
    addr_span = ev.get("address_span", [addr_f, addr_f])

    # Widest projection each body line reaches anywhere in the clip — the frame where it is
    # most nearly perpendicular to the camera axis, i.e. closest to facing. p95 rather than
    # max so one bad frame cannot set the reference for the whole swing.
    width_ref = {}
    for key in ("shoulder", "hip"):
        vals = [m[f"{key}_width"] for m in series if m.get(f"{key}_width") is not None]
        width_ref[key] = float(np.percentile(vals, 95)) if len(vals) >= 5 else None

    # --- which way the ball lies, in image x (down the line only) -----------------------
    # Several measurements are only half-useful without this. "Chin over the ball of the
    # foot" needs to know whether being off it means toward the toes or the heels; early
    # extension needs to know whether the pelvis moved toward the ball or away from it. Both
    # were previously reported as magnitudes with the direction left open (see the
    # early_extension note in `glossary` below).
    #
    # It is observable rather than configured: at address the golfer bends from the hips and
    # the arms hang out over the ball, so the hands sit toward the ball of the hip line. Down
    # the line that offset is horizontal in frame, so its sign IS the ball direction. Taken
    # as a median over the whole address hold, not one frame (D28).
    #
    # Face-on this signal does not exist — the hands sit near the body's centre line there
    # and the offset that survives is lead/trail, not toward/away — so it returns null rather
    # than a sign derived from noise. Same for a hold too short or an offset too small to be
    # distinguishable from keypoint jitter.
    s_, e_ = max(0, addr_span[0]), min(len(series), addr_span[1] + 1)
    offs = [(m["grip_x"] - m["hip_x"]) * aspect / bh
            for m in series[s_:e_] if m.get("grip_x") is not None and m.get("hip_x") is not None
            and bh > 1e-6]
    ball_dir = None
    if view == "dtl" and offs:
        off = float(np.median(offs))
        if abs(off) >= 0.02:
            ball_dir = {"sign": 1 if off > 0 else -1,
                        "offset_bh": round(off, 3),
                        "conf": round(min(1.0, abs(off) / 0.06), 2),
                        "basis": "hands sit toward the ball of the hip line at address",
                        "frames": len(offs)}

    for m in series:
        for key in ("head", "hip", "grip", "face"):
            bx, by = base.get(f"{key}_x"), base.get(f"{key}_y")
            cx, cy = m.get(f"{key}_x"), m.get(f"{key}_y")
            if None in (bx, by, cx, cy):
                m[f"{key}_sway"] = m[f"{key}_lift"] = None
            else:
                # Expressed in body heights so it is camera-distance independent.
                m[f"{key}_sway"] = round((cx - bx) * aspect / bh, 3)
                m[f"{key}_lift"] = round((by - cy) / bh, 3)

        # Rotation from projected width (see per_frame), measured against the widest this
        # golfer's shoulder/hip line ever projects — NOT against address. Address is only
        # the full-width frame in a face-on view; down the line the camera looks along the
        # stance so the shoulders start edge-on and *widen* into the backswing. Referencing
        # address made every DTL swing read 0 deg of turn at the top.
        #
        # arccos is even, so this is magnitude only: a line 30 deg open and 30 deg closed
        # project identically. Sign needs to know which way the golfer faces, which one
        # view cannot resolve, so it is left off rather than guessed.
        for key in ("shoulder", "hip"):
            ref, c = width_ref.get(key), m.get(f"{key}_width")
            m[f"{key}_facing_est"] = round(
                float(np.degrees(np.arccos(min(1.0, max(0.0, c / ref))))), 1) \
                if ref and c is not None else None

        # Sign the rotation. arccos is even, so the magnitude alone cannot tell a body
        # turned 40 deg one way from 40 deg the other — but `body_facing` can, because the
        # shoulder ordering inverts as the golfer turns through square. Signed positive when
        # the front is presented to the camera. Left unsigned where `facing_conf` is low,
        # which is exactly the edge-on zone where the ordering is unreliable; a wrong sign
        # is worse than an absent one.
        face = m.get("body_facing")
        signed = (1.0 if face == "anterior" else -1.0) if face else None
        for key in ("shoulder", "hip"):
            v = m.get(f"{key}_facing_est")
            m[f"{key}_facing_signed"] = round(v * signed, 1) \
                if v is not None and signed is not None and m.get("facing_conf", 0) >= 0.5 \
                else None

        # Turn each foot's roll and the hands' roll into a delta from address, which is the
        # only form in which they mean anything — the absolute values are camera-dependent.
        for key in ("lead_foot_width_ratio", "trail_foot_width_ratio"):
            b, c = base.get(key), m.get(key)
            m[f"{key}_delta"] = round(c - b, 3) if b is not None and c is not None else None
        for key in ("lead_forearm_roll", "trail_forearm_roll"):
            b, c = base.get(key), m.get(key)
            # Wrapped to -180..180: the knuckle line's arctan2 angle crosses the branch cut
            # during the swing, and an unwrapped difference would report a 360 deg jump.
            m[f"{key}_delta"] = round((c - b + 180.0) % 360.0 - 180.0, 1) \
                if b is not None and c is not None else None
        # Head turn is already an address-independent asymmetry, but the golfer's address
        # is rarely exactly square to the camera, so the delta is the usable signal.
        b, c = base.get("head_turn"), m.get("head_turn")
        m["head_turn_delta"] = round(c - b, 3) if b is not None and c is not None else None

        # Posture change: how much the back rounds or flattens relative to how the golfer
        # set up. Losing posture through the downswing is the coaching-relevant half; the
        # address value is the static one and lives in the summary.
        b, c = base.get("spine_curvature"), m.get("spine_curvature")
        m["spine_curvature_delta"] = round(c - b, 4) \
            if b is not None and c is not None else None

        # Stack angles signed toward the ball, now that the direction is resolved. Positive =
        # that body point sits toward the ball (over the toes); negative = back over the
        # heels. 0 = stacked. Left null wherever `ball_dir` is null, because a signed number
        # whose sign is a guess is worse than an unsigned one that is honest — the same rule
        # `shoulder_facing_signed` follows.
        for key in ("chin", "shoulders", "hips"):
            for ref_name in FOOT_REF:
                v = m.get(f"{key}_over_{ref_name}_deg")
                m[f"{key}_over_{ref_name}_signed"] = round(
                    ball_dir["sign"] * (90.0 - v), 1) \
                    if v is not None and ball_dir else None

        # Neck angle differenced only against a frame measured through the SAME head anchor.
        # nose_bridge and head_center give the same posture different absolute angles, so a
        # frame where one dropped out would otherwise report a head movement that is really
        # an anchor change.
        if (m.get("neck_angle") is not None and base.get("neck_angle") is not None
                and m.get("neck_angle_src") == base.get("neck_angle_src")):
            m["neck_angle_delta"] = round(m["neck_angle"] - base["neck_angle"], 1)
        else:
            m["neck_angle_delta"] = None

    # Second pass for the turn angles: they are differences against the address frame's own
    # facing estimate, which only exists once the first pass has run over every frame.
    for m in series:
        for key in ("shoulder", "hip"):
            b, f_ = base.get(f"{key}_facing_est"), m.get(f"{key}_facing_est")
            m[f"{key}_turn_from_address"] = round(f_ - b, 1) \
                if b is not None and f_ is not None else None
        sr, hr = m.get("shoulder_turn_from_address"), m.get("hip_turn_from_address")
        m["xfactor_rotation_est"] = round(sr - hr, 1) \
            if sr is not None and hr is not None else None

    snapshots = {}
    for name, e in ev["events"].items():
        f = min(max(e["frame"], 0), len(series) - 1)
        snapshots[name] = {k: v for k, v in series[f].items() if k != "f"}
        snapshots[name]["frame"] = f

    # Excursion flags — the thresholds doc 05 Part B wants in scoring_config.json, kept here
    # provisionally and clearly marked so they are not mistaken for a tuned rubric.
    swing = [m for m in series
             if ev["events"]["address"]["frame"] <= m["f"] <= ev["events"]["finish"]["frame"]]
    def peak(key):
        vals = [abs(m[key]) for m in swing if m.get(key) is not None]
        return round(max(vals), 3) if vals else None

    def peak_signed(key):
        """Largest positive excursion. Heel *lift* is a lift; abs() would let a heel
        pressed hard into the ground report as one."""
        vals = [m[key] for m in swing if m.get(key) is not None]
        return round(max(vals), 3) if vals else None

    def at_address(key, nd=4):
        """Median of a static measurement across the whole address hold, not one frame of it.

        The address *event* is the last frame of the quasi-static span before the takeaway
        (doc 05 A), so the frames behind it are the golfer holding their setup. Sampling
        only the final one inherits that frame's keypoint jitter for a quantity that is not
        changing; the median over the hold is the same number with the noise averaged out,
        and it rejects the odd bad frame rather than being dragged by it.

        Returns (value, frames_used) so a one-frame fallback is visible as such — a short
        hold is real (a golfer who walks in and swings) and should not look like a solid
        measurement.
        """
        s, e = ev.get("address_span", [addr_f, addr_f])
        vals = [m[key] for m in series[max(0, s):min(len(series), e + 1)]
                if m.get(key) is not None]
        if not vals:
            v = base.get(key)
            return (round(v, nd) if v is not None else None), 0
        return round(float(np.median(vals)), nd), len(vals)

    curve_addr, curve_n = at_address("spine_curvature")
    spine_addr, _ = at_address("spine_from_vertical", nd=1)
    stance_addr, _ = at_address("stance_width_ratio", nd=2)

    # --- the ten checkpoints (Stage 5b) -------------------------------------------------
    # Every angle sampled at each of the ten positions a coach talks about, plus its change
    # from address — doc 05 Part B asks for exactly that ("every metric sampled at each
    # event + deltas vs. Address") and until now only the raw snapshots existed.
    #
    # Two deliberate differences from `event_snapshots`, which stays as it was:
    #  * P1's angles are medians over the address hold, not that one frame (D28). It is the
    #    checkpoint whose numbers every delta is measured against, so it is the one place
    #    where sampling a single frame's jitter would contaminate the whole table.
    #  * Deltas are only taken for fields ANGLE_FIELDS marks as differenceable. Turn angles
    #    are already measured from address, and a delta of a delta is nonsense.
    cp_items = []
    for it in (checkpoints or {}).get("items", []):
        f = min(max(int(it["frame"]), 0), len(series) - 1)
        vals = {k: v for k, v in series[f].items() if k != "f"}
        if it["id"] == "address":
            for spec in ANGLE_FIELDS:
                med, n_ = at_address(spec["field"], nd=1)
                if n_:
                    vals[spec["field"]] = med
            # Rederive the ball-signed stack angles from the medians just substituted, rather
            # than leaving the single-frame values beside them. They are two views of one
            # number (signed = sign * (90 - deg)), and one row of the table disagreeing with
            # itself is worse than either value alone.
            if ball_dir:
                for key in ("chin", "shoulders", "hips"):
                    for ref_name in FOOT_REF:
                        d = vals.get(f"{key}_over_{ref_name}_deg")
                        if d is not None:
                            vals[f"{key}_over_{ref_name}_signed"] = round(
                                ball_dir["sign"] * (90.0 - d), 1)
        delta = {}
        for spec in ANGLE_FIELDS:
            if not spec["delta"]:
                continue
            field = spec["field"]
            b, c = base.get(field), vals.get(field)
            if isinstance(b, (int, float)) and isinstance(c, (int, float)):
                delta[field] = round(c - b, 1)
        cp_items.append({**{k: it[k] for k in
                            ("p", "id", "label", "phase", "event", "basis", "definition")},
                         "frame": f, "conf": it["conf"], "values": vals,
                         "delta_from_address": delta})

    # --- standard golf vocabulary (docs/GLOSSARY.md) ------------------------------------
    # The measurements above are geometry. These are the same numbers under the names a
    # coach uses, so the scorecard, the AI narrative and the UI all speak one language
    # instead of three. Nothing new is computed here — it is a naming layer, and it reports
    # null in views where the underlying geometry does not support the term.
    #
    # Primary vs secondary tilt are the SAME measurement in different views, which is why
    # each is null in the other: primary tilt is forward bend, visible only from the side;
    # secondary tilt is side bend away from the target, visible only face-on. Reporting one
    # number under both names would be the same mistake as `stance_width_ratio` in DTL.
    dtl = view == "dtl"
    posture_type, posture_note = None, None
    if dtl and curve_addr is not None:
        # C-posture is a rounded upper back, S-posture an arched lower back — opposite signs
        # of the same sagitta. The threshold is a placeholder, NOT a tuned rubric: nothing
        # has validated this scale against a known-good posture assessment yet (D27), and it
        # belongs in scoring_config.json once something has.
        if abs(curve_addr) < 0.03:
            posture_type = "neutral"
        else:
            posture_type = "C-posture" if curve_addr > 0 else "S-posture"
        posture_note = ("one curvature value; cannot separate thoracic from lumbar, and the "
                        "scale is unvalidated — see DECISIONS D27")

    glossary = {
        "address_frame": addr_f,
        "spine_angle": spine_addr,
        "primary_tilt": spine_addr if dtl else None,
        "secondary_tilt": spine_addr if not dtl else None,
        "stance": stance_addr,
        "posture_type": posture_type,
        "posture_value": curve_addr if dtl else None,
        "posture_note": posture_note,
        # Coil is upper body wound over lower body — the same quantity as x-factor, named
        # the way a coach says it.
        "coil_at_top": snapshots.get("top", {}).get("xfactor_rotation_est"),
        "takeaway_frames": [ev["events"]["address"]["frame"], ev["events"]["toe_up"]["frame"]],
        "transition_frames": [ev["events"]["top"]["frame"],
                              ev["events"]["mid_downswing"]["frame"]],
        # Early extension is the pelvis thrusting toward the ball during the downswing. Down
        # the line the camera looks along the target line, so that thrust is horizontal in
        # frame and hip_sway measures it directly. Face-on it is depth, which one view
        # cannot see at all.
        #
        # Signed, and the sign is NOT resolved: which direction is "toward the ball" depends
        # on which side of the golfer the camera sits, and nothing in the pipeline records
        # that. So this is the largest hip excursion between top and impact with its sign
        # preserved for whoever can disambiguate it — not a claim that motion was toward the
        # ball. Magnitude is the usable half today.
        "early_extension": (max(
            [m["hip_sway"] for m in series
             if ev["events"]["top"]["frame"] <= m["f"] <= ev["events"]["impact"]["frame"]
             and m.get("hip_sway") is not None] or [None], key=lambda v: abs(v) if v else 0)
            if dtl else None),
        "early_extension_note": (
            ("positive = pelvis moved toward the ball, resolved from where the hands sit at "
             "address (see ball_direction)" if ball_dir else
             "sign unresolved — the ball direction could not be read from this setup; use "
             "the magnitude") if dtl else "down-the-line view only"),
        # Which image direction the ball lies in, and how confidently. Null face-on.
        "ball_direction": ball_dir,
        # Setup stack: how far the chin sits off a plumb line through the ball of the foot at
        # address, in degrees, where 0 is stacked. The signed form is positive toward the
        # ball; it is null wherever `ball_direction` is.
        "chin_stack_at_address": (at_address("chin_over_ball_of_foot_deg", nd=1)[0]
                                  if dtl else None),
        "chin_stack_toward_ball": (at_address("chin_over_ball_of_foot_signed", nd=1)[0]
                                   if dtl and ball_dir else None),
        "hip_hinge_at_address": at_address("lead_hip_hinge", nd=1)[0] if dtl else None,
        "neck_angle_at_address": at_address("neck_angle", nd=1)[0],
        "tempo": ev.get("tempo"),
        "swing_plane": None,   # fitted in club.py; surfaced there, not duplicated here
    }

    return {
        "body_height_norm": round(bh, 4),
        "glossary": glossary,
        "units": "angles in degrees; sway/lift in golfer body-heights",
        "provisional_thresholds": True,
        "series": series,
        "event_snapshots": snapshots,
        # The ten coaching positions with every angle at each, and its change from address.
        # `event_snapshots` above is the same data keyed by the eight GolfDB events; this is
        # the ten-position view, and it is the one the UI and the coach narrative read.
        "checkpoints": cp_items,
        "checkpoint_notes": (checkpoints or {}).get("notes", []),
        # The angle catalogue as data, so a consumer renders the table without duplicating
        # the field list. `view` says where the field means what its name says, `delta`
        # whether the change from address is the usable form, `when` where in the swing it
        # is worth reading at all, and `geom` where on the body to draw it (null = not
        # drawable, which is only the rotation estimates). A new dict per call — ANGLE_FIELDS
        # is a module constant and geometry depends on this swing's handedness.
        "angle_fields": [{**spec, "geom": geometry.get(spec["field"])}
                         for spec in ANGLE_FIELDS],
        "summary": {
            "max_head_sway": peak("head_sway"),
            # Same quantity off the nose bridge instead of the ear midpoint. A gap between
            # this and max_head_sway means the ear-midpoint anchor moved for a reason other
            # than the golfer moving — read `max_head_turn` next to it.
            "max_face_sway": peak("face_sway"),
            "max_face_lift": peak("face_lift"),
            "max_head_turn": peak("head_turn_delta"),
            "max_hip_sway": peak("hip_sway"),
            # Setup measurements, taken as the median over the whole address hold rather
            # than the single address frame — these are static quantities, so averaging the
            # hold is strictly better than sampling one frame of it.
            "spine_at_address": spine_addr,
            # Static back shape at setup. DTL only, and the scale is not yet validated
            # against any known-good posture assessment — see D27 before scoring it.
            "spine_curvature_at_address": curve_addr if view == "dtl" else None,
            "address_hold_frames": curve_n,
            # Kept, but it is the confounded half: once the torso turns, the shoulder
            # midpoint moves for reasons unrelated to the spine's shape (D27).
            "max_spine_curvature_change": peak("spine_curvature_delta") if view == "dtl" else None,
            "stance_width_ratio": stance_addr,
            "lead_wrist_hinge_at_top": snapshots.get("top", {}).get("lead_wrist_hinge"),
            "lead_arm_at_top": snapshots.get("top", {}).get("lead_arm_angle"),
            # Setup angles, medians over the address hold like the two above.
            "lead_hip_hinge_at_address": at_address("lead_hip_hinge", nd=1)[0],
            "trail_hip_hinge_at_address": at_address("trail_hip_hinge", nd=1)[0],
            "lead_knee_flex_at_address": at_address("lead_knee_flex", nd=1)[0],
            "trail_knee_flex_at_address": at_address("trail_knee_flex", nd=1)[0],
            "neck_angle_at_address": at_address("neck_angle", nd=1)[0],
            "lead_arm_hang_at_address": at_address("lead_arm_hang", nd=1)[0],
            "chin_over_ball_of_foot_at_address": (
                at_address("chin_over_ball_of_foot_deg", nd=1)[0] if view == "dtl" else None),
            # Trail elbow folded at the top and lead elbow straight are the two arm checks
            # doc 05 C1 names; both are projection-sensitive, so read `lead_arm_in_plane`
            # from the same snapshot before trusting either.
            "trail_elbow_flex_at_top": snapshots.get("top", {}).get("trail_elbow_flex"),
            "lead_elbow_flex_at_top": snapshots.get("top", {}).get("lead_elbow_flex"),
            "lead_arm_in_plane_at_top": snapshots.get("top", {}).get("lead_arm_in_plane"),
            # Shaft angle at impact. Face-on this is shaft lean; down the line it is the
            # in-plane angle and lean is invisible — `shaft_plane` in the series says which.
            "shaft_from_vertical_at_impact": snapshots.get("impact", {}).get(
                "shaft_from_vertical"),
            # How much of the setup spine angle survived to impact. Losing it is the
            # standing-up fault; gaining it is diving into the ball.
            "spine_change_at_impact": (
                round(snapshots["impact"]["spine_from_vertical"] - spine_addr, 1)
                if spine_addr is not None
                and snapshots.get("impact", {}).get("spine_from_vertical") is not None
                else None),
            "xfactor_estimated_at_top": snapshots.get("top", {}).get("xfactor_estimated"),
            "xfactor_rotation_at_top": snapshots.get("top", {}).get("xfactor_rotation_est"),
            "shoulder_turn_at_top": snapshots.get("top", {}).get("shoulder_turn_from_address"),
            "hip_turn_at_top": snapshots.get("top", {}).get("hip_turn_from_address"),
            # Forearm roll from address to impact — the body-measured half of the face
            # story. Not a face angle: doc 04 §6 reserves degrees for the impact image.
            # The series is already keyed lead_/trail_, so these no longer re-derive the
            # side from handedness — one place decides it, in per_frame.
            "lead_forearm_roll_at_impact": snapshots.get("impact", {}).get(
                "lead_forearm_roll_delta"),
            "max_trail_heel_lift": peak_signed("trail_heel_lift"),
            "max_lead_heel_lift": peak_signed("lead_heel_lift"),
            # Which side of the body the camera sees at each end of the swing. A golfer
            # finishes facing the target, so these normally differ.
            "facing_at_address": snapshots.get("address", {}).get("body_facing"),
            "facing_at_finish": snapshots.get("finish", {}).get("body_facing"),
        },
        # Restated so nothing downstream has to re-derive it from `handedness` and risk
        # disagreeing with the series keys.
        "sides": {"handedness": handedness, "lead": lead_side, "trail": trail_side,
                  "note": "lead = side closest to the target; not the side facing the camera"},
    }
