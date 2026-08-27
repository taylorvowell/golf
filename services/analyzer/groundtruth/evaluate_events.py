"""Evaluate detected swing events against hand-labeled event ground truth.

Pure core: `evaluate_swing` / `aggregate` take plain dicts and never touch disk.
Adapter: `predictions_from_analysis` reads one analysis.json dict.
CLI: evaluate every out/<stem> that has an event label file and print/write a report.

Metric families (plan 08 SS9): exact / +-1 / +-2 / +-4 frame rates, median/p90/p95
ms error, catastrophic miss rate, high-confidence catastrophic miss rate,
abstention rate, confidence calibration - reported per fps, because a "frame"
means different milliseconds at 30 and 240 fps.

Labels and predictions are both on the NORMALIZED clock (the artifact's public
frame identity). A label file whose fps disagrees with the artifact's is STALE
and is refused, never renumbered - the same rule the corrections tables follow.
"""

from __future__ import annotations

import argparse
import json
import statistics
from pathlib import Path

from . import labels as gt_labels

EVENTS = gt_labels.EVENT_ORDER
# The eight events the pipeline emits; a labeled event outside this set (takeaway)
# is reported but never counted as a pipeline abstention.
PIPELINE_EVENTS = tuple(e for e in EVENTS if e != "takeaway")

# An event this far off is not an error bar, it is a different moment of the
# swing. 200 ms = 12 frames at 60 fps; the known 7wood-1 impact miss (40 frames,
# ~667 ms) is 3x past it.
CATASTROPHIC_MS = 200.0
# A catastrophic miss carried with confidence >= this is the worst product
# failure: confidently wrong. Gated to zero on the golden set.
HIGH_CONFIDENCE = 0.8

CALIBRATION_BUCKETS = ((0.0, 0.5), (0.5, 0.8), (0.8, 1.01))


def predictions_from_analysis(analysis: dict) -> dict:
    """Extract {event: {frame, conf}} + fps from an analysis.json dict."""
    fps = float(analysis["video"]["fps"])
    out = {"fps": fps}
    for name, ev in (analysis.get("events") or {}).items():
        if name in EVENTS and isinstance(ev, dict):
            out[name] = {"frame": ev.get("frame"), "conf": ev.get("conf")}
    return out


def evaluate_swing(label_doc: dict, predicted: dict) -> dict:
    """Compare one swing's predictions against its label document.

    predicted: {"fps": float, event_name: {"frame": int|None, "conf": float|None}}
    on the normalized clock (see predictions_from_analysis).
    """
    fps = float(predicted["fps"])
    label_fps = float(label_doc["fps"])
    if abs(label_fps - fps) > 1e-6:
        return {
            "clip": label_doc["clip"],
            "fps": fps,
            "stale_labels": True,
            "label_fps": label_fps,
            "events": {},
        }
    rows = {}
    for name in EVENTS:
        lab = label_doc["events"].get(name)
        if lab is None:  # optional event not labeled -> not evaluable
            continue
        pred = predicted.get(name)
        row = {
            "labeled_frame": lab["frame"],
            "label_confidence": lab["confidence"],
            "predicted_frame": None if pred is None else pred.get("frame"),
            "confidence": None if pred is None else pred.get("conf"),
        }
        if lab["frame"] is None:
            row["status"] = "label_abstained"
        elif name not in PIPELINE_EVENTS:
            row["status"] = "not_pipeline_scope"
        elif row["predicted_frame"] is None:
            row["status"] = "prediction_abstained"
        else:
            err_frames = row["predicted_frame"] - lab["frame"]
            err_ms = err_frames / fps * 1000.0
            row.update(
                status="scored",
                error_frames=err_frames,
                error_ms=round(err_ms, 3),
                catastrophic=bool(abs(err_ms) > CATASTROPHIC_MS),
            )
            row["high_confidence_catastrophic"] = bool(
                row["catastrophic"]
                and row["confidence"] is not None
                and row["confidence"] >= HIGH_CONFIDENCE
            )
        rows[name] = row
    return {"clip": label_doc["clip"], "fps": fps, "stale_labels": False, "events": rows}


