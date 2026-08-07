"""Is the drawn club-head trace where the club actually was? (doc 04 §5, §7)

    python scripts/checktrace.py out/<stem> [--variant model_traj_measured] [--all]

Coverage percentages have overstated club quality three separate times (STATUS.md §2), and
smoothness is not evidence of correctness (D20). This reports the four things about the
*polyline* that a coverage number cannot:

  reach        how close the line gets to the ball. The club head at Address IS the ball
               (doc 04 §3), so the distance from it to the nearest point of each segment says
               whether the trace makes it down to the strike. Cutting the point list at the
               event frames left the downswing 102px short of the ball on `perfect`, because
               Impact is the frame the phase is named for, not a frame the club was measured on.
  bridges      spans where nothing was measured and the line is a straight chord between two
               real points. Reported with the chord length, because a 200px chord through the
               takeaway is a fabricated path and a 12px one is a rounding detail. The player
               dashes these; they are listed here so they cannot hide.
  fidelity     does the line pass through the heads it was built from, or near their average.
  growth       how far the frame-indexed playhead mapping differs from the point-count guess a
               renderer would make without `trace_frames`. This is the lag that made the drawn
               tip trail the club; it stays here as a regression guard.

Everything is measured in analysis-video pixels and as a percentage of the golfer's height,
so numbers are comparable between clips shot at different distances.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

SEGMENTS = ("backswing", "downswing", "followthrough")

# A frame step larger than this counts as a bridge: a stretch of the polyline with no
# measurement behind it. Not 1, because Stage 0 normalises to 60fps CFR and a 30fps source
# therefore repeats every frame — two measurements on *consecutive source frames* can land 1, 2
# or 3 frames apart depending on which copy of each pair the detector answered on. 4 is the
# first step that means a source frame was genuinely missed. Must match SwingStage.tsx.
BRIDGE_STEP = 3


def load(out: Path):
    d = json.loads((out / "analysis.json").read_text(encoding="utf-8"))
    pose, ev = d["pose"], d["events"]
    names = pose["keypoint_names"]
    hi, ai = names.index("head_center"), names.index("left_ankle")
    W = d["video"]["analysis_res"]["width"]
    H = d["video"]["analysis_res"]["height"]
    hc = sorted(f["kp"][hi][1] for f in pose["frames"] if f["kp"][hi][2] > 0.2)
    ak = sorted(f["kp"][ai][1] for f in pose["frames"] if f["kp"][ai][2] > 0.2)
    med = lambda v: v[len(v) // 2] if v else 0.0
    body = max((med(ak) - med(hc)) * H, 1.0)
    return d, ev, W, H, body


def solution(d, variant):
    c = d.get("club")
    if not c:
        return None
    if variant in (None, "primary"):
        return c
    v = (c.get("variants") or {}).get(variant)
    return {**c, **v} if v else None


def report(out: Path, variant: str | None) -> int:
    d, ev, W, H, body = load(out)
    c = solution(d, variant)
    if not c:
        print(f"{out.name}: no club solution '{variant}'")
        return 1
    dist = lambda p, q: math.hypot((p[0] - q[0]) * W, (p[1] - q[1]) * H)
    pct = lambda px: f"{100 * px / body:.1f}%"

    trace = c.get("trace") or {}
    tframes = c.get("trace_frames") or {}
    heads = {f["f"]: f["head"] for f in (c.get("frames") or []) if f.get("head")}
    # Where the ball is, by the same rule `club.anchor_ball` uses — `club.ball` when the search
    # found it, otherwise the club head medianed over the Address hold (doc 04 §3). Taking a
    # different definition here would make this report a number the pipeline is not aiming at.
    found = c.get("ball")
    if found:
        ball = [found["x"], found["y"]]
    else:
        span = d.get("address_span") or [ev["address"]["frame"]] * 2
        hs = [heads[f] for f in range(span[0], span[1] + 1) if f in heads]
        ball = ([sorted(p[0] for p in hs)[len(hs) // 2], sorted(p[1] for p in hs)[len(hs) // 2]]
                if hs else heads.get(ev["address"]["frame"]))
    spans = {"backswing": (ev["address"]["frame"], ev["top"]["frame"]),
             "downswing": (ev["top"]["frame"], ev["impact"]["frame"]),
             "followthrough": (ev["impact"]["frame"], ev["finish"]["frame"])}

    anchored = [f["f"] for f in (c.get("frames") or []) if f.get("from_ball")]
    # Say where the reference point came from. `reach` is only a statement about the trace when
    # the ball is actually known; against the Address-hold estimate it is partly a statement
    # about that estimate, which on `perfect` is 150px from the real ball (D44).
    src = found.get("source") if found else "estimated from the Address hold - UNVERIFIED (D44)"
    print(f"{out.name}  variant={variant or 'primary'}  body={body:.0f}px"
          + (f"  ball-anchored at frame {anchored[0]}" if anchored else ""))
    print(f"  ball {ball} [{src}]")
    if not tframes:
        print("  ! no trace_frames in this artifact; re-run burnin.py to publish it. "
              "Without it the player can only guess the playhead mapping by point count.")
    worst_growth = 0
    for key in SEGMENTS:
        pts = trace.get(key) or []
        fs = tframes.get(key) or []
        if len(pts) < 2:
            print(f"  {key:14s} empty")
            continue
        a, b = spans[key]
        near = min((dist(p, ball) for p in pts), default=float("nan")) if ball else float("nan")
        bridges = [(fs[i], fs[i + 1], dist(pts[i], pts[i + 1]))
                   for i in range(len(fs) - 1) if fs[i + 1] - fs[i] > BRIDGE_STEP] if fs else []
        drawn = sum(1 for f in range(a, b + 1) if f in set(fs))
        print(f"  {key:14s} {len(pts):4d} pts  frames {fs[0] if fs else '?'}"
              f"..{fs[-1] if fs else '?'} (event span {a}..{b}, {drawn} measured)"
              f"  reach {near:6.1f}px {pct(near)}")
        for f0, f1, chord in sorted(bridges, key=lambda x: -x[2])[:6]:
            print(f"      bridge {f0:4d}->{f1:<4d} {f1 - f0:3d}f  chord {chord:6.1f}px {pct(chord)}")
        if len(bridges) > 6:
            print(f"      ... and {len(bridges) - 6} shorter bridges")

        # Fidelity: does the drawn line pass through the heads it was built from?
        tol = 0.008 * H
        hit = 0
        for f in fs:
            h = heads.get(f)
            if h and min(dist(h, p) for p in pts) <= tol:
                hit += 1
        print(f"      fidelity {hit}/{len(fs)} points within {tol:.0f}px of their own head")

        # What a renderer that guessed by point count would have shown instead.
        if fs:
            for f in range(a, b + 1):
                guess = round(min(1, max(0, (f - a) / max(1, b - a))) * len(pts))
                real = sum(1 for x in fs if x <= f)
                if guess and real:
                    worst_growth = max(worst_growth, abs(fs[min(guess, len(fs)) - 1] - f))
    if tframes:
        print(f"  growth: point-count guess would put the drawn tip up to {worst_growth} frames "
              f"from the playhead; frame-indexed growth puts it at 0")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("out_dir")
    ap.add_argument("--variant", default=None,
                    help="club variant key, or 'primary'. Default: the one the player picks.")
    ap.add_argument("--all", action="store_true", help="every stored variant")
    args = ap.parse_args()
    out = Path(args.out_dir).resolve()
    d = json.loads((out / "analysis.json").read_text(encoding="utf-8"))
    variants = list(((d.get("club") or {}).get("variants") or {}))
    if args.all:
        keys = ["primary"] + variants
    elif args.variant:
        keys = [args.variant]
    else:
        keys = ["model_traj_measured" if "model_traj_measured" in variants else "primary"]
    rc = 0
    for k in keys:
        rc |= report(out, k)
        print()
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
