"""Product skeleton definition (doc 03 §2).

MediaPipe's 33 native BlazePose landmarks, plus the derived joints the product needs
appended after them. The keypoint order defined here IS the array order in analysis.json —
`analysis.json.pose.keypoint_names` is generated from KEYPOINT_NAMES, so the contract stays
self-describing. Never reorder; only append.
"""

# --- MediaPipe BlazePose native landmark order (indices 0-32) ---
NATIVE_NAMES = [
    "nose",
    "left_eye_inner", "left_eye", "left_eye_outer",
    "right_eye_inner", "right_eye", "right_eye_outer",
    "left_ear", "right_ear",
    "mouth_left", "mouth_right",
    "left_shoulder", "right_shoulder",
    "left_elbow", "right_elbow",
    "left_wrist", "right_wrist",
    "left_pinky", "right_pinky",
    "left_index", "right_index",
    "left_thumb", "right_thumb",
    "left_hip", "right_hip",
    "left_knee", "right_knee",
    "left_ankle", "right_ankle",
    "left_heel", "right_heel",
    "left_foot_index", "right_foot_index",
]
N_NATIVE = len(NATIVE_NAMES)

# --- Derived joints, appended after the native 33 (doc 03 §2) ---
# (name, parent_a, parent_b, allow_single). Each is the midpoint of two keypoints, with
# confidence = min of its parents.
#
# `allow_single` says whether one surviving parent is enough. It is only true where the
# single-parent answer is anatomically close to the midpoint: the ears sit either side of a
# narrow head, and both hands share one grip. It is false for neck/mid_hip, where one
# shoulder or hip would place the joint half a body-width off. This matters most for
# grip_center — it anchors club detection (doc 04 Layer B), and on our fixtures the far
# wrist is the least reliable joint in the skeleton, so requiring both would leave the
# anchor undefined for most of the swing.
DERIVED = [
    ("neck",        "left_shoulder", "right_shoulder", False),
    ("mid_hip",     "left_hip",      "right_hip",      False),
    ("spine_mid",   "neck",          "mid_hip",        False),  # uses earlier derived points
    ("head_center", "left_ear",      "right_ear",      True),
    ("grip_center", "left_wrist",    "right_wrist",    True),
    # Per-hand knuckle centroids, populated from a wholebody model. Kept separate from
    # grip_center because wrist hinge is a per-side quantity: measuring it against the shared
    # grip gives ~177 deg (no hinge) at the top, which is anatomically impossible. The
    # wrist->own-knuckles vector is the hand's real axis.
    ("left_hand",   "left_wrist",    "left_wrist",     True),
    ("right_hand",  "right_wrist",   "right_wrist",    True),
]

# --- Measured points, appended after the derived block (D25) --------------------------
# Direct model outputs with no MediaPipe-era native slot. Unlike DERIVED these are not
# computed from other keypoints, and unlike NATIVE they only exist when a wholebody model
# ran — the Halpe26 path leaves them missing, which every consumer already handles.
#
# They are appended *after* the derived joints rather than slotted next to the native 33,
# because doc 02 fixes the array order and indices 0-39 are already published. Append only.
MEASURED = [
    # Third-metacarpal knuckle. Wrist flexion/extension is defined along this bone, so it
    # is the hand's real axis; the four-MCP centroid used before blends roll into the
    # flexion reading (see metrics.wrist_deviation).
    "left_middle_mcp", "right_middle_mcp",
    # Outer foot edge. heel + big toe give the foot's long axis only; the small toe closes
    # the triangle, which is what makes width (and therefore roll) measurable.
    "left_small_toe", "right_small_toe",
    # Head anchors. `head_center` is an ear midpoint that silently redefines itself to a
    # single ear when one drops out (see DERIVED below) — these are single observed points
    # that cannot do that. In a down-the-line view all three sit on the visible profile
    # silhouette, which is the best case for this camera angle.
    "chin", "nose_bridge",
    # Jaw contour endpoints, near the ears. Only used to separate head *rotation* from head
    # *translation*: a golfer who merely turns to follow the club currently reads as sway.
    # Named jaw_left/jaw_right, not left_jaw/right_jaw, to stay out of the left_/right_
    # limb-swap pairing in postprocess — these are face sides, not body sides.
    "jaw_left", "jaw_right",
]

# Points Stage 3 tracks and smooths: the native block plus the measured extras. Derived
# joints are excluded by design — doc 03 §3.6 requires them recomputed *after* smoothing.
TRACKED_NAMES = NATIVE_NAMES + MEASURED
N_TRACKED = len(TRACKED_NAMES)

