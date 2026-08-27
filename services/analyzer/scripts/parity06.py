"""Artifact parity for the shared-decode restructure (track step 06).

Runs each fixture twice — once against a git worktree pinned to the pre-refactor commit, once
against the working tree — and diffs the two `analysis.json` files with
`compare_analysis.py`. The refactor's whole claim is that it moved no numbers, and that claim
is only worth what a side-by-side over real footage says.

    python scripts/parity06.py --base /tmp/golf-base --out /tmp/p06 [--fixtures a,b]
                               [--variants on|off|both] [--stage before|after|compare|all]

`--stage` exists because the two halves are long: `before` can run against the pinned worktree
while the working tree is still being edited, and `compare` re-diffs already-produced runs
without burning another two hours of GPU.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ANALYZER = HERE.parent
REPO = ANALYZER.parent.parent
PY = str(ANALYZER / ".venv" / "Scripts" / "python.exe")
WEIGHTS = "runs/clubhead/weights/best.pt"

ALL_FIXTURES = ["6iron-1", "6iron2", "6iron3", "7wood-1", "7wood-2",
                "perfect", "pro_2", "pro_3", "swing1", "swing2"]


def run_one(analyzer_dir: Path, stem: str, out_dir: Path, variants: bool) -> dict:
    """One burn-in. Always passes --club-detector: omitting it silently regenerates the trace
    on the weaker classical path, which would make the comparison meaningless."""
    src = REPO / "fixtures" / f"{stem}.mp4"
    cmd = [PY, "scripts/burnin.py", str(src),
           "--club-detector", WEIGHTS,
           "--club-variants" if variants else "--no-club-variants",
           "--out", str(out_dir)]
    t = time.time()
    p = subprocess.run(cmd, cwd=str(analyzer_dir), capture_output=True, text=True)
    dt = time.time() - t
    ok = p.returncode == 0 and (out_dir / "analysis.json").exists()
    tail = (p.stdout or "").strip().splitlines()[-4:]
    return {"ok": ok, "seconds": round(dt, 1), "rc": p.returncode,
            "tail": tail, "stderr": (p.stderr or "")[-600:] if not ok else ""}


def compare(before: Path, after: Path, tol: float) -> tuple[bool, str]:
    p = subprocess.run(
        [PY, "scripts/compare_analysis.py",
         str(before / "analysis.json"), str(after / "analysis.json"), "--tol", str(tol)],
        cwd=str(ANALYZER), capture_output=True, text=True)
    return p.returncode == 0, (p.stdout or "") + (p.stderr or "")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="/tmp/golf-base",
                    help="git worktree checked out at the pre-refactor commit")
    ap.add_argument("--out", default="/tmp/p06")
    ap.add_argument("--fixtures", default=",".join(ALL_FIXTURES))
    ap.add_argument("--variants", choices=["on", "off", "both"], default="on")
    ap.add_argument("--stage", choices=["before", "after", "compare", "all"], default="all")
    ap.add_argument("--tol", type=float, default=1e-6)
    args = ap.parse_args()

    base_dir = Path(args.base) / "services" / "analyzer"
    out_root = Path(args.out)
    stems = [s for s in args.fixtures.split(",") if s]
    modes = ["on", "off"] if args.variants == "both" else [args.variants]

    report: dict = {"runs": {}, "compare": {}}
    report_path = out_root / "parity06.json"
    out_root.mkdir(parents=True, exist_ok=True)
    if report_path.exists():
        report = json.loads(report_path.read_text())
        report.setdefault("runs", {})
        report.setdefault("compare", {})

    def save():
        report_path.write_text(json.dumps(report, indent=2))

    failures = 0
    for mode in modes:
        variants = mode == "on"
        for stem in stems:
            key = f"{stem}:{mode}"
            for side, adir in (("before", base_dir), ("after", ANALYZER)):
                if args.stage not in ("all", side):
                    continue
                d = out_root / side / mode / stem
                print(f"[{side:6}] {key} ...", flush=True)
                r = run_one(adir, stem, d, variants)
                report["runs"][f"{side}:{key}"] = r
                save()
                print(f"[{side:6}] {key} {'ok' if r['ok'] else 'FAILED'} "
                      f"({r['seconds']}s)", flush=True)
                if not r["ok"]:
                    print(r["stderr"], flush=True)

            if args.stage in ("all", "compare"):
                b, a = out_root / "before" / mode / stem, out_root / "after" / mode / stem
                if not (b / "analysis.json").exists() or not (a / "analysis.json").exists():
                    report["compare"][key] = {"identical": None, "note": "missing artifact"}
                    failures += 1
                    save()
                    continue
                same, text = compare(b, a, args.tol)
                report["compare"][key] = {"identical": same, "diff": text[:4000]}
                failures += 0 if same else 1
                save()
                print(f"[compare] {key} {'IDENTICAL' if same else 'DIFFERS'}", flush=True)
                if not same:
                    print(text[:2000], flush=True)

    print(f"\n{len(report['compare'])} comparisons, {failures} not identical")
    print(f"report: {report_path}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