def aggregate(swing_reports: list[dict]) -> dict:
    """Aggregate per-swing reports into per-event, per-fps metric families."""
    out: dict = {}
    for rep in swing_reports:
        if rep.get("stale_labels"):
            continue
        fps_key = f"{rep['fps']:g}"
        for name, row in rep["events"].items():
            bucket = out.setdefault(fps_key, {}).setdefault(
                name,
                {
                    "n": 0,
                    "scored": 0,
                    "prediction_abstained": 0,
                    "label_abstained": 0,
                    "not_pipeline_scope": 0,
                    "errors_frames": [],
                    "errors_ms": [],
                    "catastrophic": 0,
                    "high_confidence_catastrophic": 0,
                    "calibration": {
                        f"{lo:g}-{min(hi, 1.0):g}": {"n": 0, "within_2": 0}
                        for lo, hi in CALIBRATION_BUCKETS
                    },
                },
            )
            bucket["n"] += 1
            if row["status"] == "scored":
                bucket["scored"] += 1
                bucket["errors_frames"].append(row["error_frames"])
                bucket["errors_ms"].append(row["error_ms"])
                bucket["catastrophic"] += row["catastrophic"]
                bucket["high_confidence_catastrophic"] += row["high_confidence_catastrophic"]
                conf = row["confidence"]
                if conf is not None:
                    for lo, hi in CALIBRATION_BUCKETS:
                        if lo <= conf < hi:
                            cal = bucket["calibration"][f"{lo:g}-{min(hi, 1.0):g}"]
                            cal["n"] += 1
                            cal["within_2"] += abs(row["error_frames"]) <= 2
                            break
            else:
                bucket[row["status"]] += 1

    for by_event in out.values():
        for b in by_event.values():
            errs_ms = b.pop("errors_ms")
            abs_f = sorted(abs(e) for e in b.pop("errors_frames"))
            abs_ms = sorted(abs(e) for e in errs_ms)
            n = len(abs_f)
            b["exact_rate"] = _rate(sum(e == 0 for e in abs_f), n)
            for k in (1, 2, 4):
                b[f"within_{k}_rate"] = _rate(sum(e <= k for e in abs_f), n)
            b["median_ms"] = round(statistics.median(abs_ms), 3) if n else None
            b["p90_ms"] = _pctl(abs_ms, 0.90)
            b["p95_ms"] = _pctl(abs_ms, 0.95)
            b["max_ms"] = abs_ms[-1] if n else None
            b["catastrophic_rate"] = _rate(b["catastrophic"], n)
            denom = b["scored"] + b["prediction_abstained"]
            b["abstention_rate"] = _rate(b["prediction_abstained"], denom)
            for cal in b["calibration"].values():
                cal["within_2_rate"] = _rate(cal["within_2"], cal["n"])
    return out


def _rate(k: int, n: int):
    return round(k / n, 4) if n else None


def _pctl(sorted_vals, q):
    if not sorted_vals:
        return None
    idx = min(len(sorted_vals) - 1, int(round(q * (len(sorted_vals) - 1))))
    return sorted_vals[idx]


def default_labels_root() -> Path:
    return Path(__file__).resolve().parents[3] / "fixtures" / "labels"


def evaluate_out_dir(out_dir: Path, labels_root: Path) -> dict | None:
    """Evaluate one out/<stem>; None when it has no event label file."""
    label_path = labels_root / f"{out_dir.name}.events.json"
    if not label_path.exists():
        return None
    label_doc = gt_labels.load(label_path)
    with open(out_dir / "analysis.json", encoding="utf-8") as f:
        analysis = json.load(f)
    return evaluate_swing(label_doc, predictions_from_analysis(analysis))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("out_dirs", nargs="+", help="out/<stem> directories with analysis.json")
    ap.add_argument("--labels-root", default=None,
                    help="directory holding <stem>.events.json label files "
                         "(default: fixtures/labels/)")
    ap.add_argument("--json", dest="json_out", default=None, help="write full report JSON here")
    args = ap.parse_args(argv)

    labels_root = Path(args.labels_root) if args.labels_root else default_labels_root()
    reports, skipped = [], []
    for out_dir in map(Path, args.out_dirs):
        rep = evaluate_out_dir(out_dir, labels_root)
        if rep is None:
            skipped.append(out_dir.name)
        else:
            reports.append(rep)

    agg = aggregate(reports)
    if args.json_out:
        full = {"swings": reports, "aggregate": agg, "skipped_no_labels": sorted(skipped)}
        with open(args.json_out, "w", encoding="utf-8") as f:
            json.dump(full, f, indent=2, sort_keys=True)
            f.write("\n")
    _print_table(reports, agg, skipped)
    return 0


def _print_table(reports, agg, skipped):
    for rep in reports:
        if rep.get("stale_labels"):
            print(f"\n{rep['clip']}: STALE LABELS (labeled at {rep['label_fps']:g} fps, "
                  f"artifact is {rep['fps']:g}) - not scored")
            continue
        print(f"\n{rep['clip']} ({rep['fps']:g} fps)")
        for name in EVENTS:
            row = rep["events"].get(name)
            if row is None:
                continue
            if row["status"] != "scored":
                print(f"  {name:18s} {row['status']}")
                continue
            flag = "  <-- CATASTROPHIC" if row["catastrophic"] else ""
            if row.get("high_confidence_catastrophic"):
                flag += " (HIGH CONFIDENCE)"
            print(f"  {name:18s} gt {row['labeled_frame']:5d}  pred "
                  f"{row['predicted_frame']:5d}  err {row['error_frames']:+4d} f "
                  f"({row['error_ms']:+9.1f} ms){flag}")
    for fps_key, by_event in sorted(agg.items()):
        print(f"\naggregate @ {fps_key} fps")
        for name in EVENTS:
            b = by_event.get(name)
            if b is None:
                continue
            if not b["scored"]:
                print(f"  {name:18s} nothing scored (n={b['n']})")
                continue
            print(f"  {name:18s} n={b['scored']:2d}  exact {b['exact_rate']}  "
                  f"±2 {b['within_2_rate']}  ±4 {b['within_4_rate']}  "
                  f"median {b['median_ms']} ms  p95 {b['p95_ms']} ms  "
                  f"catastrophic {b['catastrophic']} (high-conf {b['high_confidence_catastrophic']})")
    if skipped:
        print(f"\nno labels (skipped): {', '.join(sorted(skipped))}")


if __name__ == "__main__":
    raise SystemExit(main())
