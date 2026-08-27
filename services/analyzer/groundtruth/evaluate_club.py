"""Evaluate per-frame club predictions against hand-labeled club-pose ground truth.

Pure core: `evaluate_clip` takes a label doc + a club dict (the artifact's
`club`, or any entry of `club.variants` - same frame shape) + video dims.
CLI: evaluate every out/<stem> with a club label file; `--variants` also ranks
every variant against the same labels - the ranking table five modules have a
TODO waiting on.

Metric families (plan 08 SS8): PCK@2/5/10 px, median/p95 point error, error
normalized by club length, head-center median/p95, shaft angular error,
visible-frame precision/recall, false-positive rate, confidence calibration,
gap count + duration distribution, catastrophic jump rate, impact-window error.
Hosel error is null for now: the current artifact predicts no hosel point
(shaft endpoints are butt and head); the metric slot exists for club v2.

Trace quality = these frame-aligned point errors over visible GT frames.
Smoothness is explicitly diagnostic-only and appears nowhere here.
"""

from __future__ import annotations

import argparse
import json
import math
import statistics
from pathlib import Path

from . import labels as gt_labels

PCK_THRESHOLDS_PX = (2.0, 5.0, 10.0)
# A direct-claimed head jumping farther than this fraction of the image diagonal
# in one frame is treated as physically impossible. Deliberately loose until
# labels exist to calibrate it (plan 08 SS15: exact values come after labels).
CATASTROPHIC_JUMP_DIAG_FRAC = 0.25
IMPACT_WINDOW_FRAMES = 12
CALIBRATION_BUCKETS = ((0.0, 0.4), (0.4, 0.7), (0.7, 1.01))


def _dist_px(a, b, w, h):
    return math.hypot((a[0] - b[0]) * w, (a[1] - b[1]) * h)


ESTIMATE_BLURS = ("heavy", "shaft_streak", "head_streak")


def _gt_head_center(points):
    """(x, y, occluded) for the labeled head center, or None when there is none."""
    hc = points.get("head_center")
    if hc is not None and hc["v"] != "out_of_frame":
        return (hc["x"], hc["y"], hc["v"] == "occluded")
    ha, hb = points.get("head_a"), points.get("head_b")
    if ha and hb and ha["v"] != "out_of_frame" and hb["v"] != "out_of_frame":
        occ = ha["v"] == "occluded" or hb["v"] == "occluded"
        return ((ha["x"] + hb["x"]) / 2.0, (ha["y"] + hb["y"]) / 2.0, occ)
    return None


def _gt_shaft_angle(points):
    g, hs = points.get("grip"), points.get("hosel")
    if not (g and hs) or g["v"] == "out_of_frame" or hs["v"] == "out_of_frame":
        return None
    return math.degrees(math.atan2(hs["y"] - g["y"], hs["x"] - g["x"]))


def _angle_diff_deg(a, b):
    """Undirected line angle difference, folded into [0, 90]."""
    d = abs(a - b) % 180.0
    return min(d, 180.0 - d)


