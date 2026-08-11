"""Adds Stage 2b — the golfer's outline — to an already-analysed swing.

Writes `silhouette.json` beside the existing `analysis.json` and patches that file's `posture`
block (the address butt line) in place. Nothing else in the artifact is touched: pose, club,
events, metrics and scoring are all read, never rewritten.

Use this rather than re-running `burnin.py` on a fixture that already has a good club solve.
CLAUDE.md's standing warning applies — `burnin.py` without
`--club-detector runs/clubhead/weights/best.pt` silently regenerates the club trace on the
weaker classical-only path and overwrites the better one already on disk. This script cannot
do that, because it never runs Stage 4. Same reasoning as `rescore.py`.

It re-reads `analysis.mp4` and makes its own MediaPipe pass (~20s for 400 frames), which is
the one thing `burnin.py` does NOT have to do — there the masks ride along on the pose pass
that always runs, for about a tenth of the cost.

Usage:
    .venv/Scripts/python.exe scripts/resegment.py                 # every out/<stem>/
    .venv/Scripts/python.exe scripts/resegment.py out/swing1      # one
    .venv/Scripts/python.exe scripts/resegment.py --dry-run       # measure, write nothing
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from swingsage import contract, silhouette  # noqa: E402

MODEL = ROOT / "models" / "pose_landmarker_heavy.task"


def resegment_one(out_dir: Path, dry_run: bool = False) -> bool:
    analysis_path = out_dir / "analysis.json"
    video = out_dir / "analysis.mp4"
    if not analysis_path.exists() or not video.exists():
        print(f"  {out_dir.name}: needs analysis.json + analysis.mp4 — skipped")
        return False
    doc = json.loads(analysis_path.read_text(encoding="utf-8"))

    t = time.time()
    def prog(done, total):
        print(f"\r  {out_dir.name}: segmenting {done}/{total or '?'}", end="", flush=True)

    sil = silhouette.run(video, MODEL, progress=prog)
    frames = doc["pose"]["frames"]
    names = doc["pose"]["keypoint_names"]
    # NOT doc["pose"]["model"] — that is RTMW on these clips, and the mask is MediaPipe's.
    payload = silhouette.payload(sil, frames, names, silhouette.MODEL_ID,
                                 doc["video"]["analysis_res"]["width"],
                                 doc["video"]["analysis_res"]["height"],
                                 doc["video"]["frame_count"])
    butt, notes = silhouette.butt_line(sil, frames, names, doc.get("address_span"),
                                       doc["metrics"]["body_height_norm"],
                                       doc["video"]["view"])

    blob = json.dumps(payload)
    print(f"\r  {out_dir.name}: {payload['coverage'] * 100:.0f}% coverage, "
          f"{len(blob) / 1024:.0f} KB, {time.time() - t:.1f}s  ·  "
          + (f"butt x={butt['x']:.4f} conf {butt['conf']} "
             f"(spread {butt['spread_bh'] * 100:.1f}% bh, n={butt['n']})"
             if butt else "no butt line"))
    for n in payload["notes"] + notes:
        print(f"      ! {n}")
    if dry_run:
        return True

    contract.write_json("silhouette", payload, out_dir / "silhouette.json")

    # Patch, don't rebuild. Every other key keeps its existing value, including
    # schema_version: this artifact really is a v7 that has gained one v8 block, and claiming
    # a full v8 would assert the rest of that version's contract too.
    doc["posture"] = {"butt_line": butt, "notes": notes}
    contract.write_json("analysis", doc, out_dir / "analysis.json")
    return True


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("dirs", nargs="*", type=Path,
                    help="out/<stem> directories; default is every out/*/ with an analysis.json")
    ap.add_argument("--dry-run", action="store_true", help="measure, write nothing")
    args = ap.parse_args()

    dirs = args.dirs or sorted(p for p in (ROOT / "out").glob("*")
                               if (p / "analysis.json").exists())
    if not dirs:
        raise SystemExit("no analysed swings found under out/ — run burnin.py first")
    print(f"segmenting {len(dirs)} swing(s){'  (dry run)' if args.dry_run else ''}")
    for d in dirs:
        resegment_one(d, args.dry_run)


if __name__ == "__main__":
    main()
