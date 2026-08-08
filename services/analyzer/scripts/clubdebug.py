"""The club-tracking spec CV debug view — motion mask, Hough candidates, chosen shaft, per frame.

Tuning club tracking blind is not viable; the club-tracking spec calls this non-negotiable for week 1 of
Phase 4. Each tile shows one frame as four panels:

    grey source | motion mask (after body suppression + annulus) | all Hough candidates |
    the winning shaft + head

    python scripts/clubdebug.py out/<stem> --frames 60 90 110 130
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
from swingsage.skeleton import IDX  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("out_dir")
    ap.add_argument("--frames", type=int, nargs="*", default=[])
    ap.add_argument("--width", type=int, default=300)
    args = ap.parse_args()

    out = Path(args.out_dir).resolve()
    doc = json.loads((out / "analysis.json").read_text(encoding="utf-8"))
    pose_frames = doc["pose"]["frames"]
    cfg = club.ClubConfig()

    cap = cv2.VideoCapture(str(out / "analysis.mp4"))
    grays = []
    while True:
        ok, img = cap.read()
        if not ok:
            break
        grays.append(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY))
    cap.release()
    h, w = grays[0].shape

    hc = [p for p in (club._kp(pose_frames, i, "head_center") for i in range(len(grays))) if p]
    ak = [p for p in (club._kp(pose_frames, i, "left_ankle") for i in range(len(grays))) if p]
    body_h = max(0.05, float(np.median([a[1] for a in ak]) - np.median([c[1] for c in hc])))

    cj = doc.get("club") or {}
    club_px = (cj.get("club_len") or body_h * 0.95) * h

    picks = args.frames or list(np.linspace(
        doc["events"]["address"]["frame"] + 5,
        doc["events"]["finish"]["frame"] - 2, 6).astype(int))

    rows = []
    for f in picks:
        if not (1 <= f < len(grays) - 1):
            continue
        motion = club._motion(grays[f - 1], grays[f], grays[f + 1], cfg)
        body = club._body_mask((h, w), pose_frames, f, body_h, cfg)
        motion = cv2.bitwise_and(motion, cv2.bitwise_not(body))
        grip = club._kp(pose_frames, f, "grip_center")
        panels = []
        base = cv2.cvtColor(grays[f], cv2.COLOR_GRAY2BGR)

        if grip:
            gp = np.array([grip[0] * w, grip[1] * h])
            ring = np.zeros_like(motion)
            cv2.circle(ring, tuple(gp.astype(int)), int(club_px * cfg.search_scale), 255, -1)
            motion = cv2.bitwise_and(motion, ring)
            cv2.circle(base, tuple(gp.astype(int)), 6, (0, 200, 255), 2)

        panels.append(base)
        panels.append(cv2.cvtColor(motion, cv2.COLOR_GRAY2BGR))

        cand = cv2.cvtColor(grays[f], cv2.COLOR_GRAY2BGR)
        segs = club._segments(cv2.HoughLinesP(
            motion, 1, np.pi / 180, cfg.hough_thresh,
            minLineLength=int(club_px * cfg.min_len), maxLineGap=14))
        for x1, y1, x2, y2 in segs:
            cv2.line(cand, (x1, y1), (x2, y2), (200, 120, 60), 1, cv2.LINE_AA)
        cv2.putText(cand, f"{len(segs)} cand", (6, 20), cv2.FONT_HERSHEY_SIMPLEX, 0.5,
                    (255, 255, 255), 1, cv2.LINE_AA)
        panels.append(cand)

        chosen = cv2.cvtColor(grays[f], cv2.COLOR_GRAY2BGR)
        cf = (cj.get("frames") or [None] * len(grays))[f] if cj else None
        if cf and cf.get("shaft"):
            p0 = (int(cf["shaft"][0][0] * w), int(cf["shaft"][0][1] * h))
            p1 = (int(cf["shaft"][1][0] * w), int(cf["shaft"][1][1] * h))
            cv2.line(chosen, p0, p1, (60, 230, 60), 2, cv2.LINE_AA)
        if cf and cf.get("head"):
            hp = (int(cf["head"][0] * w), int(cf["head"][1] * h))
            cv2.circle(chosen, hp, 7, (60, 120, 250), 2, cv2.LINE_AA)
        lbl = f"f{f} conf {cf['conf']:.2f}" if cf else f"f{f}"
        cv2.putText(chosen, lbl, (6, 20), cv2.FONT_HERSHEY_SIMPLEX, 0.5,
                    (255, 255, 255), 1, cv2.LINE_AA)
        panels.append(chosen)

        scale = args.width / w
        rows.append(np.hstack([cv2.resize(p, (args.width, int(h * scale))) for p in panels]))

    if not rows:
        print("no frames rendered")
        return 1
    sheet = np.vstack(rows)
    path = out / "club_debug.jpg"
    cv2.imwrite(str(path), sheet)
    print(f"wrote {path}  (frames {list(picks)})")
    print("panels: source+grip | motion mask | hough candidates | chosen shaft/head")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