def evaluate_clip(label_doc: dict, club: dict, video: dict,
                  *, impact_frame: int | None = None) -> dict:
    """Score one club solution (main or variant) against one clip's labels."""
    fps = float(video["fps"])
    if abs(float(label_doc["fps"]) - fps) > 1e-6:
        return {"clip": label_doc["clip"], "stale_labels": True,
                "label_fps": float(label_doc["fps"]), "fps": fps}
    w, h = float(video["width"]), float(video["height"])
    diag = math.hypot(w, h)
    pred_by_frame = {fr["f"]: fr for fr in club.get("frames", [])}

    # Two pools by GT quality: SHARP truth drives every headline metric; ESTIMATE truth
    # (streak-midpoints - heavy/streak blur, or an occluded head point) is real but
    # lower-precision, so it gets its own block rather than polluting the sharp numbers.
    # The frames that matter most (near impact) are the blurriest, so throwing estimates
    # away would grade methods only on the easy frames - both pools are reported.
    head_errors: list[float] = []          # px, sharp GT + direct prediction
    blurred_errors: list[float] = []       # px, estimate GT + direct prediction
    impact_errors: list[float] = []        # px, both pools - impact IS the blurry region
    angle_errors: list[float] = []
    club_lengths: list[float] = []         # px, GT grip-to-head-center
    calibration = {
        f"{lo:g}-{min(hi, 1.0):g}": {"n": 0, "within_10": 0}
        for lo, hi in CALIBRATION_BUCKETS
    }
    tp = fn = fp = 0
    gt_negative = 0
    per_frame_direct: dict[int, bool] = {}

    for row in label_doc["frames"]:
        f = row["frame"]
        pred = pred_by_frame.get(f)
        gt = None if (row["blur"] == "unusable" or row.get("head_hidden")) \
            else _gt_head_center(row["points"])
        # A frame with no head at all is an abstention, whatever its flags say - several
        # variants publish rows with head=None where they had nothing.
        direct = (bool(pred) and pred.get("head") is not None
                  and not pred.get("interp") and not pred.get("from_ball"))
        per_frame_direct[f] = direct

        if gt is None:
            gt_negative += 1
            if direct:
                fp += 1
            continue
        gt_head = (gt[0], gt[1])
        estimate = gt[2] or row["blur"] in ESTIMATE_BLURS
        if not direct:
            fn += 1
            continue
        tp += 1
        err = _dist_px(gt_head, pred["head"], w, h)
        (blurred_errors if estimate else head_errors).append(err)
        if impact_frame is not None and abs(f - impact_frame) <= IMPACT_WINDOW_FRAMES:
            impact_errors.append(err)
        conf = pred.get("conf")
        if conf is not None and not estimate:
            for lo, hi in CALIBRATION_BUCKETS:
                if lo <= conf < hi:
                    cal = calibration[f"{lo:g}-{min(hi, 1.0):g}"]
                    cal["n"] += 1
                    cal["within_10"] += err <= 10.0
                    break
        gt_angle = _gt_shaft_angle(row["points"])
        if gt_angle is not None and pred.get("shaft_angle_deg") is not None:
            angle_errors.append(_angle_diff_deg(gt_angle, pred["shaft_angle_deg"]))
        g = row["points"].get("grip")
        if g and g["v"] != "out_of_frame" and not estimate:
            club_lengths.append(_dist_px((g["x"], g["y"]), gt_head, w, h))

    # Gaps: runs of non-direct frames inside the committed labeled intervals.
    gap_durations: list[int] = []
    for iv in label_doc["labeled_intervals"]:
        run = 0
        for f in range(iv["start_frame"], iv["end_frame"] + 1):
            if not per_frame_direct.get(f, False):
                run += 1
            elif run:
                gap_durations.append(run)
                run = 0
        if run:
            gap_durations.append(run)

    # Catastrophic jumps: consecutive direct frames whose predicted head moves
    # an impossible distance, checked over the labeled intervals.
    jumps = jump_pairs = 0
    for iv in label_doc["labeled_intervals"]:
        for f in range(iv["start_frame"], iv["end_frame"]):
            a, b = pred_by_frame.get(f), pred_by_frame.get(f + 1)
            if not (a and b) or not (per_frame_direct.get(f) and per_frame_direct.get(f + 1)):
                continue
            jump_pairs += 1
            if _dist_px(a["head"], b["head"], w, h) > CATASTROPHIC_JUMP_DIAG_FRAC * diag:
                jumps += 1

    head_sorted = sorted(head_errors)
    norm = statistics.median(club_lengths) if club_lengths else None
    for cal in calibration.values():
        cal["within_10_rate"] = _rate(cal["within_10"], cal["n"])
    return {
        "clip": label_doc["clip"],
        "stale_labels": False,
        "fps": fps,
        "labeled_frames": len(label_doc["frames"]),
        "scored_frames": len(head_errors),
        "blurred": {
            "n": len(blurred_errors),
            "median_px": _round(statistics.median(blurred_errors)) if blurred_errors else None,
            "p95_px": _round(_pctl(sorted(blurred_errors), 0.95)),
            "max_px": _round(max(blurred_errors)) if blurred_errors else None,
        },
        "pck_px": {
            f"{t:g}": _rate(sum(e <= t for e in head_sorted), len(head_sorted))
            for t in PCK_THRESHOLDS_PX
        },
        "head_center_median_px": _round(statistics.median(head_sorted)) if head_sorted else None,
        "head_center_p95_px": _round(_pctl(head_sorted, 0.95)),
        "head_center_max_px": _round(head_sorted[-1]) if head_sorted else None,
        "error_over_club_len_median": (
            _round(statistics.median(head_sorted) / norm) if head_sorted and norm else None
        ),
        "hosel_median_px": None,  # artifact predicts no hosel point (club v2 slot)
        "shaft_angle_mae_deg": _round(statistics.fmean(angle_errors)) if angle_errors else None,
        "shaft_angle_p95_deg": _round(_pctl(sorted(angle_errors), 0.95)),
        "visible_precision": _rate(tp, tp + fp),
        "visible_recall": _rate(tp, tp + fn),
        "false_positive_rate": _rate(fp, gt_negative),
        "confidence_calibration": calibration,
        "gap_count": len(gap_durations),
        "gap_frames_median": statistics.median(gap_durations) if gap_durations else None,
        "gap_frames_max": max(gap_durations) if gap_durations else None,
        "catastrophic_jumps": jumps,
        "catastrophic_jump_rate": _rate(jumps, jump_pairs),
        "impact_window_median_px": (
            _round(statistics.median(impact_errors)) if impact_errors else None
        ),
        "impact_window_max_px": _round(max(impact_errors)) if impact_errors else None,
    }


