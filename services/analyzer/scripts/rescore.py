"""Re-runs Stage 8 (scoring) over an already-analysed swing, rewriting `coach_report.json`.

Stage 8 is a pure function of `analysis.json` + `scoring_config/<version>.json` — it reads
`metrics.checkpoints` / `metrics.summary` / `metrics.glossary` / `tempo` and nothing else. So a
scoring-config change does NOT need the pose/club pipeline re-run, and re-running it anyway is
actively risky: CLAUDE.md's standing warning is that `burnin.py` without
`--club-detector runs/clubhead/weights/best.pt` silently regenerates the club trace on the
weaker classical-only path and overwrites the better one already on disk. That has happened.

This script is the safe path for the common case (edit bands -> see new scores). Reach for a
full `burnin.py` re-run only when `metrics.py` gains a field the config needs, because that
genuinely changes `analysis.json`.

Usage:
    .venv/Scripts/python.exe scripts/rescore.py                 # every out/<stem>/
    .venv/Scripts/python.exe scripts/rescore.py out/swing1      # one
    .venv/Scripts/python.exe scripts/rescore.py --config v1     # score against a pinned config
    .venv/Scripts/python.exe scripts/rescore.py --dry-run       # print, don't write

Club type is read back from the existing `coach_report.json` when there is one, because
`analysis.json` does not record it (it is a `burnin.py` CLI argument, not a measured property).
`--club-type` overrides. Nothing is inferred: an unknown club type stays unknown, and the
club-scoped checks skip themselves, which is the same behaviour as the original run.

Web note: this writes to disk only. A swing's score in Postgres comes from `db/scores.ts`'s
`syncSwingScore`, so run `pnpm db:backfill` from `apps/web` afterwards to pull the rewritten
reports into the `scores` table and the `swings` row's denormalized columns.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from swingsage import scoring  # noqa: E402


def rescore_one(out_dir: Path, config: dict, club_type: str | None,
                dry_run: bool = False) -> dict | None:
    analysis_path = out_dir / "analysis.json"
    if not analysis_path.exists():
        print(f"  {out_dir.name}: no analysis.json — skipped")
        return None
    analysis = json.loads(analysis_path.read_text(encoding="utf-8"))

    report_path = out_dir / "coach_report.json"
    if club_type is None and report_path.exists():
        # Carry the club type forward from the previous report rather than dropping it —
        # otherwise a rescore silently downgrades every club-scoped check to "club type not
        # recorded", which reads as a regression in coverage that did not happen.
        try:
            club_type = json.loads(report_path.read_text(encoding="utf-8")).get("club_type")
        except json.JSONDecodeError:
            club_type = None

    metrics = analysis["metrics"]
    view = analysis["video"]["view"]
    report = scoring.compute(config, metrics["checkpoints"], metrics["summary"],
                             metrics.get("glossary", {}), analysis.get("tempo") or {},
                             view, club_type)
    if not dry_run:
        report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    cov = report["coverage"]
    print(f"  {out_dir.name}: {report['overall']} ({report['band']})  "
          f"{cov['scored']}/{cov['total_checks']} scored, "
          f"{cov['skipped_this_swing']} skipped this swing, "
          f"{cov['deferred_in_config']} deferred in config  "
          f"[{view}, {club_type or 'club unknown'}, {report['scoring_model_version']}]")
    return report


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("dirs", nargs="*", type=Path,
                    help="out/<stem> directories; default is every out/*/ with an analysis.json")
    ap.add_argument("--config", default=None,
                    help="scoring_config/<version>.json (default: scoring.load_config()'s)")
    ap.add_argument("--club-type", choices=["driver", "irons"], default=None,
                    help="override; default carries the previous report's value forward")
    ap.add_argument("--dry-run", action="store_true", help="print scores, write nothing")
    args = ap.parse_args()

    config = scoring.load_config(args.config) if args.config else scoring.load_config()
    dirs = args.dirs or sorted(p for p in (ROOT / "out").glob("*")
                               if (p / "analysis.json").exists())
    if not dirs:
        raise SystemExit("no analysed swings found under out/ — run burnin.py first")

    print(f"rescoring {len(dirs)} swing(s) against scoring_config/{config['version']}.json"
          f"{'  (dry run)' if args.dry_run else ''}")
    for d in dirs:
        rescore_one(d, config, args.club_type, args.dry_run)


if __name__ == "__main__":
    main()
