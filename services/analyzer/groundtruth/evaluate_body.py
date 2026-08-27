"""Evaluate predicted body keypoints against hand-labeled body ground truth.

Pure core: `evaluate_clip` takes a label doc + the artifact's pose block +
video dims. Metric families (plan 08 SS10): per-joint pixel error median/p95,
event-frame keypoint error, shoulder/hip line angle MAE/p95, and the
wrong-high-confidence rate (a joint the model was confident about that landed
far from truth). Scoring-outcome agreement is deliberately NOT here - it needs
expert-labeled check outcomes (plan 08 SS11), which do not exist yet; building
a proxy from keypoint labels would be exactly the self-satisfying shortcut the
fixtures manifest warns about.

No body labels exist yet; this evaluator is exercised by synthetic tests until
they do. Body labeling starts after event labels (its frames come from them).
"""

from __future__ import annotations

import argparse
import json
import math
import statistics
from pathlib import Path

from . import labels as gt_labels

# A predicted joint with confidence >= HIGH_CONFIDENCE landing farther than
# WRONG_PX from truth is "confidently wrong" - the metric that matters most.
HIGH_CONFIDENCE = 0.8
WRONG_PX = 25.0

LINES = {
    "shoulder_line": ("left_shoulder", "right_shoulder"),
    "hip_line": ("left_hip", "right_hip"),
}


def _line_angle(points, a, b):
    pa, pb = points.get(a), points.get(b)
    if pa is None or pb is None:
        return None
    return math.degrees(math.atan2(pb[1] - pa[1], pb[0] - pa[0]))


def _angle_diff_deg(a, b):
    d = abs(a - b) % 360.0
    return min(d, 360.0 - d)


def evaluate_clip(label_doc: dict, pose: dict, video: dict) -> dict:
    fps = float(video["fps"])
    if abs(float(label_doc["fps"]) - fps) > 1e-6:
        return {"clip": label_doc["clip"], "stale_labels": True,
                "label_fps": float(label_doc["fps"]), "fps": fps}
    w, h = float(video["width"]), float(video["height"])
    names = pose["keypoint_names"]
    idx = {n: i for i, n in enumerate(names)}
    pred_by_frame = {fr["f"]: fr["kp"] for fr in pose["frames"]}

    per_joint: dict[str, list[float]] = {}
    event_frame_errors: dict[str, list[float]] = {}
    line_errors: dict[str, list[float]] = {k: [] for k in LINES}
    wrong_high_conf = 0
    high_conf_scored = 0
    unknown_joints: set[str] = set()

    for row in label_doc["frames"]:
        kp = pred_by_frame.get(row["frame"])
        if kp is None:
            continue
        gt_pts = {}
        pred_pts = {}
        for joint, p in row["points"].items():
            if p["v"] == "out_of_frame":
                continue
            if joint not in idx:
                unknown_joints.add(joint)
                continue
            x, y, conf = kp[idx[joint]]
            if x == 0 and y == 0 and conf == 0:  # absent joint sentinel
                continue
            err = math.hypot((p["x"] - x) * w, (p["y"] - y) * h)
            per_joint.setdefault(joint, []).append(err)
            if row.get("event"):
                event_frame_errors.setdefault(row["event"], []).append(err)
            if conf >= HIGH_CONFIDENCE:
                high_conf_scored += 1
                wrong_high_conf += err > WRONG_PX
            gt_pts[joint] = (p["x"], p["y"])
            pred_pts[joint] = (x, y)
        for line, (a, b) in LINES.items():
            ga, pa = _line_angle(gt_pts, a, b), _line_angle(pred_pts, a, b)
            if ga is not None and pa is not None:
                line_errors[line].append(_angle_diff_deg(ga, pa))

    def summarize(errs):
        s = sorted(errs)
        return {
            "n": len(s),
            "median_px": round(statistics.median(s), 2) if s else None,
            "p95_px": round(_pctl(s, 0.95), 2) if s else None,
        }

    return {
        "clip": label_doc["clip"],
        "stale_labels": False,
        "fps": fps,
        "per_joint": {j: summarize(e) for j, e in sorted(per_joint.items())},
        "event_frames": {ev: summarize(e) for ev, e in sorted(event_frame_errors.items())},
        "line_angle_mae_deg": {
            line: (round(statistics.fmean(e), 2) if e else None)
            for line, e in line_errors.items()
        },
        "line_angle_p95_deg": {
            line: (round(_pctl(sorted(e), 0.95), 2) if e else None)
            for line, e in line_errors.items()
        },
        "wrong_high_confidence_rate": (
            round(wrong_high_conf / high_conf_scored, 4) if high_conf_scored else None
        ),
        "unknown_label_joints": sorted(unknown_joints),
    }


def _pctl(sorted_vals, q):
    if not sorted_vals:
        return None
    idx = min(len(sorted_vals) - 1, int(round(q * (len(sorted_vals) - 1))))
    return sorted_vals[idx]


def default_labels_root() -> Path:
    return Path(__file__).resolve().parents[3] / "fixtures" / "labels"


def evaluate_out_dir(out_dir: Path, labels_root: Path):
    label_path = labels_root / f"{out_dir.name}.body.json"
    if not label_path.exists():
        return None
    label_doc = gt_labels.load(label_path)
    with open(out_dir / "analysis.json", encoding="utf-8") as f:
        analysis = json.load(f)
    return evaluate_clip(label_doc, analysis["pose"], analysis["video"])


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("out_dirs", nargs="+", help="out/<stem> directories with analysis.json")
    ap.add_argument("--labels-root", default=None,
                    help="directory holding <stem>.body.json (default: fixtures/labels/)")
    ap.add_argument("--json", dest="json_out", default=None)
    args = ap.parse_args(argv)

    labels_root = Path(args.labels_root) if args.labels_root else default_labels_root()
    results, skipped = {}, []
    for out_dir in map(Path, args.out_dirs):
        rep = evaluate_out_dir(out_dir, labels_root)
        if rep is None:
            skipped.append(out_dir.name)
        else:
            results[out_dir.name] = rep

    if args.json_out:
        with open(args.json_out, "w", encoding="utf-8") as f:
            json.dump({"clips": results, "skipped_no_labels": sorted(skipped)},
                      f, indent=2, sort_keys=True)
            f.write("\n")
    for stem, r in results.items():
        if r.get("stale_labels"):
            print(f"{stem}: STALE LABELS ({r['label_fps']:g} fps vs {r['fps']:g})")
            continue
        print(f"\n{stem}")
        for joint, s in r["per_joint"].items():
            print(f"  {joint:16s} n={s['n']:3d}  median {s['median_px']} px  p95 {s['p95_px']} px")
        print(f"  shoulder line MAE {r['line_angle_mae_deg']['shoulder_line']} deg, "
              f"hip line MAE {r['line_angle_mae_deg']['hip_line']} deg, "
              f"wrong-high-conf {r['wrong_high_confidence_rate']}")
    if skipped:
        print(f"\nno labels (skipped): {', '.join(sorted(skipped))}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