KEYPOINT_NAMES = NATIVE_NAMES + [d[0] for d in DERIVED] + MEASURED
DERIVED_NAMES = [d[0] for d in DERIVED]
IDX = {name: i for i, name in enumerate(KEYPOINT_NAMES)}

# Hand landmarks 17-22 are unreliable while gripping a club (doc 03 §2) — the club
# pipeline owns that region. Excluded from rendering and from sanity checks.
#
# That verdict is about MediaPipe, which infers these from the body model and cannot see a
# closed fist. A wholebody model measures the hand directly and fills the same three slots
# with real index/pinky/thumb MCP joints, so Stage 3 takes `trust_hands` and skips this
# blanket rejection on that path (D25).
UNRELIABLE = {"left_pinky", "right_pinky", "left_index", "right_index",
              "left_thumb", "right_thumb"}

SIDE_LEFT, SIDE_RIGHT, SIDE_MID = "L", "R", "M"

# (a, b, side) — side drives the render hue (doc 03 §6)
BONES = [
    ("head_center", "neck", SIDE_MID),
    ("neck", "spine_mid", SIDE_MID),
    ("spine_mid", "mid_hip", SIDE_MID),
    ("neck", "left_shoulder", SIDE_LEFT),
    ("neck", "right_shoulder", SIDE_RIGHT),
    ("left_shoulder", "left_elbow", SIDE_LEFT),
    ("left_elbow", "left_wrist", SIDE_LEFT),
    ("right_shoulder", "right_elbow", SIDE_RIGHT),
    ("right_elbow", "right_wrist", SIDE_RIGHT),
    # The hands: wrist bone out to where the hands actually hold the club. Without these the
    # skeleton stops at the wrist and the club appears detached from the body.
    ("left_wrist", "grip_center", SIDE_LEFT),
    ("right_wrist", "grip_center", SIDE_RIGHT),
    ("mid_hip", "left_hip", SIDE_LEFT),
    ("mid_hip", "right_hip", SIDE_RIGHT),
    ("left_hip", "left_knee", SIDE_LEFT),
    ("left_knee", "left_ankle", SIDE_LEFT),
    ("right_hip", "right_knee", SIDE_RIGHT),
    ("right_knee", "right_ankle", SIDE_RIGHT),
    ("left_ankle", "left_heel", SIDE_LEFT),
    ("left_heel", "left_foot_index", SIDE_LEFT),
    ("right_ankle", "right_heel", SIDE_RIGHT),
    ("right_heel", "right_foot_index", SIDE_RIGHT),
    # Outer foot edge, closing the sole triangle. Drawn so heel lift and roll are visible
    # in the burn-in — a foot rendered as a single line cannot show either.
    ("left_heel", "left_small_toe", SIDE_LEFT),
    ("left_small_toe", "left_foot_index", SIDE_LEFT),
    ("right_heel", "right_small_toe", SIDE_RIGHT),
    ("right_small_toe", "right_foot_index", SIDE_RIGHT),
    # Knuckle line. Its orientation is forearm roll (supination/pronation), so seeing it
    # rotate through the swing is the check that the measurement is real.
    ("left_pinky", "left_index", SIDE_LEFT),
    ("right_pinky", "right_index", SIDE_RIGHT),
    # Face profile. Two points, drawn only so head orientation is legible next to the
    # head_center dot; nothing downstream renders off it.
    ("chin", "nose_bridge", SIDE_MID),
]

# Joints worth drawing. Eyes/mouth add clutter without coaching value; head_center stands in.
# The jaw endpoints are measurement inputs for head turn, not skeleton — same treatment.
RENDER_JOINTS = [n for n in KEYPOINT_NAMES if n not in UNRELIABLE and not (
    n.endswith("_eye") or "_eye_" in n or n.startswith("mouth_") or n == "nose"
    or n.startswith("jaw_")
)]


