"""Burn each frame's own index into a copy of `normalized.mp4`.

The objective frame-sync test. Every other check compares our overlay against our own idea of
the frame, which cannot catch being one frame out — the player draws frame N's skeleton and
believes the picture is showing frame N, and both halves are wrong together. A number burned
into the pixels by ffmpeg is the one reference the player did not produce: play the stamped clip
with the overlay's own painted index shown beside it, and any offset is two numbers that differ.

Slow motion is where an offset is legible, so check at 0.25x — at 1x a one-frame lead is 16ms.

Usage:
    .venv/Scripts/python.exe scripts/stampframes.py out/swing1
    .venv/Scripts/python.exe scripts/stampframes.py --all

Then in the player turn on Overlays -> Sync test -> "Frame stamp", which swaps the video for
this file and prints the frame the canvas is painting.
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def stamp(out_dir: Path) -> None:
    src = out_dir / "normalized.mp4"
    if not src.exists():
        print(f"{out_dir.name}: no normalized.mp4")
        return
    dst = out_dir / "framestamp.mp4"
    # `%{n}` is ffmpeg's own zero-based frame counter over the decoded stream, so the number in
    # the pixels is the index the player uses — nothing here re-derives it from a timestamp.
    # Re-encoded CFR at the source rate: the stamped clip has to stay frame-identical to the one
    # it replaces or it would be testing a different file.
    # An explicit fontfile is not optional on Windows: without one drawtext goes to fontconfig,
    # which has no config file in this ffmpeg build and takes the process down with an access
    # violation rather than an error message.
    font = next((p for p in (Path("C:/Windows/Fonts/consola.ttf"),
                             Path("C:/Windows/Fonts/arial.ttf"),
                             Path("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"))
                 if p.exists()), None)
    if font is None:
        print("no usable font found for drawtext")
        return
    # ffmpeg's filter parser needs the drive colon escaped, twice over.
    esc = str(font).replace("\\", "/").replace(":", "\\:")
    text = (f"drawtext=fontfile='{esc}':text='%{{n}}':x=24:y=24:fontsize=72:fontcolor=white:"
            "box=1:boxcolor=black@0.75:boxborderw=12")
    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(src),
           "-vf", text, "-fps_mode", "cfr", "-c:v", "libx264", "-preset", "veryfast",
           "-crf", "20", "-pix_fmt", "yuv420p", "-an", str(dst)]
    subprocess.run(cmd, check=True)
    print(f"{out_dir.name}: -> {dst}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("dirs", nargs="*", type=Path)
    ap.add_argument("--all", action="store_true")
    args = ap.parse_args()
    dirs = list(args.dirs)
    if args.all or not dirs:
        dirs = sorted(p for p in (ROOT / "out").glob("*") if (p / "normalized.mp4").exists())
    for d in dirs:
        stamp(d)


if __name__ == "__main__":
    main()
    sys.exit(0)
