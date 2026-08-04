"""Visual accuracy check: skeleton + rigid club at the 8 events, for any analysed swing.

    python scripts/checkclub.py out/<stem> [--events address top impact finish]

Writes check_<stem>.jpg — one tile per event, cropped to the golfer and club, so club
placement can be judged against the real club in the frame rather than from coverage
numbers (which have twice now looked healthy while the overlay was wrong).
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from swingsage.render import draw_skeleton  # noqa: E402
from swingsage.skeleton import IDX  # noqa: E402

DEFAULT = ["address", "toe_up", "top", "mid_downswing", "impact", "finish"]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("out_dir")
    ap.add_argument("--events", nargs="*", default=DEFAULT)
    ap.add_argument("--height", type=int, default=620)
    args = ap.parse_args()

    out = Path(args.out_dir).resolve()
    d = json.loads((out / "analysis.json").read_text(encoding="utf-8"))
    ev, cj = d["events"], d.get("club")
    cap = cv2.VideoCapture(str(out / "normalized.mp4"))

    tiles = []
    for name in args.events:
        e = ev.get(name)
        if not e:
            continue
        f = e["frame"]
        cap.set(cv2.CAP_PROP_POS_FRAMES, f)
        ok, img = cap.read()
        if not ok:
            continue
        h, w = img.shape[:2]
        kp = d["pose"]["frames"][f]["kp"]
        draw_skeleton(img, kp, joint_r=6, bone_w=4)

        pts = [(p[0], p[1]) for p in kp if p[2] > 0.2]
        c = (cj["frames"][f] if cj else None)
        if c and c.get("shaft"):
            p0 = (int(c["shaft"][0][0] * w), int(c["shaft"][0][1] * h))
            p1 = (int(c["shaft"][1][0] * w), int(c["shaft"][1][1] * h))
            cv2.line(img, p0, p1, (245, 245, 245), 4, cv2.LINE_AA)
            cv2.circle(img, p1, 10, (110, 110, 250), 3, cv2.LINE_AA)   # head
            cv2.circle(img, p0, 6, (250, 220, 110), -1, cv2.LINE_AA)   # butt
            pts += [tuple(c["shaft"][0]), tuple(c["shaft"][1])]
        g = kp[IDX["grip_center"]]
        if g[2] > 0:
            cv2.circle(img, (int(g[0] * w), int(g[1] * h)), 8, (255, 255, 255), 2, cv2.LINE_AA)

        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        x0, x1 = max(0.0, min(xs) - .05), min(1.0, max(xs) + .05)
        y0, y1 = max(0.0, min(ys) - .04), min(1.0, max(ys) + .04)
        crop = img[int(y0 * h):int(y1 * h), int(x0 * w):int(x1 * w)]
        if crop.size == 0:
            continue
        s = args.height / crop.shape[0]
        crop = cv2.resize(crop, (int(crop.shape[1] * s), args.height))
        lbl = f"{name} f{f}" + (f" c{c['conf']:.2f}" if c and c.get("shaft") else "")
        cv2.rectangle(crop, (0, 0), (crop.shape[1], 22), (0, 0, 0), -1)
        cv2.putText(crop, lbl, (5, 16), cv2.FONT_HERSHEY_SIMPLEX, 0.45,
                    (255, 255, 255), 1, cv2.LINE_AA)
        tiles.append(crop)
    cap.release()

    if not tiles:
        print("nothing rendered")
        return 1
    sheet = np.hstack(tiles)
    p = out / f"check_{out.name}.jpg"
    cv2.imwrite(str(p), sheet)
    print(f"wrote {p}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
