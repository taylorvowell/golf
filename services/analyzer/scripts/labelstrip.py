"""Contact sheet with NORMALIZED FRAME IDS burned in, for event labeling.

Unlike checkstrip.py (which labels tiles with decoder seconds off the source
clip), this reads out/<stem>/normalized.mp4 - exact CFR, decode order IS the
public frame identity - and stamps each tile with its frame index, so a label
can be read straight off the sheet with no seconds->frame conversion.

Usage:
  python scripts/labelstrip.py <stem> <center_frame> [--span 30] [--step 3]
      [--tile 360] [--out out/<stem>/labelstrip_<center>.jpg]

Reads consecutively from frame max(0, center-span) to center+span (no
per-frame seeking; one coarse seek to the start, then sequential decode).
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("stem", help="out/<stem> (reads its normalized.mp4)")
    ap.add_argument("center_frame", type=int)
    ap.add_argument("--span", type=int, default=30, help="frames either side")
    ap.add_argument("--step", type=int, default=3, help="keep 1 tile in N")
    ap.add_argument("--tile", type=int, default=360, help="tile width px")
    ap.add_argument("--cols", type=int, default=6)
    ap.add_argument("--out", default=None)
    args = ap.parse_args(argv)

    video = ROOT / "out" / args.stem / "normalized.mp4"
    if not video.exists():
        print(f"no {video}", file=sys.stderr)
        return 1
    cap = cv2.VideoCapture(str(video))
    if not cap.isOpened():
        print(f"cannot open {video}", file=sys.stderr)
        return 1

    start = max(0, args.center_frame - args.span)
    end = args.center_frame + args.span
    # normalized.mp4 is CFR with dense keyframe-friendly encoding; a frame seek
    # then sequential reads keeps decode order = frame id.
    cap.set(cv2.CAP_PROP_POS_FRAMES, start)
    got = int(cap.get(cv2.CAP_PROP_POS_FRAMES))
    if got != start:  # decoder snapped; fall back to reading from 0
        cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
        for _ in range(start):
            cap.grab()

    tiles = []
    header = 44
    for f in range(start, end + 1):
        ok, frame = cap.read()
        if not ok:
            break
        if (f - start) % args.step:
            continue
        h, w = frame.shape[:2]
        tile_h = int(h * args.tile / w)
        tile = cv2.resize(frame, (args.tile, tile_h))
        bar = np.zeros((header, args.tile, 3), np.uint8)
        mark = f == args.center_frame
        if mark:
            bar[:] = (0, 90, 200)
        cv2.putText(bar, f"f {f}", (8, 32), cv2.FONT_HERSHEY_SIMPLEX, 1.0,
                    (255, 255, 255), 2, cv2.LINE_AA)
        tiles.append(np.vstack([bar, tile]))
    cap.release()
    if not tiles:
        print("no frames read", file=sys.stderr)
        return 1

    cols = args.cols
    rows = []
    for i in range(0, len(tiles), cols):
        row = tiles[i:i + cols]
        while len(row) < cols:
            row.append(np.zeros_like(tiles[0]))
        rows.append(np.hstack(row))
    sheet = np.vstack(rows)
    out = Path(args.out) if args.out else (
        ROOT / "out" / args.stem / f"labelstrip_{args.center_frame}.jpg")
    out.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(out), sheet, [cv2.IMWRITE_JPEG_QUALITY, 88])
    print(f"{out}  ({len(tiles)} tiles, frames {start}-{min(end, f)}, step {args.step})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
