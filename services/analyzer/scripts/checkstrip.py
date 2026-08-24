"""
A frame-accurate filmstrip around a moment, for reading an event off the picture by eye.

The tool that built `audio_truth.json`. Point it at a clip and a time and it prints the frames
either side with their real presentation timestamps, which is how "the ball is still on the mat
here and gone here" becomes a labelled number instead of an impression.

    python scripts/checkstrip.py <video> <centre_sec> [span_sec] [keep_1_in_N] [out.jpg]

Seeks ONCE and then reads consecutively, labelling each tile with the decoder's own reported
presentation time. A per-tile `POS_MSEC` seek on H.265 lands on the nearest keyframe and its
label is then a lie — which, in a tool whose whole job is to produce trustworthy labels, is the
one mistake that would poison everything downstream of it. It was made here first and caught by
the timestamps disagreeing with the motion.
"""
import sys
from pathlib import Path

import cv2
import numpy as np

video = Path(sys.argv[1])
centre = float(sys.argv[2])
span = float(sys.argv[3]) if len(sys.argv) > 3 else 0.5
every = int(sys.argv[4]) if len(sys.argv) > 4 else 3          # keep 1 frame in N
out = Path(sys.argv[5]) if len(sys.argv) > 5 else Path("out/audio/strip.jpg")

cap = cv2.VideoCapture(str(video))
cap.set(cv2.CAP_PROP_POS_MSEC, max(0.0, centre - span) * 1000.0)

tiles = []
kept = 0
while True:
    t = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000.0
    ok, frame = cap.read()
    if not ok or t > centre + span:
        break
    if kept % every == 0:
        h, w = frame.shape[:2]
        img = cv2.resize(frame, (300, max(1, int(h * 300 / w))))
        pad = np.full((img.shape[0] + 40, 300, 3), 18, dtype=np.uint8)
        pad[40:, :] = img
        cv2.putText(pad, f"{t:.3f}", (8, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
        tiles.append(pad)
    kept += 1
cap.release()

per_row = 6
rows = [np.hstack(tiles[i:i + per_row]) for i in range(0, len(tiles), per_row)]
width = max(r.shape[1] for r in rows)
rows = [np.pad(r, ((0, 0), (0, width - r.shape[1]), (0, 0)), constant_values=18) for r in rows]
out.parent.mkdir(parents=True, exist_ok=True)
cv2.imwrite(str(out), np.vstack(rows))
print(f"{out}  ({len(tiles)} tiles)")
