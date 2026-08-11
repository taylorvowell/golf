"""The shoulder and hip orientation rods, drawn over the real frame.

The player's "Shoulder + hip lines" overlay is two red bars with a ball on each end, skewered
through the shoulder pair and the hip pair and run well past the body so rotation reads at a
glance. This is the Gate 1 view of it: the same geometry, computed from `analysis.json` in the
same process that draws it, so sync cannot be a variable and anything wrong here is the
keypoints or the rule.

The question it exists to answer is **what happens as a pair turns side-on to the camera**. Down
the line the hips align with the lens through impact — on swing1 they span 9px against an 882px
body — and at that separation the two keypoints sit inside each other's noise, so the direction
is whichever way the jitter fell. Pooled over all ten fixtures, the frame-to-frame change in a
pair's angle is:

    span/body    n     median   p90     max
    <1%          63     13.3    62.9    89.9      <- direction is noise
    1-2%        506      0.8     6.1    73.1
    2-3%        765      0.5     2.5    59.6
    4-6%       1766      0.1     1.3    32.8
    >10%       7265      0.1     0.3     5.6

The renderer does not fight that with a minimum length — it leans into it. The bar is extended by
a MULTIPLE of the projected span, so it foreshortens like a rigid rod aimed at the lens and the
noisy frames are the ones drawn shortest, which contains the error instead of amplifying it. The
end balls are what stays visible when the bar collapses. Below WEAK_SPAN it also draws dimmed.

Run this on a run of consecutive frames through impact (`--frames 213 215 217 219 221 223 225`),
not just the events — the behaviour worth checking is the collapse and re-lengthening, and an
event sheet samples straight past it.

Mirrors apps/web/src/components/SwingStage.tsx's `t.orient` block. If you change one, change
both.

Usage:
    .venv/Scripts/python.exe scripts/checkorient.py out/swing1
    .venv/Scripts/python.exe scripts/checkorient.py out/swing1 --frames 217 219 221 223
    .venv/Scripts/python.exe scripts/checkorient.py --all
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

# --- kept in step with SwingStage.tsx -------------------------------------------------
MIN_CONF = 0.35        # metrics.MIN_CONF — below it the analyzer treated the point as missing
EXTEND = 0.5           # past each joint, as a multiple of the pair's PROJECTED span
CAP = 0.011            # end-ball radius, as a share of body height
WEAK_SPAN = 0.06       # of body height — below this, draw dimmed
WEAK_CONF = 0.4        # ...and below this confidence. NOT 0.5: these fixtures' confidences sit
#                        around 0.55, so 0.5 dims 24% of frames and strobes about once a second
PAIRS = [("left_shoulder", "right_shoulder"), ("left_hip", "right_hip")]

RED = (68, 68, 239)        # BGR — #EF4444, the same red the canvas uses
RED_DIM = (120, 120, 200)
DARK = (0, 0, 0)


def rod(kp, ix, pair, vw, vh, body):
    """The rod's two endpoints, or a reason it was not drawn.

    `vw`/`vh` are the size of the IMAGE being drawn on, never `video.width/height` from the
    artifact: `analysis.mp4` is a 720-wide downscale of the same frames, so scaling normalized
    coordinates by the JSON's 1080 puts every rod half the frame low. Same rule as the canvas,
    which scales by its own client rect.
    """
    a, b = kp[ix[pair[0]]], kp[ix[pair[1]]]
    if a[2] < MIN_CONF or b[2] < MIN_CONF:
        return None, f"conf {min(a[2], b[2]):.2f} < {MIN_CONF}", 0.0
    ax, ay, bx, by = a[0] * vw, a[1] * vh, b[0] * vw, b[1] * vh
    span = math.hypot(bx - ax, by - ay)
    pct = span / body * 100
    ux = (bx - ax) / span if span > 1e-6 else 0.0
    uy = (by - ay) / span if span > 1e-6 else 0.0
    ext = span * EXTEND
    weak = min(a[2], b[2]) < WEAK_CONF or span < body * WEAK_SPAN
    return ((round(ax - ux * ext), round(ay - uy * ext)),
            (round(bx + ux * ext), round(by + uy * ext))), ("dimmed" if weak else "drawn"), pct


def check(out_dir: Path, frames: list[int] | None) -> None:
    doc = json.loads((out_dir / "analysis.json").read_text(encoding="utf-8"))
    ix = {n: i for i, n in enumerate(doc["pose"]["keypoint_names"])}
    bh_norm = doc["metrics"].get("body_height_norm") or 0.4
    ev = doc.get("events") or {}
    picks = [(f, "") for f in frames] if frames else [(v["frame"], k) for k, v in ev.items()]

    cap = cv2.VideoCapture(str(out_dir / "analysis.mp4"))
    panels = []
    body = 0.0
    for f, label in picks:
        cap.set(cv2.CAP_PROP_POS_FRAMES, f)
        ok, img = cap.read()
        if not ok:
            continue
        vh, vw = img.shape[:2]
        if not body:
            body = bh_norm * vh
            print(f"{out_dir.name}: {vw}x{vh}  body={body:.0f}px  "
                  f"dim<{body * WEAK_SPAN:.0f}px  ball r={body * CAP:.0f}px")
        kp = doc["pose"]["frames"][f]["kp"]
        tag = f"{label} f{f}".strip()
        for pair in PAIRS:
            ends, state, pct = rod(kp, ix, pair, vw, vh, body)
            print(f"  {tag:22s} {pair[0].split('_')[1]:8s} span={pct:5.1f}% of body  {state}")
            if ends is None:
                continue
            lw = max(3, round(vw / 300))
            ball = max(lw, round(body * CAP))
            col = RED_DIM if state == "dimmed" else RED
            for c, width, grow in ((DARK, lw + 3, 2), (col, lw, 0)):
                cv2.line(img, ends[0], ends[1], c, width, cv2.LINE_AA)
                for end in ends:
                    cv2.circle(img, end, ball + grow, c, -1, cv2.LINE_AA)
        cv2.putText(img, tag, (18, 56), cv2.FONT_HERSHEY_SIMPLEX, 1.2,
                    (255, 255, 255), 3, cv2.LINE_AA)
        panels.append(img)
    cap.release()
    if not panels:
        print("  no frames could be read")
        return

    h = 620
    sheet = np.hstack([cv2.resize(p, (int(p.shape[1] * h / p.shape[0]), h)) for p in panels])
    dst = out_dir / f"orient_{out_dir.name}.jpg"
    cv2.imwrite(str(dst), sheet, [cv2.IMWRITE_JPEG_QUALITY, 88])
    print(f"  -> {dst}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("dirs", nargs="*", type=Path)
    ap.add_argument("--frames", nargs="*", type=int, default=None,
                    help="frame indices to draw; default is the eight events")
    ap.add_argument("--all", action="store_true", help="every out/*/ with an analysis.json")
    args = ap.parse_args()

    dirs = list(args.dirs)
    if args.all or not dirs:
        dirs = sorted(p for p in (ROOT / "out").glob("*") if (p / "analysis.json").exists())
    for d in dirs:
        check(d, args.frames)


if __name__ == "__main__":
    main()
