"""Gate 1 — burn the skeleton into the pixels (doc 03 §6 render spec).

The point of this renderer is diagnostic, not cosmetic. Frame N's skeleton is drawn onto
frame N's pixels by the same process that computed it, so frame-sync is definitionally not
a variable. Anything that looks wrong in the output IS the pose — which is what makes this
a clean gate before any browser code exists. It also becomes the reference render that the
eventual canvas overlay must match.

Deliberately renders onto the 1080 normalized video using normalized 0-1 coordinates
produced from the 720 analysis video, so the coordinate-scaling path gets exercised too.
"""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import cv2
import numpy as np

from .skeleton import BONES, IDX, RENDER_JOINTS, SIDE_LEFT, SIDE_MID, SIDE_RIGHT

FFMPEG = shutil.which("ffmpeg") or "ffmpeg"

# BGR. High-contrast green/yellow per doc 01 UX notes; spine in a third hue (doc 03 §6).
COLOR = {
    SIDE_LEFT:  (94, 197, 34),    # #22C55E green
    SIDE_RIGHT: (21, 204, 250),   # #FACC15 yellow
    SIDE_MID:   (238, 211, 34),   # #22D3EE cyan
}
LOW_CONF = 0.5


def _pt(kp, name, w, h):
    """Normalized keypoint -> pixel tuple, or None if missing."""
    x, y, c = kp[IDX[name]]
    if c <= 0.0:
        return None
    return (int(round(x * w)), int(round(y * h))), c


def _dashed(img, p1, p2, color, thickness, dash=9, gap=6):
    p1, p2 = np.array(p1, float), np.array(p2, float)
    dist = float(np.linalg.norm(p2 - p1))
    if dist < 1:
        return
    step = dash + gap
    for s in np.arange(0, dist, step):
        a = p1 + (p2 - p1) * (s / dist)
        b = p1 + (p2 - p1) * (min(s + dash, dist) / dist)
        cv2.line(img, tuple(a.astype(int)), tuple(b.astype(int)), color, thickness, cv2.LINE_AA)


def draw_skeleton(img, kp, joint_r=5, bone_w=3):
    """Draw one frame's skeleton. Low confidence => hollow joint + dashed bone (doc 03 §6)."""
    h, w = img.shape[:2]

    for a, b, side in BONES:
        pa, pb = _pt(kp, a, w, h), _pt(kp, b, w, h)
        if not pa or not pb:
            continue
        (p1, ca), (p2, cb) = pa, pb
        color = COLOR[side]
        if min(ca, cb) < LOW_CONF:
            _dashed(img, p1, p2, color, bone_w)
        else:
            cv2.line(img, p1, p2, color, bone_w, cv2.LINE_AA)

    for name in RENDER_JOINTS:
        got = _pt(kp, name, w, h)
        if not got:
            continue
        (p, c) = got
        side = SIDE_LEFT if name.startswith("left_") else (
            SIDE_RIGHT if name.startswith("right_") else SIDE_MID)
        if c < LOW_CONF:
            cv2.circle(img, p, joint_r, COLOR[side], 2, cv2.LINE_AA)          # hollow
        else:
            cv2.circle(img, p, joint_r, COLOR[side], -1, cv2.LINE_AA)         # filled
            cv2.circle(img, p, joint_r, (20, 20, 20), 1, cv2.LINE_AA)         # readability ring
    return img


def _hud(img, frame_idx, total, kp, detected):
    h, w = img.shape[:2]
    scale = max(0.5, w / 1400.0)
    pad = int(12 * scale)
    conf = [c for _, _, c in kp if c > 0]
    mean_c = float(np.mean(conf)) if conf else 0.0
    lines = [
        f"frame {frame_idx:>4}/{total}",
        f"mean conf {mean_c:.2f}" if detected else "NO DETECTION",
    ]
    box_h = int((22 * scale) * len(lines) + pad)
    overlay = img.copy()
    cv2.rectangle(overlay, (0, 0), (int(300 * scale), box_h), (0, 0, 0), -1)
    cv2.addWeighted(overlay, 0.45, img, 0.55, 0, img)
    for i, text in enumerate(lines):
        color = (255, 255, 255) if detected else (60, 60, 255)
        cv2.putText(img, text, (pad, int(pad + 18 * scale + i * 22 * scale)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6 * scale, color, max(1, int(1.6 * scale)),
                    cv2.LINE_AA)
    return img


def burn_in(video_path, frames, out_path, detected=None, fps=60.0, hud=True):
    """Render skeletons onto `video_path` and encode to `out_path` via an ffmpeg pipe.

    frames: list of {"f": idx, "kp": [[x, y, conf], ...]} with normalized coords.
    """
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"could not open {video_path}")
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total = len(frames)

    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    proc = subprocess.Popen(
        [FFMPEG, "-y", "-loglevel", "error",
         "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{w}x{h}", "-r", str(fps), "-i", "-",
         "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
         "-movflags", "+faststart", str(out_path)],
        stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
    )
    try:
        i = 0
        while i < total:
            ok, img = cap.read()
            if not ok:
                break
            kp = frames[i]["kp"]
            draw_skeleton(img, kp)
            if hud:
                _hud(img, i, total - 1, kp, True if detected is None else detected[i])
            proc.stdin.write(img.tobytes())
            i += 1
    finally:
        cap.release()
        if proc.stdin:
            proc.stdin.close()
        err = proc.stderr.read().decode(errors="replace") if proc.stderr else ""
        rc = proc.wait()
        if rc != 0:
            raise RuntimeError(f"ffmpeg encode failed ({rc}): {err[:500]}")
    return out_path


def contact_sheet(video_path, frames, out_path, cols=6, rows=4, thumb_w=320):
    """Evenly-sampled grid of burned-in frames — scan a whole swing in one glance."""
    cap = cv2.VideoCapture(str(video_path))
    total = len(frames)
    picks = np.linspace(0, total - 1, cols * rows).astype(int) if total else []

    tiles, thumb_h = [], None
    for idx in picks:
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(idx))
        ok, img = cap.read()
        if not ok:
            continue
        draw_skeleton(img, frames[int(idx)]["kp"])
        h, w = img.shape[:2]
        thumb_h = int(thumb_w * h / w)
        t = cv2.resize(img, (thumb_w, thumb_h), interpolation=cv2.INTER_AREA)
        cv2.putText(t, f"{int(idx)}", (8, 26), cv2.FONT_HERSHEY_SIMPLEX, 0.7,
                    (255, 255, 255), 2, cv2.LINE_AA)
        tiles.append(t)
    cap.release()

    if not tiles:
        raise RuntimeError("no frames read for contact sheet")

    sheet = np.zeros((thumb_h * rows, thumb_w * cols, 3), np.uint8)
    for n, t in enumerate(tiles):
        r, c = divmod(n, cols)
        if r >= rows:
            break
        sheet[r * thumb_h:(r + 1) * thumb_h, c * thumb_w:(c + 1) * thumb_w] = t

    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(out_path), sheet)
    return out_path