def add_derived(kp, st=None, grip=None, hands=None):
    """Insert derived joints into one frame's keypoint list.

    kp: list of [x, y, conf] for the tracked landmarks — the 33 native ones, optionally
        followed by the measured extras (mutated in place, then returned).
    st: optional parallel status list, extended in step so provenance survives.

    The published order is native -> derived -> measured (doc 02 fixes indices 0-39), but
    Stage 3 hands back native -> measured because those are the points it smooths. So the
    measured tail is lifted off, the derived block appended, and the tail put back.

    A missing parent yields a missing derived joint rather than a midpoint of garbage,
    except where `allow_single` permits falling back to the surviving parent.
    """
    measured = kp[N_NATIVE:]
    del kp[N_NATIVE:]
    m_st = None
    if st is not None:
        m_st = st[N_NATIVE:]
        del st[N_NATIVE:]

    for name, a, b, allow_single in DERIVED:
        pa, pb = kp[IDX[a]], kp[IDX[b]]
        live = [p for p in (pa, pb) if p[2] > 0.0]
        if name in ("left_hand", "right_hand"):
            side = name.split("_")[0]
            hp = (hands or {}).get(side)
            if hp and hp[2] > 0.0:
                kp.append([float(hp[0]), float(hp[1]), float(hp[2])])
            else:
                kp.append([0.0, 0.0, 0.0])
            if st is not None:
                st.append(2 if kp[-1][2] >= 0.5 else (1 if kp[-1][2] > 0.0 else 0))
            continue

        if name == "grip_center":
            # Measured knuckles beat any estimate: a wholebody model gives the MCP joints the
            # club actually rests across, so use them directly when available.
            if grip is not None and grip[2] > 0.0:
                kp.append([float(grip[0]), float(grip[1]), float(grip[2])])
                if st is not None:
                    st.append(2 if grip[2] >= 0.5 else 1)
                continue
            # The wrists are the wrist *bone*; the hands hold the club roughly a hand-length
            # beyond that, along the forearm. Using the raw wrist midpoint starts the club
            # short and inside the real grip, and the error grows through the follow-through
            # as the wrists roll. Project outward from the wrist along elbow->wrist.
            #
            # Hand length is ~0.5x forearm in adult proportion and the club sits mid-hand,
            # so ~0.33x forearm places the grip between the hands. Proportional to the
            # golfer's own limb, so it holds for a junior or an adult at any camera distance.
            pts, offs = [], []
            for side in ("left", "right"):
                wr, el = kp[IDX[f"{side}_wrist"]], kp[IDX[f"{side}_elbow"]]
                if wr[2] <= 0.0:
                    continue
                pts.append(wr)
                if el[2] > 0.0:
                    vx, vy = wr[0] - el[0], wr[1] - el[1]
                    n = (vx * vx + vy * vy) ** 0.5
                    offs.append((vx / n * n * 0.33, vy / n * n * 0.33) if n > 1e-9 else (0.0, 0.0))
            if pts:
                x = sum(p[0] for p in pts) / len(pts)
                y = sum(p[1] for p in pts) / len(pts)
                if offs:
                    x += sum(o[0] for o in offs) / len(offs)
                    y += sum(o[1] for o in offs) / len(offs)
                c = max(p[2] for p in pts) if len(pts) == 2 and min(p[2] for p in pts) >= 0.5 \
                    else min(0.6, max(p[2] for p in pts)) if len(pts) == 1 \
                    else min(p[2] for p in pts)
                kp.append([x, y, c])
            else:
                kp.append([0.0, 0.0, 0.0])
            if st is not None:
                st.append(2 if kp[-1][2] >= 0.5 else (1 if kp[-1][2] > 0.0 else 0))
            continue

        if len(live) == 2 and name == "grip_center":
            # Both hands share one grip, so the wrists are two observations of the same
            # point rather than two ends of a segment. Averaging in a weak wrist drags the
            # club-search anchor off the hands; instead defer to the confident wrist, and
            # treat agreement between two confident wrists as corroboration (max, not min).
            hi, lo = (pa, pb) if pa[2] >= pb[2] else (pb, pa)
            if hi[2] >= 0.5 > lo[2]:
                kp.append([hi[0], hi[1], hi[2]])
            else:
                c = max(pa[2], pb[2]) if min(pa[2], pb[2]) >= 0.5 else min(pa[2], pb[2])
                kp.append([(pa[0] + pb[0]) / 2.0, (pa[1] + pb[1]) / 2.0, c])
        elif len(live) == 2:
            kp.append([(pa[0] + pb[0]) / 2.0, (pa[1] + pb[1]) / 2.0, min(pa[2], pb[2])])
        elif len(live) == 1 and allow_single:
            p = live[0]
            # Single-parent stand-in: keep the position but cap confidence so the UI still
            # renders it as unverified and downstream checks can tell it apart.
            kp.append([p[0], p[1], min(p[2], 0.6)])
        else:
            kp.append([0.0, 0.0, 0.0])
        if st is not None:
            st.append(2 if kp[-1][2] >= 0.5 else (1 if kp[-1][2] > 0.0 else 0))

    # Restore the measured tail, padded when an estimator supplied none (the Halpe26 and
    # MediaPipe paths), so every frame's array is the same width as KEYPOINT_NAMES.
    measured += [[0.0, 0.0, 0.0]] * (len(MEASURED) - len(measured))
    kp.extend(measured)
    if st is not None:
        m_st += [0] * (len(MEASURED) - len(m_st))
        st.extend(m_st)
    return kp
