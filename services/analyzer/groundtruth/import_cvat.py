"""Convert a CVAT annotation export into schema-valid club-pose label files.

The tool is replaceable; the schema is not (plan 08 SS13). This reads the
"CVAT for images 1.1" XML export - the format CVAT emits for point tasks
regardless of whether the task was created from video frames - and writes one
club-pose-labels JSON per labeled clip.

CVAT task conventions this importer expects (documented here so the task
template can be rebuilt in any equivalent tool):
- one CVAT task per clip, task name = the clip stem;
- point labels named exactly: grip, shaft_mid, hosel, head_a, head_b;
- an attribute "visibility" on each point: visible | occluded (out-of-frame
  points are simply not placed);
- image-level tag "blur" with attribute severity: none | mild | heavy |
  shaft_streak | head_streak | unusable (frames without the tag = none);
- frame numbers in CVAT are the NORMALIZED frame ids (annotate over
  out/<stem>/normalized.mp4 frames, never the source clip).

Usage:
  python -m groundtruth.import_cvat export.xml --fps 60 --annotator taylor \
      --out fixtures/labels/
"""

from __future__ import annotations

import argparse
import json
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

from . import labels as gt_labels

POINTS = ("grip", "shaft_mid", "hosel", "head_a", "head_b")
BLURS = {"none", "mild", "heavy", "shaft_streak", "head_streak", "unusable"}


def parse_cvat_xml(xml_path: Path) -> dict:
    """Parse a CVAT-for-images 1.1 export into {clip: {frame: row_dict}}."""
    root = ET.parse(xml_path).getroot()
    task_name = None
    for meta_name in root.iter("name"):
        task_name = (meta_name.text or "").strip()
        break
    size = root.find(".//original_size")
    width = float(size.findtext("width")) if size is not None else None
    height = float(size.findtext("height")) if size is not None else None

    by_clip: dict[str, dict[int, dict]] = defaultdict(dict)
    for image in root.iter("image"):
        frame = int(image.get("id"))
        clip = task_name or Path(image.get("name", "unknown")).stem.split("_frame_")[0]
        row = {
            "frame": frame,
            "blur": "none",
            "annotator_confidence": 1.0,
            "points": {},
        }
        w = float(image.get("width", width or 0)) or None
        h = float(image.get("height", height or 0)) or None
        for tag in image.iter("tag"):
            if tag.get("label") == "blur":
                for attr in tag.iter("attribute"):
                    if attr.get("name") == "severity" and (attr.text or "").strip() in BLURS:
                        row["blur"] = attr.text.strip()
        for pt in image.iter("points"):
            label = pt.get("label")
            if label not in POINTS:
                continue
            xy = pt.get("points", "").split(";")[0]
            x_s, y_s = xy.split(",")
            vis = "visible"
            conf = None
            for attr in pt.iter("attribute"):
                if attr.get("name") == "visibility" and (attr.text or "").strip() in ("visible", "occluded"):
                    vis = attr.text.strip()
                if attr.get("name") == "confidence":
                    try:
                        conf = float(attr.text)
                    except (TypeError, ValueError):
                        pass
            if not (w and h):
                raise ValueError(f"{xml_path}: image {frame} has no dimensions; "
                                 "cannot normalize point coordinates")
            row["points"][label] = {
                "x": min(1.0, max(0.0, float(x_s) / w)),
                "y": min(1.0, max(0.0, float(y_s) / h)),
                "v": vis,
            }
            if conf is not None:
                row["annotator_confidence"] = min(row["annotator_confidence"], conf)
        if row["blur"] == "unusable":
            row["points"] = {}
        by_clip[clip][frame] = row
    return dict(by_clip)


def build_doc(clip: str, rows: dict[int, dict], *, fps: float, annotator: str,
              annotated_at: str | None = None, club_type: str = "unknown",
              manual_version: str | None = None) -> dict:
    frames = [rows[f] for f in sorted(rows)]
    # Committed intervals = maximal runs of consecutively labeled frames.
    intervals = []
    for f in sorted(rows):
        if intervals and f == intervals[-1]["end_frame"] + 1:
            intervals[-1]["end_frame"] = f
        else:
            intervals.append({"start_frame": f, "end_frame": f})
    doc = {
        "schema": "club-pose-labels",
        "schema_version": 1,
        "clip": clip,
        "clock": "normalized",
        "fps": fps,
        "club_type": club_type,
        "annotator": annotator,
        "provenance": "manual",
        "labeled_intervals": intervals,
        "frames": frames,
    }
    if annotated_at:
        doc["annotated_at"] = annotated_at
    if manual_version:
        doc["manual_version"] = manual_version
    gt_labels.validate(doc)
    return doc


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("xml", help="CVAT for images 1.1 export")
    ap.add_argument("--fps", type=float, required=True,
                    help="the artifact video.fps the frames were annotated against")
    ap.add_argument("--annotator", required=True)
    ap.add_argument("--annotated-at", default=None)
    ap.add_argument("--club-type", default="unknown",
                    choices=["driver", "wood", "hybrid", "iron", "wedge", "unknown"])
    ap.add_argument("--manual-version", default=None)
    ap.add_argument("--out", default=None,
                    help="directory for <clip>.club.json (default: fixtures/labels/)")
    args = ap.parse_args(argv)

    out_root = Path(args.out) if args.out else (
        Path(__file__).resolve().parents[3] / "fixtures" / "labels")
    out_root.mkdir(parents=True, exist_ok=True)
    by_clip = parse_cvat_xml(Path(args.xml))
    if not by_clip:
        print("no annotated images found in export")
        return 1
    for clip, rows in sorted(by_clip.items()):
        doc = build_doc(clip, rows, fps=args.fps, annotator=args.annotator,
                        annotated_at=args.annotated_at, club_type=args.club_type,
                        manual_version=args.manual_version)
        dest = out_root / f"{clip}.club.json"
        with open(dest, "w", encoding="utf-8") as f:
            json.dump(doc, f, indent=2, sort_keys=True)
            f.write("\n")
        print(f"{clip}: {len(doc['frames'])} frames, "
              f"{len(doc['labeled_intervals'])} interval(s) -> {dest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
