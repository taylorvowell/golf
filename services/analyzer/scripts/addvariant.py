"""Add a trace-only club variant to an already-analysed swing.

Trace-only variants differ from their base solve ONLY in how the polyline is rebuilt from
an identical set of head positions (see burnin.py's TRACE_MODES), so a new one does not
need the pipeline: reconstruct the base solve's `ClubResult` from the stored artifact,
re-run `club.smooth_trace` with the wanted mode, and patch the result in. Same
non-destructive contract as resegment/rescore/retiming — and critically it preserves the
`club_tracking` experiment block, which a burnin.py re-run would discard.

Default target is the combination the player wanted and no stored variant provided:
trajectory-gated head (`model_traj_raw`) + moving-average trace.

Usage:
    .venv/Scripts/python.exe scripts/addvariant.py                 # every out/<stem>/
    .venv/Scripts/python.exe scripts/addvariant.py out/swing1
    .venv/Scripts/python.exe scripts/addvariant.py --dry-run
    .venv/Scripts/python.exe scripts/addvariant.py --key model_traj_moving \
        --from model_traj_raw --mode moving --label "Trajectory-gated head + trace: moving average"
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import replace
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from swingsage import club  # noqa: E402

DEFAULT_KEY = "model_traj_moving"
DEFAULT_FROM = "model_traj_raw"
DEFAULT_MODE = "moving"
DEFAULT_LABEL = "Trajectory-gated head + trace: moving average"


def _result_from_variant(var: dict) -> club.ClubResult:
    """Rebuild the ClubResult smooth_trace needs from the artifact's stored frames."""
    frames = [
        club.ClubFrame(
            f=c["f"], shaft=c.get("shaft"), head=c.get("head"), butt=c.get("butt"),
            conf=c.get("conf", 0.0), interp=c.get("interp", False),
        )
        for c in var.get("frames") or []
    ]
    # `from_model` is what the trace modes gate on and it is stored per frame, so set it
    # explicitly rather than relying on the dataclass default.
    for fr, c in zip(frames, var.get("frames") or []):
        fr.from_model = c.get("from_model", False)
    return club.ClubResult(
        frames=frames,
        trace=dict(var.get("trace") or {}),
        trace_frames=dict(var.get("trace_frames") or {}),
        club_len=var.get("club_len", 0.0),
        butt_len=var.get("butt_len", 0.0),
    )


def add_one(out_dir: Path, key: str, base_key: str, mode: str, label: str,
            dry_run: bool = False) -> bool:
    p = out_dir / "analysis.json"
    if not p.exists():
        print(f"  {out_dir.name}: no analysis.json — skipped")
        return False
    doc = json.loads(p.read_text(encoding="utf-8"))
    variants = ((doc.get("club") or {}).get("variants") or {})
    if base_key not in variants:
        print(f"  {out_dir.name}: no '{base_key}' variant — skipped "
              "(needs a --club-detector run)")
        return False
    if not doc.get("events"):
        print(f"  {out_dir.name}: no events — skipped")
        return False

    base = variants[base_key]
    res = _result_from_variant(base)
    cfg = replace(club.ClubConfig(), trace_smooth=mode, trace_min_conf=0.0)
    club.smooth_trace(res, {"events": doc["events"]}, doc["video"]["frame_count"], cfg)

    pts = {k: len(v) for k, v in res.trace.items()}
    print(f"  {out_dir.name}: {key} <- {base_key} [{mode}]  trace pts "
          f"back {pts.get('backswing', 0)} / down {pts.get('downswing', 0)} / "
          f"through {pts.get('followthrough', 0)}")
    if dry_run:
        return True

    doc["club"]["variants"][key] = {
        "label": label,
        # Coverage and frames are the base solve's by construction — only `trace` differs.
        "coverage": base.get("coverage"),
        "club_len": base.get("club_len"),
        "butt_len": base.get("butt_len"),
        "notes": base.get("notes"),
        "frames": base["frames"],
        "trace": res.trace,
        "trace_frames": res.trace_frames,
    }
    tmp = out_dir / "analysis.json.tmp"
    tmp.write_text(json.dumps(doc), encoding="utf-8")
    os.replace(tmp, p)
    return True


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("dirs", nargs="*", type=Path)
    ap.add_argument("--key", default=DEFAULT_KEY)
    ap.add_argument("--from", dest="base", default=DEFAULT_FROM)
    ap.add_argument("--mode", default=DEFAULT_MODE,
                    help="trace_smooth mode: measured|moving|savgol|robust")
    ap.add_argument("--label", default=DEFAULT_LABEL)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    dirs = args.dirs or sorted(p for p in (ROOT / "out").glob("*")
                               if (p / "analysis.json").exists())
    if not dirs:
        raise SystemExit("no analysed swings under out/")
    print(f"adding '{args.key}' to {len(dirs)} swing(s)"
          f"{'  (dry run)' if args.dry_run else ''}")
    for d in dirs:
        add_one(d, args.key, args.base, args.mode, args.label, args.dry_run)


if __name__ == "__main__":
    main()
