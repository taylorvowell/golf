"""Prove the RTMW-133 sub-block layout against real pixels, before anything maps it.

The 133-point array is documented by block boundaries only (pose_rtm.py: body 0-16, feet
17-22, face 23-90, hands 91-132). The ordering *inside* each block is the COCO-WholeBody
convention, which we had never verified — and this repo's history is that unverified
index assumptions look fine in aggregate numbers and are visibly wrong on the frame.

    python scripts/kpdebug.py <video> [--frame N] [--out DIR]

Writes labelled crops (face / hands / feet) plus a PASS/FAIL table of geometric assertions
that only hold if the conventional ordering is the real one.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import mediapipe as mp  # noqa: E402

from swingsage import pose  # noqa: E402

# --- the layout under test ------------------------------------------------------------
FACE0, LHAND0, RHAND0 = 23, 91, 112
FEET = {17: "L big toe", 18: "L small toe", 19: "L heel",
        20: "R big toe", 21: "R small toe", 22: "R heel"}

# 68-point iBUG face: contour 0-16, brows 17-26, nose bridge 27-30, nostrils 31-35,
# eyes 36-47, mouth 48-67.
FACE_PARTS = {"contour": range(0, 17), "brow_r": range(17, 22), "brow_l": range(22, 27),
              "bridge": range(27, 31), "nostrils": range(31, 36),
              "eye_r": range(36, 42), "eye_l": range(42, 48), "mouth": range(48, 68)}
# 21-point hand: 0 wrist, then thumb/index/middle/ring/pinky in fours (MCP->PIP->DIP->tip).
HAND_PARTS = {"wrist": [0], "thumb": range(1, 5), "index": range(5, 9),
              "middle": range(9, 13), "ring": range(13, 17), "pinky": range(17, 21)}


def person_box(frame_bgr, pad=0.22):
    """Padded person box in pixels, from a single MediaPipe IMAGE-mode detection."""
    from mediapipe.tasks.python import vision
    h, w = frame_bgr.shape[:2]
    lm = vision.PoseLandmarker.create_from_options(
        pose._make_options(vision.RunningMode.IMAGE))
    rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
    res = lm.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))
    if not res.pose_landmarks:
        return [0, 0, w, h]
    pts = [(p.x, p.y) for p in res.pose_landmarks[0]]
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    span = max(max(xs) - min(xs), max(ys) - min(ys))
    d = span * pad
    return [max(0.0, min(xs) - d) * w, max(0.0, min(ys) - d) * h,
            min(1.0, max(xs) + d) * w, min(1.0, max(ys) + d) * h]


def crop(img, pts, idxs, labels, path, pad=28, scale=4):
    """Zoomed crop with every index labelled, so the ordering is readable by eye."""
    sel = np.array([pts[i] for i in idxs], float)
    x0, y0 = sel.min(axis=0) - pad
    x1, y1 = sel.max(axis=0) + pad
    x0, y0 = max(0, int(x0)), max(0, int(y0))
    x1, y1 = min(img.shape[1], int(x1)), min(img.shape[0], int(y1))
    if x1 - x0 < 4 or y1 - y0 < 4:
        print(f"  (crop {path.name} degenerate — points off-frame)")
        return
    sub = cv2.resize(img[y0:y1, x0:x1], None, fx=scale, fy=scale,
                     interpolation=cv2.INTER_CUBIC)
    for i, lab in zip(idxs, labels):
        px = int((pts[i][0] - x0) * scale)
        py = int((pts[i][1] - y0) * scale)
        cv2.circle(sub, (px, py), 3, (0, 255, 255), -1)
        cv2.putText(sub, lab, (px + 4, py - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.35,
                    (0, 0, 0), 3, cv2.LINE_AA)
        cv2.putText(sub, lab, (px + 4, py - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.35,
                    (60, 255, 60), 1, cv2.LINE_AA)
    cv2.imwrite(str(path), sub)
    print(f"  wrote {path.name}  ({x1 - x0}x{y1 - y0} @ {scale}x)")


def check(name, ok, detail=""):
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}{('  — ' + detail) if detail else ''}")
    return bool(ok)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("--frame", type=int, default=0)
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    src = Path(args.video).resolve()
    out = Path(args.out).resolve() if args.out else Path("out") / f"kpdebug_{src.stem}"
    out.mkdir(parents=True, exist_ok=True)

    cap = cv2.VideoCapture(str(src))
    if not cap.isOpened():
        print(f"could not open {src}")
        return 1
    cap.set(cv2.CAP_PROP_POS_FRAMES, args.frame)
    ok, img = cap.read()
    cap.release()
    if not ok:
        print(f"could not read frame {args.frame}")
        return 1
    h, w = img.shape[:2]
    print(f"frame {args.frame} of {src.name}  {w}x{h}")

    from rtmlib import RTMPose
    from swingsage.pose_rtm import WHOLEBODY_MODELS
    url, size = WHOLEBODY_MODELS["performance"]
    model = RTMPose(url, model_input_size=size, backend="onnxruntime", device="cpu")
    kps, scores = model(img, bboxes=[person_box(img)])
    if not len(kps):
        print("no detection on this frame")
        return 1
    pts, sc = np.asarray(kps[0], float), np.asarray(scores[0], float)
    print(f"returned {len(pts)} keypoints, mean score {sc.mean():.3f}\n")

    if len(pts) != 133:
        print(f"!! expected 133 keypoints, got {len(pts)} — the rest of this is meaningless")
        return 1

    # --- labelled crops ---------------------------------------------------------------
    print("crops:")
    crop(img, pts, list(range(FACE0, FACE0 + 68)),
         [str(i) for i in range(68)], out / "face.png", pad=14, scale=6)
    for side, base in (("left", LHAND0), ("right", RHAND0)):
        crop(img, pts, list(range(base, base + 21)),
             [str(i) for i in range(21)], out / f"hand_{side}.png", pad=10, scale=10)
    crop(img, pts, list(FEET), [FEET[i] for i in FEET], out / "feet.png", pad=24, scale=4)

    # --- geometric assertions ---------------------------------------------------------
    # Each holds only if the conventional sub-ordering is the real one. Deliberately
    # coarse: they must survive any address-position golfer in any view.
    print("\nface block (23-90):")
    contour = [FACE0 + i for i in FACE_PARTS["contour"]]
    chin_i = FACE0 + 8
    lowest = max(contour, key=lambda i: pts[i][1])
    check("face 8 is the lowest contour point (chin)", lowest == chin_i,
          f"lowest was face {lowest - FACE0}")
    bridge = [FACE0 + i for i in FACE_PARTS["bridge"]]
    check("nose bridge 27->30 descends", all(
        pts[bridge[k]][1] <= pts[bridge[k + 1]][1] + 2 for k in range(3)),
        " ".join(f"{pts[i][1]:.0f}" for i in bridge))
    eye_r = np.mean([pts[FACE0 + i] for i in FACE_PARTS["eye_r"]], axis=0)
    eye_l = np.mean([pts[FACE0 + i] for i in FACE_PARTS["eye_l"]], axis=0)
    mouth = np.mean([pts[FACE0 + i] for i in FACE_PARTS["mouth"]], axis=0)
    check("eyes sit above the mouth", max(eye_r[1], eye_l[1]) < mouth[1],
          f"eyes y={eye_r[1]:.0f}/{eye_l[1]:.0f} mouth y={mouth[1]:.0f}")
    brow_r = np.mean([pts[FACE0 + i] for i in FACE_PARTS["brow_r"]], axis=0)
    check("brows sit above the eyes", brow_r[1] < eye_r[1],
          f"brow y={brow_r[1]:.0f} eye y={eye_r[1]:.0f}")
    face_span = np.ptp([pts[i] for i in contour], axis=0)
    check("face block is face-sized, not body-sized",
          max(face_span) < 0.45 * max(w, h), f"span {face_span[0]:.0f}x{face_span[1]:.0f}px")

    print("\nhand blocks (91-111, 112-132):")
    for side, base, wrist_i in (("left", LHAND0, 9), ("right", RHAND0, 10)):
        d = float(np.linalg.norm(pts[base] - pts[wrist_i]))
        hand_span = float(max(np.ptp([pts[base + k] for k in range(21)], axis=0)))
        check(f"{side} hand[0] coincides with body wrist {wrist_i}",
              d < max(hand_span, 1.0) * 1.5, f"{d:.1f}px apart, hand span {hand_span:.1f}px")
        # Fingers run MCP->tip, so each tip is the farthest of its four from the hand wrist.
        for fname in ("thumb", "index", "middle", "ring", "pinky"):
            ids = [base + k for k in HAND_PARTS[fname]]
            dists = [float(np.linalg.norm(pts[i] - pts[base])) for i in ids]
            check(f"{side} {fname} runs base->tip",
                  dists[-1] == max(dists), " ".join(f"{v:.0f}" for v in dists))

    print("\nfoot block (17-22):")
    for side, big, small, heel in (("left", 17, 18, 19), ("right", 20, 21, 22)):
        ankle = 15 if side == "left" else 16
        d_heel = float(np.linalg.norm(pts[heel] - pts[ankle]))
        d_big = float(np.linalg.norm(pts[big] - pts[ankle]))
        check(f"{side} heel is nearer the ankle than the big toe", d_heel < d_big,
              f"heel {d_heel:.0f}px, toe {d_big:.0f}px")
        width = float(np.linalg.norm(pts[big] - pts[small]))
        length = float(np.linalg.norm(pts[big] - pts[heel]))
        check(f"{side} toe separation < foot length", width < length,
              f"width {width:.0f}px, length {length:.0f}px")

    print("\nconfidence of the points we intend to use:")
    named = {"chin": FACE0 + 8, "nose_bridge": FACE0 + 27,
             "jaw_l": FACE0 + 0, "jaw_r": FACE0 + 16,
             "L index MCP": LHAND0 + 5, "L middle MCP": LHAND0 + 9,
             "L pinky MCP": LHAND0 + 17, "L thumb MCP": LHAND0 + 2,
             "R index MCP": RHAND0 + 5, "R middle MCP": RHAND0 + 9,
             "R pinky MCP": RHAND0 + 17, "R thumb MCP": RHAND0 + 2,
             "L small toe": 18, "R small toe": 21}
    for k, i in named.items():
        print(f"  {k:<14} idx {i:>3}  conf {sc[i]:.3f}  at ({pts[i][0]:.0f}, {pts[i][1]:.0f})")

    print(f"\nlook at {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
