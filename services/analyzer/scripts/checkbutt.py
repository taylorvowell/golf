"""The stored silhouette and the butt line, drawn over the real frame.

Same job as `checkclub.py` does for the club: put the artifact back on the pixels it was
measured from, because coverage percentages have overstated quality here before. Two questions
it answers that a number cannot:

  * does the outline actually follow the golfer, at speed and at rest
  * is the red line tangent to the seat, or is it tangent to a shirt hanging off it

Reads `silhouette.json` + `analysis.json` only — it never re-runs segmentation, so what you
see is exactly what the player will draw. (`scripts/resegment.py --dry-run` is the one that
re-measures.)

Usage:
    .venv/Scripts/python.exe scripts/checkbutt.py out/perfect
    .venv/Scripts/python.exe scripts/checkbutt.py out/perfect --frames 219 415 533
    .venv/Scripts/python.exe scripts/checkbutt.py out/perfect --all       # every out/*/
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

EDGE = (220, 255, 0)      # BGR — the outline
LINE = (60, 60, 255)      # the butt line, red
BAND = (150, 150, 255)    # the rows it was measured over


def draw(img, polys, butt, label, show_band=True):
    H, W = img.shape[:2]
    vis = (img * 0.30).astype(np.uint8)
    if polys:
        rings = [np.array([[int(x * W), int(y * H)] for x, y in p], np.int32) for p in polys]
        # Even-odd, so the holes (the gap between the arms at the top) stay holes — the same
        # rule the canvas fills with. cv2.fillPoly is even-odd for overlapping contours.
        keep = np.zeros((H, W), np.uint8)
        cv2.fillPoly(keep, rings, 255)
        sel = np.repeat((keep > 0)[:, :, None].astype(np.float32), 3, axis=2)
        vis = (img * sel + vis * (1 - sel)).astype(np.uint8)
        cv2.polylines(vis, rings, True, EDGE, 2)
    else:
        cv2.putText(vis, "no silhouette on this frame", (20, 130),
                    cv2.FONT_HERSHEY_SIMPLEX, 1.1, LINE, 3)
    if butt:
        x = int(butt["x"] * W)
        cv2.line(vis, (x, int(butt["y0"] * H)), (x, int(butt["y1"] * H)), LINE, 6)
        if show_band:
            for y in butt["band"]:
                cv2.line(vis, (0, int(y * H)), (W, int(y * H)), BAND, 1)
    cv2.putText(vis, label, (18, 56), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (255, 255, 255), 3)
    return vis


def check(out_dir: Path, frames: list[int] | None) -> None:
    doc = json.loads((out_dir / "analysis.json").read_text(encoding="utf-8"))
    sil_path = out_dir / "silhouette.json"
    if not sil_path.exists():
        print(f"{out_dir.name}: no silhouette.json — run scripts/resegment.py")
        return
    sil = json.loads(sil_path.read_text(encoding="utf-8"))
    by_frame = {r["f"]: r["p"] for r in sil["frames"]}
    butt = (doc.get("posture") or {}).get("butt_line")

    ev = doc.get("events") or {}
    if frames:
        picks = [(f, f"f{f}") for f in frames]
    else:
        # The events, because they are the frames anyone will actually scrub to, plus the
        # address frame the line is locked at even when it is one of them.
        picks = [(v["frame"], k) for k, v in ev.items()]
    n_pts = sum(len(p) for r in sil["frames"] for p in r["p"])
    print(f"{out_dir.name}: {sil['coverage'] * 100:.0f}% coverage, "
          f"{n_pts / max(1, len(sil['frames'])):.0f} points/frame, eps={sil['eps']}"
          + (f"  ·  butt x={butt['x']:.4f} side={butt['side']:+d} conf={butt['conf']} "
             f"locked at f{butt['frame']}" if butt else "  ·  no butt line"))
    for n in sil.get("notes", []) + (doc.get("posture") or {}).get("notes", []):
        print(f"  ! {n}")

    cap = cv2.VideoCapture(str(out_dir / "analysis.mp4"))
    panels = []
    for f, label in picks:
        cap.set(cv2.CAP_PROP_POS_FRAMES, f)
        ok, img = cap.read()
        if not ok:
            continue
        # The band is only meaningful on the address frame; elsewhere it is two lines across
        # a pose it was never measured on, which reads as a claim about that frame.
        panels.append(draw(img, by_frame.get(f), butt, f"{label} f{f}",
                           show_band=bool(butt) and f == butt["frame"]))
    cap.release()
    if not panels:
        print("  no frames could be read")
        return

    h = 620
    sheet = np.hstack([cv2.resize(p, (int(p.shape[1] * h / p.shape[0]), h)) for p in panels])
    dst = out_dir / f"butt_{out_dir.name}.jpg"
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
