"""Adds the source-timing sidecar to an already-analysed swing.

Writes `source_timing.json` beside the existing `analysis.json`: per-source-frame PTS
from the ORIGINAL upload, the mapping onto the normalized native-rate CFR timeline, and
audio metadata. Nothing else is touched — `analysis.json` is read for the source path and never
rewritten, so this is safe on fixtures with a good club solve (same reasoning as
`resegment.py` / `rescore.py`: never re-run burnin.py just to gain one artifact).

The source file must still exist at `video.source.path` (verified at write time).
A moved/deleted source warns and skips — timing is never fabricated from the normalized
derivative, which is exactly the information the resample destroyed.

Usage:
    .venv/Scripts/python.exe scripts/retiming.py                 # every out/<stem>/
    .venv/Scripts/python.exe scripts/retiming.py out/swing1      # one
    .venv/Scripts/python.exe scripts/retiming.py --dry-run       # probe, write nothing
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from swingsage import source_timing, video  # noqa: E402


def retime_one(out_dir: Path, dry_run: bool = False) -> bool:
    analysis_path = out_dir / "analysis.json"
    if not analysis_path.exists():
        print(f"  {out_dir.name}: no analysis.json — skipped")
        return False
    doc = json.loads(analysis_path.read_text(encoding="utf-8"))

    src = Path(doc["video"]["source"]["path"])
    if not src.is_file():
        print(f"  {out_dir.name}: source missing ({src}) — skipped")
        return False

    # The sidecar maps onto the player's timeline, which is normalized.mp4's — probe it for
    # the real CFR frame count rather than trusting video.frame_count (the pose series
    # length, which can differ by a tail frame).
    norm_path = out_dir / "normalized.mp4"
    if norm_path.exists():
        norm = video.probe(norm_path)
        out_fps, out_frames = norm.fps, norm.frame_count
    else:
        out_fps, out_frames = doc["video"]["fps"], doc["video"]["frame_count"]

    # The same retime decision the pipeline made, so the map lands on the clock the
    # normalized clip was actually built on (v2 maps retimed clips too). The artifact's
    # capture facts are authoritative — post-retime its source.fps already IS the capture
    # rate — with the container tag as the same fallback the pipeline uses.
    src_info = video.probe(src)
    source_doc = doc["video"]["source"]
    capture_fps = float(source_doc.get("capture_fps") or 0.0) or video.probe_capture_fps(src)
    capture_fps_source = source_doc.get("capture_fps_source") or (
        "container_tag" if capture_fps else "none")
    retime = video.retime_factor(src_info, capture_fps)
    timing = source_timing.build(src, out_fps=out_fps, out_frame_count=out_frames,
                                 pts_scale=retime or 1.0, capture_fps=capture_fps,
                                 capture_fps_source=capture_fps_source)
    dups = sum(1 for o in timing.observations if o.is_duplicate_group)
    dropped = sum(1 for o in timing.observations if not o.normalized_frames)
    print(f"  {out_dir.name}: {timing.distinct_observation_count} source observations "
          f"-> {out_frames} CFR frames ({dups} duplicated, {dropped} dropped), audio="
          + (f"{timing.audio_sample_rate}Hz {timing.audio_codec}"
             if timing.has_audio else "none"))
    if dry_run:
        return True
    source_timing.write_sidecar(timing, out_dir)
    return True


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("dirs", nargs="*", type=Path,
                    help="out/<stem> directories; default is every out/*/ with an analysis.json")
    ap.add_argument("--dry-run", action="store_true", help="probe, write nothing")
    args = ap.parse_args()

    dirs = args.dirs or sorted(p for p in (ROOT / "out").glob("*")
                               if (p / "analysis.json").exists())
    if not dirs:
        raise SystemExit("no analysed swings found under out/ — run burnin.py first")
    print(f"retiming {len(dirs)} swing(s){'  (dry run)' if args.dry_run else ''}")
    for d in dirs:
        retime_one(d, args.dry_run)


if __name__ == "__main__":
    main()
