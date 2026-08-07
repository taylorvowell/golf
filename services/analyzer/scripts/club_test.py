"""Run one club-tracking test over an analysed swing and merge its result (plan §9, §25).

The analyzer half of the debug menu's test switch: load the swing's context, run the
registered tracker, fit all ten path variants over address->impact, merge the experiment
block into analysis.json atomically. Cached results are never recomputed here — the caller
(player/API) checks for an existing experiment first (plan §28).

Usage:
    .venv/Scripts/python.exe scripts/club_test.py --list
    .venv/Scripts/python.exe scripts/club_test.py out/<stem> --test t6_grip_kinematic
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from swingsage.club_tracking import (ClubTrackingContext, TEST_IDS,  # noqa: E402
                                     available, get_test)
from swingsage.club_tracking.experiment_store import (build_experiment,  # noqa: E402
                                                      merge_experiment)
from swingsage.club_tracking.pathfit import fit_variants  # noqa: E402


def list_tests() -> int:
    impl = set(available())
    for tid, label in TEST_IDS.items():
        mark = "x" if tid in impl else " "
        print(f"  [{mark}] {tid:28s} {label}")
    print(f"{len(impl)}/{len(TEST_IDS)} implemented")
    return 0


def run(out_dir: Path, test_id: str) -> int:
    try:
        test = get_test(test_id)
    except KeyError as e:
        print(e.args[0])
        return 2
    except NotImplementedError as e:
        print(str(e))
        return 2

    ctx = ClubTrackingContext.load(out_dir)
    if "address" not in ctx.events or "impact" not in ctx.events:
        print(f"{out_dir.name}: artifact lacks address/impact events")
        return 1

    t0 = time.time()
    result = test.run(ctx)
    frame_range = (ctx.events["address"], ctx.events["impact"])
    variants = fit_variants(result.observations, ctx.fps, frame_range,
                            top_frame=ctx.events.get("top"))
    exp = build_experiment(result, ctx, variants)
    merge_experiment(out_dir, exp)

    d = exp["diagnostics"]
    print(f"{out_dir.name}: {test_id} -> {d['observation_count']} observations "
          f"({d['observed_fraction']:.0%} observed), display={exp['trace']['display_mode']}, "
          f"{len(variants)} variants, {time.time() - t0:.1f}s")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("out_dir", nargs="?", type=Path)
    ap.add_argument("--test", choices=list(TEST_IDS), metavar="TEST_ID",
                    help=f"one of: {', '.join(TEST_IDS)}")
    ap.add_argument("--list", action="store_true", help="show the test catalogue")
    args = ap.parse_args()

    if args.list:
        return list_tests()
    if not args.out_dir or not args.test:
        ap.error("out_dir and --test required (or --list)")
    return run(args.out_dir.resolve(), args.test)


if __name__ == "__main__":
    raise SystemExit(main())
