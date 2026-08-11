#!/usr/bin/env python
"""
Build the REAL-swing spike asset pair: a bar-stamped clip and the pose data to draw over it.

    python make_real_clip.py --stem swing1

Why a real clip as well as the synthetic one
--------------------------------------------
They answer different questions and neither replaces the other.

The synthetic clip (`make-frame-clip.mjs`) is the *correctness* instrument. Its pixels encode
ground truth — bar position IS frame number — so drift is measurable to a fraction of a frame.
Real footage cannot do that on its own: frames 300 and 302 of a golf swing look nearly identical,
so no script and no human could say which frame a drawn skeleton belongs to. Measuring sync on
raw real footage would mean going back to "looks about right", which is precisely the standard
this project's history warns hardest against.

But a single 2px marker is not the *workload*. The real overlay is 49 keypoints, a club trace and
angle arcs, redrawn every frame, and an overlay strategy that pins one line perfectly may still
collapse on that. Cost has to be measured on the real thing.

So this composites the machine-readable bar ONTO real footage: real content, real rendering cost,
and ground truth in the same clip. Same trick as `services/analyzer/scripts/stampframes.py`, which
already burns ffmpeg's own frame number in for the same reason — this adds the mark a script can
read without OCR.

Outputs (into apps/mobile/assets/):
  <stem>-stamped.mp4   the clip, downscaled, GOP 10, sweeping bar composited on
  <stem>-pose.json     {fps, frames: [{f, kp: [[x, y, conf], ...]}]} normalized 0-1
"""

from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
OUT_ROOT = REPO / "services" / "analyzer" / "out"
ASSETS = Path(__file__).resolve().parents[1] / "assets"

BAR_WIDTH = 12
TARGET_WIDTH = 720  # matches the synthetic clip, and keeps the asset small enough to bundle


def truncate(value: float, places: int) -> float:
    """
    Truncate, never round.

    `analysis.json`'s confidences are truncated by the analyzer precisely so that a value cannot
    round *up* onto the MIN_CONF gate and make a client include a point the analyzer dropped.
    Re-emitting them with `round()` would reintroduce exactly that bug at one-in-a-thousand rates,
    which is the kind of defect that shows up as a single wrong joint on one frame and is never
    traced back here.
    """
    factor = 10**places
    return math.floor(value * factor) / factor


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--stem", default="swing1", help="a directory under services/analyzer/out/")
    ap.add_argument("--source", default="framestamp.mp4",
                    help="clip inside that directory; framestamp.mp4 already has frame numbers")
    args = ap.parse_args()

    out_dir = OUT_ROOT / args.stem
    analysis_path = out_dir / "analysis.json"
    source = out_dir / args.source
    if not analysis_path.exists():
        print(f"no analysis.json at {analysis_path}", file=sys.stderr)
        return 1
    if not source.exists():
        print(
            f"no {args.source} at {source} — run services/analyzer/scripts/stampframes.py first",
            file=sys.stderr,
        )
        return 1

    analysis = json.loads(analysis_path.read_text(encoding="utf-8"))
    video = analysis["video"]
    pose = analysis["pose"]
    frames = pose["frames"]
    fps = float(video["fps"])
    n_frames = int(video["frame_count"])

    if len(frames) != n_frames:
        # Not fatal, but it changes what the bar means, so it must be visible rather than assumed.
        print(f"note: {len(frames)} pose frames vs {n_frames} video frames", file=sys.stderr)

    height = round(TARGET_WIDTH * video["height"] / video["width"])
    height += height % 2  # h264 needs even dimensions

    ASSETS.mkdir(parents=True, exist_ok=True)
    clip_out = ASSETS / f"{args.stem}-stamped.mp4"

    # Same bar geometry and the same expression as the synthetic clip, so measure_overlay.py reads
    # both with one code path — only the frame count differs.
    graph = (
        f"[0:v]scale={TARGET_WIDTH}:{height}[v];"
        f"[v][1:v]overlay=x='(W-w)*n/{n_frames - 1}':y=0:eval=frame[out]"
    )
    with tempfile.TemporaryDirectory() as tmp:
        graph_file = Path(tmp) / "graph.txt"
        graph_file.write_text(graph, encoding="utf-8")
        subprocess.run(
            [
                "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
                "-i", str(source),
                "-f", "lavfi", "-i", f"color=c=0xa3e635:s={BAR_WIDTH}x{height}:r={fps}",
                "-/filter_complex", str(graph_file),
                "-map", "[out]",
                "-c:v", "libx264", "-preset", "medium", "-crf", "23", "-pix_fmt", "yuv420p",
                "-g", "10", "-keyint_min", "10", "-sc_threshold", "0",
                "-r", str(fps), "-fps_mode", "cfr", "-an",
                # The bar is generated by an INFINITE lavfi colour source, so without a bound
                # ffmpeg keeps encoding long after the real footage ends. Left unbounded this
                # produced a 1.9GB file and was still going. `-t` is belt and braces alongside
                # `-shortest`, since `-shortest` can be ignored when the finite input is a filter
                # input rather than an output stream.
                "-shortest",
                "-t", f"{n_frames / fps:.3f}",
                str(clip_out),
            ],
            check=True,
        )

    pose_out = ASSETS / f"{args.stem}-pose.json"
    compact = {
        "stem": args.stem,
        "fps": fps,
        "frameCount": n_frames,
        "width": TARGET_WIDTH,
        "height": height,
        "view": video.get("view"),
        "handedness": video.get("handedness"),
        "keypointNames": pose["keypoint_names"],
        # Coordinates stay normalized 0-1 exactly as the contract requires, so the client scales
        # and does nothing else. x/y rounded (they are positions, and 1e-4 of a frame width is far
        # below a pixel); confidence TRUNCATED, for the reason in truncate().
        "frames": [
            {
                "f": fr["f"],
                "kp": [[round(p[0], 4), round(p[1], 4), truncate(p[2], 3)] for p in fr["kp"]],
            }
            for fr in frames
        ],
    }
    pose_out.write_text(json.dumps(compact, separators=(",", ":")), encoding="utf-8")

    print(f"clip  {clip_out}  ({clip_out.stat().st_size / 1e6:.1f} MB)")
    print(f"pose  {pose_out}  ({pose_out.stat().st_size / 1e6:.1f} MB, {len(frames)} frames)")
    print(f"geometry {TARGET_WIDTH}x{height} @ {fps}fps, {n_frames} frames, bar {BAR_WIDTH}px")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
