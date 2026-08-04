"""Gate 1 inspection: judge pose quality at full resolution, not from a thumbnail grid.

    python scripts/inspect.py <out_dir> --frames 100 291 377
    python scripts/inspect.py <out_dir> --motion

--motion prints a grip-height trace so the swing structure (how many swings, where the
takeaway/top/impact sit) is readable as text before any event detector exists.
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


def crop_to_person(img, kp, pad=0.18):
    """Tight crop around the detected skeleton so joints are actually inspectable."""
    h, w = img.shape[:2]
    pts = [(x, y) for x, y, c in kp if c > 0.2]
    if not pts:
        return img
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    x0, x1 = min(xs), max(xs)
    y0, y1 = min(ys), max(ys)
    dx, dy = (x1 - x0) * pad, (y1 - y0) * pad
    x0, x1 = max(0.0, x0 - dx), min(1.0, x1 + dx)
    y0, y1 = max(0.0, y0 - dy), min(1.0, y1 + dy)
    return img[int(y0 * h):int(y1 * h), int(x0 * w):int(x1 * w)]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("out_dir")
    ap.add_argument("--frames", type=int, nargs="*", default=[])
    ap.add_argument("--motion", action="store_true")
    ap.add_argument("--label", default="")
    args = ap.parse_args()

    out = Path(args.out_dir).resolve()
    doc = json.loads((out / "analysis.json").read_text(encoding="utf-8"))
    frames = doc["pose"]["frames"]
    video = out / "normalized.mp4"

    if args.motion:
        gi, lw, rw = IDX["grip_center"], IDX["left_wrist"], IDX["right_wrist"]
        ys, confs = [], []
        for fr in frames:
            kp = fr["kp"]
            # grip_center needs both wrists; fall back to whichever wrist is visible so the
            # trace stays continuous through the low-confidence left-arm spans.
            cands = [(kp[i][1], kp[i][2]) for i in (gi, lw, rw) if kp[i][2] > 0.2]
            if cands:
                y, c = max(cands, key=lambda t: t[1])
                ys.append(y); confs.append(c)
            else:
                ys.append(np.nan); confs.append(0.0)

        arr = np.array(ys, dtype=float)
        valid = ~np.isnan(arr)
        lo, hi = np.nanmin(arr), np.nanmax(arr)
        print(f"grip/wrist height trace  ({valid.sum()}/{len(arr)} frames tracked)")
        print(f"  y range {lo:.3f} (highest) .. {hi:.3f} (lowest)   [y grows downward]\n")
        width = 64
        for i in range(0, len(arr), 4):
            v = arr[i]
            if np.isnan(v):
                print(f"{i:>4} {'?':>6}  " + "." * 4 + " no track")
                continue
            pos = int((v - lo) / max(hi - lo, 1e-6) * (width - 1))
            bar = " " * pos + "#"
            print(f"{i:>4} {v:>6.3f}  {bar}   c={confs[i]:.2f}")
        return 0

    cap = cv2.VideoCapture(str(video))
    tiles = []
    for f in args.frames:
        cap.set(cv2.CAP_PROP_POS_FRAMES, f)
        ok, img = cap.read()
        if not ok:
            print(f"could not read frame {f}")
            continue
        kp = frames[f]["kp"]
        draw_skeleton(img, kp, joint_r=7, bone_w=4)
        crop = crop_to_person(img, kp)
        # Upscale so joint placement is judgeable by eye.
        scale = min(3.0, 900.0 / max(crop.shape[0], 1))
        if scale > 1:
            crop = cv2.resize(crop, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
        name = f"inspect_{args.label + '_' if args.label else ''}{f:04d}.jpg"
        cv2.imwrite(str(out / name), crop)
        lows = [n for n, i in IDX.items() if i < len(kp) and 0 < kp[i][2] < 0.5]
        print(f"frame {f}: wrote {name}  low-conf: {', '.join(lows) or 'none'}")
        tiles.append((f, crop))
    cap.release()

    if len(tiles) > 1:
        # One sheet is far easier to judge than N separate files.
        th = max(t.shape[0] for _, t in tiles)
        padded = []
        for f, t in tiles:
            canvas = np.zeros((th + 34, t.shape[1], 3), np.uint8)
            canvas[34:34 + t.shape[0], :t.shape[1]] = t
            cv2.putText(canvas, f"frame {f}", (8, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.7,
                        (255, 255, 255), 2, cv2.LINE_AA)
            padded.append(canvas)
        sheet = np.hstack(padded)
        name = f"sheet_{args.label or 'keyframes'}.jpg"
        cv2.imwrite(str(out / name), sheet)
        print(f"wrote {name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
