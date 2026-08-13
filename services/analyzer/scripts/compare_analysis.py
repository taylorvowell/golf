"""Compare two analysis.json artifacts and report every substantive difference.

    python scripts/compare_analysis.py <before>/analysis.json <after>/analysis.json
        [--tol 0.0]

Built for refactor fidelity checks: two runs of the same clip on the same device should
produce the same artifact, so any difference the tolerance does not excuse is a behavior
change. `video.source.path` is excluded — the two runs legitimately read the same source
from different scratch locations only when the caller copies it, and the path is checked
by the pipeline itself. Everything else counts, including key order-independent structure,
None-ness, and array lengths.

Exit 0: no substantive differences. Exit 1: differences listed on stdout.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# Keys whose values may differ between two otherwise-identical runs.
VOLATILE = {
    ("video", "source", "path"),  # scratch location, not behavior
}

MAX_REPORT = 40


def walk(a, b, path=(), out=None, tol=0.0):
    if out is None:
        out = []
    if path in VOLATILE:
        return out
    if type(a) is not type(b) and not (isinstance(a, (int, float))
                                       and isinstance(b, (int, float))):
        out.append((path, f"type {type(a).__name__} != {type(b).__name__}"))
        return out
    if isinstance(a, dict):
        for k in sorted(set(a) | set(b)):
            if k not in a:
                out.append((path + (k,), "missing on the BEFORE side"))
            elif k not in b:
                out.append((path + (k,), "missing on the AFTER side"))
            else:
                walk(a[k], b[k], path + (k,), out, tol)
    elif isinstance(a, list):
        if len(a) != len(b):
            out.append((path, f"length {len(a)} != {len(b)}"))
        for i, (x, y) in enumerate(zip(a, b)):
            walk(x, y, path + (i,), out, tol)
    elif isinstance(a, bool) or isinstance(b, bool):
        if a is not b:
            out.append((path, f"{a!r} != {b!r}"))
    elif isinstance(a, (int, float)) and isinstance(b, (int, float)):
        if abs(a - b) > tol:
            out.append((path, f"{a!r} != {b!r} (delta {abs(a - b):.6g})"))
    elif a != b:
        out.append((path, f"{a!r} != {b!r}"))
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("before")
    ap.add_argument("after")
    ap.add_argument("--tol", type=float, default=0.0,
                    help="absolute tolerance for numeric leaves (default exact)")
    args = ap.parse_args()

    a = json.loads(Path(args.before).read_text(encoding="utf-8"))
    b = json.loads(Path(args.after).read_text(encoding="utf-8"))

    diffs = walk(a, b, tol=args.tol)
    if not diffs:
        print(f"IDENTICAL (tol {args.tol}) — {args.before} vs {args.after}")
        return 0
    print(f"{len(diffs)} difference(s) (tol {args.tol}):")
    for path, msg in diffs[:MAX_REPORT]:
        print("  " + ".".join(str(p) for p in path) + ": " + msg)
    if len(diffs) > MAX_REPORT:
        print(f"  ... and {len(diffs) - MAX_REPORT} more")
    return 1


if __name__ == "__main__":
    sys.exit(main())
