"""Adds the golfer+club isolation sidecar to an already-analysed swing.

Writes TWO sidecars beside `analysis.json` in one pass: `isolation.json` (body UNION
attached motion — "Isolate golfer + club") and `club_only.json` (the SUBTRACTIVE view —
attached motion MINUS the body, i.e. just the club). Both share silhouette.json's frame
shape so the player renders them through the same even-odd fill — see
swingsage/isolation.py.

Needs `silhouette.json` (run scripts/resegment.py first if missing) and `analysis.mp4`.
Touches nothing else — same non-destructive contract as resegment/rescore/retiming.

Usage:
    .venv/Scripts/python.exe scripts/isolate.py               # every out/<stem>/
    .venv/Scripts/python.exe scripts/isolate.py out/swing1
    .venv/Scripts/python.exe scripts/isolate.py --dry-run
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

import cv2

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from swingsage import isolation  # noqa: E402


def isolate_one(out_dir: Path, dry_run: bool = False) -> bool:
    analysis_p = out_dir / "analysis.json"
    sil_p = out_dir / "silhouette.json"
    video_p = out_dir / "analysis.mp4"
    if not analysis_p.exists() or not video_p.exists():
        print(f"  {out_dir.name}: needs analysis.json + analysis.mp4 — skipped")
        return False
    if not sil_p.exists():
        print(f"  {out_dir.name}: no silhouette.json — run scripts/resegment.py first")
        return False

    doc = json.loads(analysis_p.read_text(encoding="utf-8"))
    sil = json.loads(sil_p.read_text(encoding="utf-8"))
    sil_by_frame = {fr["f"]: fr["p"] for fr in sil.get("frames", [])}

    names = doc["pose"]["keypoint_names"]
    gi = names.index("grip_center")
    grip_by_frame = {}
    for fr in doc["pose"]["frames"]:
        x, y, c = fr["kp"][gi]
        if c > 0:
            grip_by_frame[fr["f"]] = (x, y)

    t0 = time.time()
    cap = cv2.VideoCapture(str(video_p))
    frames_out = []
    club_out = []
    prev = None
    f = 0
    n_total = doc["video"]["frame_count"]
    w = h = None
    while True:
        ok, img = cap.read()
        if not ok:
            break
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        if w is None:
            h, w = gray.shape
        if prev is not None:
            union, club = isolation.frame_rings(prev, gray, sil_by_frame.get(f),
                                                grip_by_frame.get(f))
            frames_out.append({"f": f, "p": union})
            club_out.append({"f": f, "p": club})
        prev = gray
        f += 1
        if f % 100 == 0:
            print(f"\r  {out_dir.name}: {f}/{n_total}", end="", flush=True)
    cap.release()

    doc_out = isolation.payload(frames_out, w or 0, h or 0, n_total)
    club_doc = isolation.payload(club_out, w or 0, h or 0, n_total)
    blob = json.dumps(doc_out)
    club_blob = json.dumps(club_doc)
    print(f"\r  {out_dir.name}: union {doc_out['coverage'] * 100:.0f}% / "
          f"club {club_doc['coverage'] * 100:.0f}% coverage, "
          f"{len(blob) / 1024:.0f}+{len(club_blob) / 1024:.0f} KB, "
          f"{time.time() - t0:.1f}s")
    if dry_run:
        return True
    for name, data in (("isolation.json", blob), ("club_only.json", club_blob)):
        tmp = out_dir / (name + ".tmp")
        tmp.write_text(data, encoding="utf-8")
        os.replace(tmp, out_dir / name)
    return True


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("dirs", nargs="*", type=Path)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    dirs = args.dirs or sorted(p for p in (ROOT / "out").glob("*")
                               if (p / "analysis.json").exists())
    if not dirs:
        raise SystemExit("no analysed swings under out/")
    print(f"isolating {len(dirs)} swing(s){'  (dry run)' if args.dry_run else ''}")
    for d in dirs:
        isolate_one(d, args.dry_run)


if __name__ == "__main__":
    main()
