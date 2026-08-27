"""Golden-set manifest, evaluation report, and the machine-readable diff gate.

The manifest (groundtruth/goldenset.json, committed) is the authority on which
clips exist, which tier each belongs to (golden / dev / holdout), and who the
golfer is - the split rule (by golfer and source recording, never adjacent
frames) is enforced by construction here. Labels live beside the footage under
fixtures/labels/ (gitignored like the footage); the report stamps their hashes
so label drift is visible.

Commands (run from services/analyzer):
  python -m groundtruth.goldenset report            evaluate stored out/<stem>
                                                    artifacts for every golden
                                                    clip -> reports/latest.json
  python -m groundtruth.goldenset diff              latest vs accepted: what
                                                    changed, and FAIL (exit 1)
                                                    on any hard-gate regression
  python -m groundtruth.goldenset accept            promote latest -> accepted

The report evaluates STORED artifacts (frozen outputs) - re-running the
analyzer is hardware-bound and stays a deliberate, separate act (burnin.py
with --club-detector). The report is byte-stable for identical inputs: sorted
keys, no wall-clock, versions read from the artifacts themselves.

Hard gates (plan 08 SS15), reported absolutely and RATCHETED by diff - a gate
count may never exceed the accepted baseline, and the baseline target is zero:
  frame_identity_mismatch   stale labels (fps mismatch) or labels addressing
                            frames outside the artifact
  propagated_as_direct      club frames flagged interp/from_ball carrying
                            conf >= 0.3 (the pipeline stamps propagated frames
                            0.2; anything higher misrepresents a guess)
  high_conf_catastrophic_impact  impact misses > CATASTROPHIC_MS with event
                            conf >= HIGH_CONFIDENCE
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from pathlib import Path

from . import evaluate_club, evaluate_events
from . import labels as gt_labels

ROOT = Path(__file__).parent
MANIFEST_PATH = ROOT / "goldenset.json"
REPORTS_DIR = ROOT / "reports"
LATEST = REPORTS_DIR / "latest.json"
ACCEPTED = REPORTS_DIR / "accepted.json"

PROPAGATED_DIRECT_CONF = 0.3

HARD_GATES = (
    "frame_identity_mismatch",
    "propagated_as_direct",
    "high_conf_catastrophic_impact",
)


def load_manifest() -> dict:
    with open(MANIFEST_PATH, encoding="utf-8") as f:
        return json.load(f)


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build_report(*, out_root: Path | None = None,
                 labels_root: Path | None = None) -> dict:
    manifest = load_manifest()
    out_root = out_root or ROOT.parent / "out"
    labels_root = labels_root or evaluate_events.default_labels_root()

    clips = {}
    gates = {g: 0 for g in HARD_GATES}
    event_reports = []
    for entry in manifest["clips"]:
        if entry["tier"] != "golden":
            continue
        stem = entry["stem"]
        out_dir = out_root / stem
        clip_report: dict = {"tier": entry["tier"]}
        analysis_path = out_dir / "analysis.json"
        if not analysis_path.exists():
            clip_report["status"] = "no_artifact"
            clips[stem] = clip_report
            continue
        with open(analysis_path, encoding="utf-8") as f:
            analysis = json.load(f)
        clip_report["schema_version"] = analysis.get("schema_version")
        clip_report["scoring_model_version"] = (
            (analysis.get("metrics") or {}).get("scoring_model_version")
            or analysis.get("scoring_model_version")
        )
        frame_count = analysis["video"]["frame_count"]

        # Events
        ev_label = labels_root / f"{stem}.events.json"
        if ev_label.exists():
            doc = gt_labels.load(ev_label)
            rep = evaluate_events.evaluate_swing(
                doc, evaluate_events.predictions_from_analysis(analysis))
            clip_report["labels"] = {"events": _sha256(ev_label)}
            if rep["stale_labels"]:
                gates["frame_identity_mismatch"] += 1
                clip_report["events"] = {"stale_labels": True,
                                         "label_fps": rep["label_fps"]}
            else:
                out_of_range = [
                    r["labeled_frame"] for r in rep["events"].values()
                    if r["labeled_frame"] is not None and r["labeled_frame"] >= frame_count
                ]
                if out_of_range:
                    gates["frame_identity_mismatch"] += 1
                gates["high_conf_catastrophic_impact"] += sum(
                    1 for name, r in rep["events"].items()
                    if name == "impact" and r.get("high_confidence_catastrophic")
                )
                clip_report["events"] = rep["events"]
                event_reports.append(rep)
        else:
            clip_report["events"] = "no_labels"

        # Club: the hard gate runs from the artifact alone; metrics need labels.
        prop_as_direct = sum(
            1 for fr in analysis["club"]["frames"]
            if (fr.get("interp") or fr.get("from_ball"))
            and fr.get("conf", 0) >= PROPAGATED_DIRECT_CONF
        )
        gates["propagated_as_direct"] += prop_as_direct
        clip_report["propagated_as_direct"] = prop_as_direct
        club_label = labels_root / f"{stem}.club.json"
        if club_label.exists():
            club_res = evaluate_club.evaluate_out_dir(out_dir, labels_root)
            clip_report.setdefault("labels", {})["club"] = _sha256(club_label)
            main_rep = club_res["main"]
            if main_rep.get("stale_labels"):
                gates["frame_identity_mismatch"] += 1
            clip_report["club"] = main_rep
        else:
            clip_report["club"] = "no_labels"
        clips[stem] = clip_report

    return {
        "schema": "goldenset-report",
        "schema_version": 1,
        "manifest_version": manifest["schema_version"],
        "gate_definitions": {
            "propagated_direct_conf": PROPAGATED_DIRECT_CONF,
            "catastrophic_ms": evaluate_events.CATASTROPHIC_MS,
            "high_confidence": evaluate_events.HIGH_CONFIDENCE,
        },
        "hard_gates": gates,
        "aggregate_events": evaluate_events.aggregate(event_reports),
        "clips": clips,
    }


def write_report(report: dict, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, sort_keys=True)
        f.write("\n")


def diff_reports(accepted: dict, latest: dict) -> dict:
    """Machine-readable diff. failures non-empty = the run must fail."""
    failures = []
    for gate in HARD_GATES:
        base = accepted["hard_gates"].get(gate, 0)
        now = latest["hard_gates"].get(gate, 0)
        if now > base:
            failures.append({
                "gate": gate, "accepted": base, "latest": now,
                "reason": "hard gate regressed (ratchet: latest may never exceed accepted; target is 0)",
            })
    changed = {}
    for stem in sorted(set(accepted["clips"]) | set(latest["clips"])):
        a, b = accepted["clips"].get(stem), latest["clips"].get(stem)
        if a != b:
            changed[stem] = {"accepted": a, "latest": b}
    return {
        "hard_gate_failures": failures,
        "hard_gates": {"accepted": accepted["hard_gates"], "latest": latest["hard_gates"]},
        "changed_clips": sorted(changed),
        "changed_detail": changed,
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("command", choices=["report", "diff", "accept"])
    ap.add_argument("--labels-root", default=None)
    ap.add_argument("--out-root", default=None)
    args = ap.parse_args(argv)

    if args.command == "report":
        report = build_report(
            out_root=Path(args.out_root) if args.out_root else None,
            labels_root=Path(args.labels_root) if args.labels_root else None,
        )
        write_report(report, LATEST)
        print(f"wrote {LATEST}")
        print("hard gates:", json.dumps(report["hard_gates"]))
        return 0

    if args.command == "diff":
        if not LATEST.exists():
            print("no latest report - run `report` first")
            return 2
        if not ACCEPTED.exists():
            print("no accepted baseline - run `accept` to establish one")
            return 2
        with open(ACCEPTED, encoding="utf-8") as f:
            accepted = json.load(f)
        with open(LATEST, encoding="utf-8") as f:
            latest = json.load(f)
        d = diff_reports(accepted, latest)
        print(json.dumps({k: d[k] for k in ("hard_gate_failures", "hard_gates", "changed_clips")},
                         indent=2, sort_keys=True))
        return 1 if d["hard_gate_failures"] else 0

    if args.command == "accept":
        if not LATEST.exists():
            print("no latest report - run `report` first")
            return 2
        shutil.copyfile(LATEST, ACCEPTED)
        print(f"accepted {LATEST} -> {ACCEPTED}")
        return 0
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
