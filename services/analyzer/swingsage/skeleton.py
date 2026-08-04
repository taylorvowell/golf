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
]

KEYPOINT_NAMES = NATIVE_NAMES + [d[0] for d in DERIVED]
DERIVED_NAMES = [d[0] for d in DERIVED]
IDX = {name: i for i, name in enumerate(KEYPOINT_NAMES)}

# Hand landmarks 17-22 are unreliable while gripping a club (doc 03 §2) — the club
# pipeline owns that region. Excluded from rendering and from sanity checks.
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
]

# Joints worth drawing. Eyes/mouth add clutter without coaching value; head_center stands in.
RENDER_JOINTS = [n for n in KEYPOINT_NAMES if n not in UNRELIABLE and not (
    n.endswith("_eye") or "_eye_" in n or n.startswith("mouth_") or n == "nose"
)]


def add_derived(kp, st=None):
    """Append derived joints to one frame's keypoint list.

    kp: list of [x, y, conf] for the 33 native landmarks (mutated in place, then returned).
    st: optional parallel status list, extended in step so provenance survives.

    A missing parent yields a missing derived joint rather than a midpoint of garbage,
    except where `allow_single` permits falling back to the surviving parent.
    """
    for name, a, b, allow_single in DERIVED:
        pa, pb = kp[IDX[a]], kp[IDX[b]]
        live = [p for p in (pa, pb) if p[2] > 0.0]
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
    return kp
