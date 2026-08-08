"""Did we find the ball? Draw it on the real frame, next to the club head at Address.

    python scripts/checkball.py out/<stem> [--live]

`--live` re-runs `club.find_ball` over the video instead of reading `club.ball` out of
`analysis.json`, so the detector can be iterated on without a 5-minute `burnin.py`.

Why this script exists at all: the ball is the anchor for the club head at Impact
(`club.anchor_ball`), and on a tour swing that is the *only* thing putting the drawn path on the
strike — nothing detects a club head moving 90px a frame through the turf. A wrong ball is
therefore a wrong club, confidently drawn. The club-tracking spec's rule about judging club work on pixels
rather than on numbers applies to it exactly as it does to the shaft.

The panel shows three things: the ball as found (green), the club head at Address (magenta), and
the "vanished at impact" difference image the search actually reads. If the green circle is not
on a golf ball, the number in `analysis.json` is wrong no matter how confident it looks.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from swingsage import club  # noqa: E402


def body_height(d, H):
    names = d["pose"]["keypoint_names"]
    hi, ai = names.index("head_center"), names.index("left_ankle")
    hc = sorted(f["kp"][hi][1] for f in d["pose"]["frames"] if f["kp"][hi][2] > 0.2)
    ak = sorted(f["kp"][ai][1] for f in d["pose"]["frames"] if f["kp"][ai][2] > 0.2)
    med = lambda v: v[len(v) // 2] if v else 0.0
    return max(med(ak) - med(hc), 0.05)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("out_dir")
    ap.add_argument("--live", action="store_true",
                    help="re-run the search over analysis.mp4 instead of reading analysis.json")
    args = ap.parse_args()

    out = Path(args.out_dir).resolve()
    d = json.loads((out / "analysis.json").read_text(encoding="utf-8"))
    ev, c = d["events"], d.get("club")
    if not c:
        print("no club block")
        return 1
    addr = ev["address"]["frame"]
    head = (c["frames"][addr] or {}).get("head")
    ball = c.get("ball")
    diff = None

    if args.live:
        cap = cv2.VideoCapture(str(out / "analysis.mp4"))
        grays = []
        while True:
            ok, img = cap.read()
            if not ok:
                break
            grays.append(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY))
        cap.release()
        h, w = grays[0].shape
        bh = body_height(d, h)
        found = club.find_ball(grays, {"events": ev, "address_span": d.get("address_span")},
                               head, bh, w, h, club.ClubConfig())
        ball = ({"x": found[0], "y": found[1], "r": found[2] / h, "source": "live"}
                if found else None)
        print(f"live search: {ball}")
        # The image the search reads, for when it picks the wrong thing.
        span = d.get("address_span") or [addr, addr]
        imp = ev["impact"]["frame"]
        pre = np.median(np.stack([grays[f] for f in range(span[0], min(span[1] + 1, span[0] + 30))]),
                        axis=0)
        post = np.median(np.stack([grays[f] for f in range(min(len(grays) - 1, imp + 8),
                                                           min(len(grays), imp + 28))]), axis=0)
        diff = np.clip(pre - post, 0, 255).astype(np.uint8)

    cap = cv2.VideoCapture(str(out / "normalized.mp4"))
    cap.set(cv2.CAP_PROP_POS_FRAMES, addr)
    ok, img = cap.read()
    cap.release()
    if not ok:
        print("cannot read the address frame")
        return 1
    H, W = img.shape[:2]
    bh_px = body_height(d, H) * H

    if head:
        cv2.circle(img, (int(head[0] * W), int(head[1] * H)), 20, (255, 0, 255), 3, cv2.LINE_AA)
    if ball:
        bx, by = int(ball["x"] * W), int(ball["y"] * H)
        cv2.circle(img, (bx, by), max(10, int(ball.get("r", 0.01) * H * 2.5)),
                   (0, 255, 0), 3, cv2.LINE_AA)
        cv2.line(img, (bx - 30, by), (bx - 12, by), (0, 255, 0), 2, cv2.LINE_AA)
        cv2.line(img, (bx + 12, by), (bx + 30, by), (0, 255, 0), 2, cv2.LINE_AA)
        if head:
            dpx = float(np.hypot((ball["x"] - head[0]) * W, (ball["y"] - head[1]) * H))
            print(f"ball {ball['x']:.4f},{ball['y']:.4f} ({ball.get('source')}) — "
                  f"{dpx:.0f}px from the Address club head = {100 * dpx / bh_px:.1f}% body height")
    else:
        print("no ball in this artifact; the impact anchor falls back to the Address club head")

    # Crop to the interesting part: the ball is small and the frame is not.
    cx = int((ball["x"] if ball else head[0] if head else 0.5) * W)
    cy = int((ball["y"] if ball else head[1] if head else 0.5) * H)
    R = int(0.30 * bh_px)
    crop = img[max(0, cy - R):min(H, cy + R), max(0, cx - R):min(W, cx + R)]
    tiles = [cv2.resize(crop, (int(crop.shape[1] * 700 / crop.shape[0]), 700))]
    if diff is not None:
        dh, dw = diff.shape
        s = H / dh
        dc = cv2.cvtColor(diff, cv2.COLOR_GRAY2BGR)
        dc = cv2.resize(dc, (int(dw * s), H))
        d2 = dc[max(0, cy - R):min(H, cy + R), max(0, cx - R):min(dc.shape[1], cx + R)]
        if d2.size:
            tiles.append(cv2.resize(d2, (int(d2.shape[1] * 700 / d2.shape[0]), 700)))
    p = out / f"ball_{out.name}.jpg"
    cv2.imwrite(str(p), np.hstack(tiles))
    print(f"wrote {p}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
