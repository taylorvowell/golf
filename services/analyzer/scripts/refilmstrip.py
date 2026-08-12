"""Adds `filmstrip.jpg` — the scrubber's picture — to an already-analysed swing.

One row of clean, evenly-spaced frames across `playback_window`. No skeleton and no stamped
frame numbers: that is `contact.jpg`, which is a debug sheet and is the wrong thing entirely
under a golfer's thumb.

Use this rather than re-running `burnin.py` on a fixture that already has a good club solve.
CLAUDE.md's standing warning applies — `burnin.py` without
`--club-detector runs/clubhead/weights/best.pt` silently regenerates the club trace on the
weaker classical-only path and overwrites the better one already on disk. This script cannot
do that, because it reads pixels and `playback_window` and runs no stage at all. Same reasoning
as `rescore.py` and `resegment.py`.

`burnin.py` writes this artifact itself from now on, so this is only for the swings analysed
before it did.

Usage:
    .venv/Scripts/python.exe scripts/refilmstrip.py                 # every out/<stem>/
    .venv/Scripts/python.exe scripts/refilmstrip.py out/swing1      # one
    .venv/Scripts/python.exe scripts/refilmstrip.py --force         # rewrite existing strips
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from swingsage import render  # noqa: E402


def strip_one(out_dir: Path, force: bool = False) -> bool:
    analysis_path = out_dir / "analysis.json"
    # `normalized.mp4` and not `analysis.mp4`: the strip's cell indices are frame numbers in the
    # CFR clip the player scrubs, and that is the only file guaranteed to share its timebase.
    video = out_dir / "normalized.mp4"
    if not analysis_path.exists() or not video.exists():
        print(f"  {out_dir.name}: needs analysis.json + normalized.mp4 — skipped")
        return False

    target = out_dir / "filmstrip.jpg"
    if target.exists() and not force:
        print(f"  {out_dir.name}: already has one — skipped (use --force)")
        return False

    doc = json.loads(analysis_path.read_text(encoding="utf-8"))
    window = doc.get("playback_window")
    frame_count = int(doc.get("video", {}).get("frame_count") or 0)
    if window and len(window) == 2:
        first, last = int(window[0]), int(window[1])
    else:
        # Artifacts older than schema 5 carry no window. The whole file is the honest fallback —
        # the same one the clients make — rather than guessing at where the swing sits in it.
        first, last = 0, max(frame_count - 1, 0)

    t = time.time()
    render.filmstrip(video, target, first=first, last=last)
    size = target.stat().st_size
    print(f"  {out_dir.name}: frames {first}-{last} -> {size // 1024} KB ({time.time() - t:.1f}s)")
    return True


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("dirs", nargs="*", type=Path, help="out/<stem> folders; default is all of them")
    ap.add_argument("--force", action="store_true", help="rewrite a strip that already exists")
    args = ap.parse_args()

    dirs = args.dirs or sorted(d for d in (ROOT / "out").glob("*") if d.is_dir())
    if not dirs:
        print("nothing to do — no out/<stem>/ folders")
        return 1

    print(f"filmstrip: {len(dirs)} swing(s), {render.FILMSTRIP_CELLS} cells of "
          f"{render.FILMSTRIP_CELL_W}x{render.FILMSTRIP_CELL_H}")
    written = sum(strip_one(d, force=args.force) for d in dirs)
    print(f"wrote {written}/{len(dirs)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
