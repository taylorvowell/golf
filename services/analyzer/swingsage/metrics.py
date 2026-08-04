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
"""
from __future__ import annotations

import numpy as np

from .skeleton import IDX

MIN_CONF = 0.35


def _p(kp, name):
    q = kp[IDX[name]]
    return (np.array([q[0], q[1]]), q[2]) if q[2] >= MIN_CONF else (None, 0.0)


def _angle_between(v1, v2):
    a = np.arctan2(v1[1], v1[0]) - np.arctan2(v2[1], v2[0])
    return float(abs((np.degrees(a) + 180) % 360 - 180))


def _from_vertical(v):
    """Signed angle of a vector from straight up, in degrees; y grows downward."""
    return float(np.degrees(np.arctan2(v[0], -v[1])))


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
    lead = "left" if handedness == "right" else "right"
    trail = "right" if handedness == "right" else "left"
    out = []

    for fr in frames:
        kp = fr["kp"]
        m: dict = {"f": fr["f"]}

        def vec(a, b):
            pa, _ = _p(kp, a)
            pb, _ = _p(kp, b)
            if pa is None or pb is None:
                return None
            return np.array([(pb[0] - pa[0]) * aspect, pb[1] - pa[1]])

        # --- posture ---------------------------------------------------------------
        spine = vec("mid_hip", "neck")
        m["spine_from_vertical"] = round(_from_vertical(spine), 1) if spine is not None else None

        sh = vec("left_shoulder", "right_shoulder")
        hip = vec("left_hip", "right_hip")
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

        # --- knee flex (hip-knee-ankle interior angle) -------------------------------
        for side in ("left", "right"):
            a = vec(f"{side}_knee", f"{side}_hip")
            b = vec(f"{side}_knee", f"{side}_ankle")
            m[f"{side}_knee_flex"] = round(180.0 - _angle_between(a, b), 1) \
                if a is not None and b is not None else None

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
        # Kept as a secondary signal: hand deviation from the forearm (wrist cup/bow).
        for side in ("left", "right"):
            fo = vec(f"{side}_elbow", f"{side}_wrist")
            hd = vec(f"{side}_wrist", f"{side}_hand")
            m[f"{side}_wrist_deviation"] = round(180.0 - _angle_between(fo, hd), 1) \
                if fo is not None and hd is not None else None

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
        # In-plane proxy: how much of the upper arm's length survives projection. Near 1.0
        # the arm lies in the image plane and the angle above is trustworthy.
        if a is not None and b is not None:
            span = float(np.linalg.norm(a) + np.linalg.norm(b))
            m["lead_arm_in_plane"] = round(min(1.0, span / (0.42 * _body_height(frames))), 2)
        else:
            m["lead_arm_in_plane"] = None

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
        for side in ("left", "right"):
            foot = vec(f"{side}_heel", f"{side}_foot_index")
            m[f"{side}_foot_flare"] = round(float(np.degrees(np.arctan2(foot[1], foot[0]))), 1) \
                if foot is not None else None

        # --- positions relative to address, in body heights ---------------------------
        for name, key in (("head_center", "head"), ("mid_hip", "hip"),
                          ("grip_center", "grip")):
            p, c = _p(kp, name)
            m[f"{key}_x"] = round(float(p[0]), 4) if p is not None else None
            m[f"{key}_y"] = round(float(p[1]), 4) if p is not None else None

        out.append(m)

    # Sway/drift are only meaningful against Address, filled in by `compute`.
    return out, bh


def compute(frames, ev, view="dtl", handedness="right", aspect=1.0, fps=60.0,
            club_frames=None):
    series, bh = per_frame(frames, view, handedness, aspect, club_frames)
    addr_f = ev["events"]["address"]["frame"]
    base = series[addr_f] if addr_f < len(series) else series[0]

    for m in series:
        for key in ("head", "hip", "grip"):
            bx, by = base.get(f"{key}_x"), base.get(f"{key}_y")
            cx, cy = m.get(f"{key}_x"), m.get(f"{key}_y")
            if None in (bx, by, cx, cy):
                m[f"{key}_sway"] = m[f"{key}_lift"] = None
            else:
                # Expressed in body heights so it is camera-distance independent.
                m[f"{key}_sway"] = round((cx - bx) * aspect / bh, 3)
                m[f"{key}_lift"] = round((by - cy) / bh, 3)

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

    return {
        "body_height_norm": round(bh, 4),
        "units": "angles in degrees; sway/lift in golfer body-heights",
        "provisional_thresholds": True,
        "series": series,
        "event_snapshots": snapshots,
        "summary": {
            "max_head_sway": peak("head_sway"),
            "max_hip_sway": peak("hip_sway"),
            "spine_at_address": base.get("spine_from_vertical"),
            "stance_width_ratio": base.get("stance_width_ratio"),
            "lead_wrist_hinge_at_top": snapshots.get("top", {}).get("lead_wrist_hinge"),
            "lead_arm_at_top": snapshots.get("top", {}).get("lead_arm_angle"),
            "xfactor_estimated_at_top": snapshots.get("top", {}).get("xfactor_estimated"),
        },
    }