def _round(v, nd=2):
    return None if v is None else round(v, nd)


def _rate(k, n):
    return round(k / n, 4) if n else None


def _pctl(sorted_vals, q):
    if not sorted_vals:
        return None
    idx = min(len(sorted_vals) - 1, int(round(q * (len(sorted_vals) - 1))))
    return sorted_vals[idx]


def default_labels_root() -> Path:
    return Path(__file__).resolve().parents[3] / "fixtures" / "labels"


def evaluate_out_dir(out_dir: Path, labels_root: Path, *, variants: bool = False):
    """Evaluate one out/<stem>'s main club (and optionally every variant)."""
    label_path = labels_root / f"{out_dir.name}.club.json"
    if not label_path.exists():
        return None
    label_doc = gt_labels.load(label_path)
    with open(out_dir / "analysis.json", encoding="utf-8") as f:
        analysis = json.load(f)
    impact = (analysis.get("events") or {}).get("impact", {}).get("frame")
    video = analysis["video"]
    result = {"main": evaluate_clip(label_doc, analysis["club"], video, impact_frame=impact)}
    if variants:
        for name, var in sorted((analysis["club"].get("variants") or {}).items()):
            result[f"variant:{name}"] = evaluate_clip(label_doc, var, video, impact_frame=impact)
    return result


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("out_dirs", nargs="+", help="out/<stem> directories with analysis.json")
    ap.add_argument("--labels-root", default=None,
                    help="directory holding <stem>.club.json (default: fixtures/labels/)")
    ap.add_argument("--variants", action="store_true",
                    help="also score every club.variants entry against the same labels")
    ap.add_argument("--json", dest="json_out", default=None, help="write full report JSON here")
    args = ap.parse_args(argv)

    labels_root = Path(args.labels_root) if args.labels_root else default_labels_root()
    all_results, skipped = {}, []
    for out_dir in map(Path, args.out_dirs):
        res = evaluate_out_dir(out_dir, labels_root, variants=args.variants)
        if res is None:
            skipped.append(out_dir.name)
        else:
            all_results[out_dir.name] = res

    if args.json_out:
        with open(args.json_out, "w", encoding="utf-8") as f:
            json.dump({"clips": all_results, "skipped_no_labels": sorted(skipped)},
                      f, indent=2, sort_keys=True)
            f.write("\n")

    for stem, res in all_results.items():
        print(f"\n{stem}")
        rows = sorted(res.items(), key=lambda kv: (
            kv[1].get("head_center_median_px") is None,
            kv[1].get("head_center_median_px") or 0,
        ))
        for name, r in rows:
            if r.get("stale_labels"):
                print(f"  {name:32s} STALE LABELS ({r['label_fps']:g} fps vs {r['fps']:g})")
                continue
            print(f"  {name:32s} n={r['scored_frames']:3d}  "
                  f"median {r['head_center_median_px']} px  p95 {r['head_center_p95_px']} px  "
                  f"PCK@10 {r['pck_px']['10']}  P {r['visible_precision']}  "
                  f"R {r['visible_recall']}  gaps {r['gap_count']}  "
                  f"jumps {r['catastrophic_jumps']}")
    if skipped:
        print(f"\nno labels (skipped): {', '.join(sorted(skipped))}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
