"""Draw the club detector's RAW output and nothing else.

    python scripts/rawdet.py out/<stem>              # a strip at the 8 events
    python scripts/rawdet.py out/<stem> --frames 41 59 86 102 115 148
    python scripts/rawdet.py out/<stem> --all         # every frame -> rawdet.mp4

Reads `club.detector.boxes` from analysis.json — every box the model returned, unfiltered.
Deliberately draws NOTHING else: no skeleton, no solved shaft, no trace, no smoothing, no
confidence gate, no geometric rejection, no grip_center, no club_px. The point is to judge the
model on its own, because everything else in the club block is the pipeline's opinion layered
on top and any of it can be what is actually wrong.

Green = `stick`, red = `clubhead`, label is the model's own confidence.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

COL = {0: (90, 90, 240), 1: (110, 230, 110)}      # BGR: clubhead red-ish, stick green
NAME = {0: "clubhead", 1: "stick"}


def draw(img, boxes, w, h, show_conf=True):
    for b in boxes:
        cx, cy = b["xy"][0] * w, b["xy"][1] * h
        bw, bh = b["wh"][0] * w, b["wh"][1] * h
        c = int(b["c"])
        col = COL.get(c, (200, 200, 200))
        x0, y0 = int(round(cx - bw / 2)), int(round(cy - bh / 2))
        x1, y1 = int(round(cx + bw / 2)), int(round(cy + bh / 2))
        cv2.rectangle(img, (x0, y0), (x1, y1), col, 2)
        # A cross at the centre — for `clubhead` this exact point is what inject() would use,
        # so it is the thing worth looking at rather than the box.
        cv2.drawMarker(img, (int(round(cx)), int(round(cy))), col,
                       cv2.MARKER_CROSS, 14, 2)
        if show_conf:
            cv2.putText(img, f"{NAME.get(c, c)} {b['p']:.2f}", (x0, max(12, y0 - 5)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.42, col, 1, cv2.LINE_AA)
    return img


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--frames", type=int, nargs="*", default=None)
    ap.add_argument("--all", action="store_true", help="write rawdet.mp4 over every frame")
    ap.add_argument("--video", default="normalized.mp4")
    args = ap.parse_args()

    out = Path(args.out).resolve()
    doc = json.loads((out / "analysis.json").read_text(encoding="utf-8"))
    det = (doc.get("club") or {}).get("detector")
    if not det or not det.get("boxes"):
        print("no club.detector.boxes in analysis.json — re-run burnin.py with "
              "--club-detector <weights>")
        return 1

    by_frame = {b["f"]: b["d"] for b in det["boxes"]}
    n_head = sum(1 for d in by_frame.values() for x in d if x["c"] == 0)
    n_stick = sum(1 for d in by_frame.values() for x in d if x["c"] == 1)
    print(f"{det.get('weights')}@{det.get('sha256')}  inject={det.get('inject')}  "
          f"conf>={det.get('conf')}")
    print(f"raw boxes: {n_head} clubhead, {n_stick} stick, over "
          f"{len(by_frame)}/{det.get('frames')} frames")

    cap = cv2.VideoCapture(str(out / args.video))
    if not cap.isOpened():
        print(f"cannot open {out / args.video}")
        return 1
    frames = []
    while True:
        ok, img = cap.read()
        if not ok:
            break
        frames.append(img)
    cap.release()
    h, w = frames[0].shape[:2]

    if args.all:
        dst = out / "rawdet.mp4"
        vw = cv2.VideoWriter(str(dst), cv2.VideoWriter_fourcc(*"mp4v"),
                             doc["video"]["fps"], (w, h))
        for i, img in enumerate(frames):
            vw.write(draw(img.copy(), by_frame.get(i, []), w, h))
        vw.release()
        print(f"wrote {dst}")
        return 0

    if args.frames:
        want = [(f"f{f}", f) for f in args.frames]
    else:
        want = [(k, v["frame"]) for k, v in doc["events"].items()]
    want = [(lab, f) for lab, f in want if 0 <= f < len(frames)]

    tiles = []
    for lab, f in want:
        img = draw(frames[f].copy(), by_frame.get(f, []), w, h)
        n = len(by_frame.get(f, []))
        bar = np.zeros((26, w, 3), np.uint8)
        cv2.putText(bar, f"{lab} f{f}  {n} box{'' if n == 1 else 'es'}", (6, 18),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (235, 235, 235), 1, cv2.LINE_AA)
        tiles.append(np.vstack([bar, img]))

    # Downscale so a 6-8 tile strip stays readable at a normal screen width.
    scale = min(1.0, 1900 / (len(tiles) * w))
    if scale < 1.0:
        tiles = [cv2.resize(t, (int(t.shape[1] * scale), int(t.shape[0] * scale)),
                            interpolation=cv2.INTER_AREA) for t in tiles]
    sheet = np.hstack(tiles)
    dst = out / f"rawdet_{out.name}.jpg"
    cv2.imwrite(str(dst), sheet, [int(cv2.IMWRITE_JPEG_QUALITY), 92])
    print(f"wrote {dst}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
