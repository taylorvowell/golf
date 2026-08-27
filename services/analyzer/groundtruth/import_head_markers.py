"""Import player head-marker corrections as head-center-only club labels.

`head_markers` rows are the project's first hand-labeled club-head truth
(placed frame-by-frame in the player's marker editor). This turns a JSON dump
of those rows into schema-valid club-pose-labels files with provenance
"player_correction" - head_center only, since a marker is one click, not a
5-point pose. Rows with a NULL fps (never backfilled) are refused: without fps
provenance the staleness guard cannot run.

The analyzer has no database driver on purpose; produce the dump with psql
against the local Postgres (apps/web docker, :5433):

  psql "$APP_DATABASE_URL" -At -c "
    select json_agg(json_build_object(
      'clip', sv.video_stem, 'frame', hm.frame, 'x', hm.x, 'y', hm.y,
      'fps', hm.fps, 'artifact_revision', hm.artifact_revision))
    from head_markers hm join swing_views sv on sv.id = hm.view_id
  " > markers.json

(Adjust the clip expression to whatever column names the view's artifact stem -
the point is: one row per marker, keyed by the out/<stem> name.)

Usage:
  python -m groundtruth.import_head_markers markers.json --out fixtures/labels/
"""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path

from . import labels as gt_labels


def build_docs(rows: list[dict]) -> dict[str, dict]:
    """Group marker rows by clip into club-pose-labels docs (one per fps seen)."""
    grouped: dict[tuple[str, float], list[dict]] = defaultdict(list)
    for row in rows:
        if row.get("fps") is None:
            raise ValueError(
                f"marker row for clip {row.get('clip')!r} frame {row.get('frame')} has no fps; "
                "provenance-less rows cannot be imported (the staleness guard needs fps)"
            )
        grouped[(row["clip"], float(row["fps"]))].append(row)

    docs = {}
    for (clip, fps), markers in sorted(grouped.items()):
        by_frame = {}
        for m in sorted(markers, key=lambda r: r["frame"]):
            by_frame[m["frame"]] = {
                "frame": m["frame"],
                "blur": "none",
                "annotator_confidence": 1.0,
                "points": {
                    "head_center": {"x": m["x"], "y": m["y"], "v": "visible"},
                },
            }
        doc = {
            "schema": "club-pose-labels",
            "schema_version": 1,
            "clip": clip,
            "clock": "normalized",
            "fps": fps,
            "annotator": "player",
            "provenance": "player_correction",
            "labeled_intervals": [
                {"start_frame": f, "end_frame": f} for f in sorted(by_frame)
            ],
            "frames": [by_frame[f] for f in sorted(by_frame)],
        }
        gt_labels.validate(doc)
        key = clip if len({c for c, _ in grouped} ) == len(grouped) else f"{clip}@{fps:g}"
        docs[key] = doc
    return docs


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("dump", help="JSON array of marker rows (see module docstring)")
    ap.add_argument("--out", default=None,
                    help="directory for <clip>.club.json (default: fixtures/labels/)")
    args = ap.parse_args(argv)

    with open(args.dump, encoding="utf-8") as f:
        rows = json.load(f)
    if not isinstance(rows, list) or not rows:
        print("dump holds no marker rows")
        return 1
    out_root = Path(args.out) if args.out else (
        Path(__file__).resolve().parents[3] / "fixtures" / "labels")
    out_root.mkdir(parents=True, exist_ok=True)
    for key, doc in build_docs(rows).items():
        dest = out_root / f"{key}.club.json"
        with open(dest, "w", encoding="utf-8") as f:
            json.dump(doc, f, indent=2, sort_keys=True)
            f.write("\n")
        print(f"{key}: {len(doc['frames'])} marker frame(s) -> {dest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
