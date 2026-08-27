"""Does the sum of the named stages actually account for the job?

The acceptance oracle for stage telemetry: run the real pipeline over a real clip, collect the
spans it emits, and report what fraction of measured wall time landed in a NAMED stage. Step
05's bar is >=95%; the risk it guards against is a stage nobody wrapped (before this step,
`probe`, `checkpoints`, `silhouette` and `contract` were emitted but never timed, and
`contract` alone covers ~200 lines of artifact writing).

    python scripts/checkattribution.py ../../fixtures/6iron2.mp4
    python scripts/checkattribution.py <video> --club-detector runs/clubhead/weights/best.pt

Prints the per-stage table and exits non-zero if attribution is below the bar, so it can gate
a change rather than merely describe one.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from swingsage import stages  # noqa: E402
from swingsage.pipeline import AnalysisRequest, run  # noqa: E402

BAR_PCT = 95.0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("video")
    ap.add_argument("--out", default=None)
    ap.add_argument("--view", default="dtl", choices=["dtl", "face_on"])
    ap.add_argument("--handedness", default="right", choices=["right", "left"])
    ap.add_argument("--club-detector", default=None)
    ap.add_argument("--no-variants", action="store_true",
                    help="production shape — variants is a development-only stage")
    ap.add_argument("--bar", type=float, default=BAR_PCT)
    args = ap.parse_args(argv)

    acc = stages.StageAccumulator()
    src = Path(args.video).resolve()
    out = Path(args.out).resolve() if args.out else Path("out") / f"{src.stem}-attribution"

    req = AnalysisRequest(
        video=str(src), out_dir=str(out), view=args.view, handedness=args.handedness,
        club_detector=args.club_detector, club_variants=not args.no_variants,
    )
    t0 = time.time()
    result = run(req, on_event=acc.on_event)
    wall = time.time() - t0

    rec = acc.record(wall, pipelineElapsedS=round(result.elapsed_s, 3),
                     decodePasses=result.decode_passes,
                     memHighWaterMb=result.mem_high_water_mb)
    print(f"\nwall {rec['totalS']}s   attributed {rec['attributedS']}s   "
          f"unattributed {rec['unattributedS']}s   ->  {rec['attributedPct']}%\n")
    for s in rec["stages"]:
        share = 100.0 * s["seconds"] / rec["totalS"] if rec["totalS"] else 0.0
        tag = "  (nested)" if s.get("nested") else ""
        print(f"  {stages.label(s['stage']):18s} {s['seconds']:8.2f}s  {share:5.1f}%{tag}")
    print(f"\n  {rec['decodePasses']} decode passes of analysis.mp4 - "
          f"{rec['memHighWaterMb']:.0f} MB peak frame planes")
    if rec.get("unknownStages"):
        print(f"\n  UNNAMED stages emitted: {rec['unknownStages']}")

    pct = rec["attributedPct"] or 0.0
    if pct < args.bar:
        print(f"\nFAIL: {pct}% attributed, below the {args.bar}% bar. "
              "An unwrapped stage is the usual cause.")
        return 1
    print(f"\nPASS: {pct}% of wall time is in named stages (bar {args.bar}%).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
