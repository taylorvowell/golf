"""Does the angle the player DRAWS equal the angle the analyzer MEASURED?

    python scripts/checkangles.py out/<stem> [--field NAME] [--tol 0.25]

`metrics.angle_fields[].geom` tells the player where each angle lives — which keypoints, and
which reference direction — and `metrics.series[f][field]` is the number it labels the arc
with. Those are two independent descriptions of one measurement, and nothing forces them to
agree. When they disagree the overlay is confidently wrong: an arc drawn on the right joint,
labelled with a number that is not the angle shown.

This replays the player's geometry resolution (the same rules as
`apps/web/src/lib/angleOverlay.ts`) over every frame of a stored analysis and compares the
angle that geometry subtends against the published value. It found one real inversion the
first time it ran — `wrist_deviation` keeps a 180-means-straight convention, so marking it a
supplement drew its complement on all 247 measurable frames.

It also found that confidence had to be TRUNCATED rather than rounded when the artifact is
written: a keypoint stored at exactly 0.35 had been below the gate before rounding, so the
player included a foot in its stack reference that the metric itself had dropped — 2 deg of
disagreement from a decimal place (see burnin.py's kp writer).

The allowance per frame is the floor below plus the angle that coordinate rounding is worth
on the *shorter* of the two rays, because an edge-on hip line two pixels wide cannot be held
to the same tolerance as a spine line six hundred pixels long.

Run it after touching `_angle_geometry`, after adding an angle, and after any change to how
the player resolves points.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

# Floor on the allowance. This check exists to catch geometry that is *attached wrong* —
# inverted, on the wrong joint, measured from the wrong reference — and those miss by tens or
# hundreds of degrees (the wrist_deviation inversion it found was 179.97 deg out). It is not
# trying to certify agreement to a hundredth of a degree, which the overlay could not show
# anyway: the label carries one decimal and the arc is a few dozen pixels across. A quarter
# degree still catches a real defect by three orders of magnitude.
DEFAULT_TOL = 0.25
# The published value carries one decimal, so it is up to 0.05 deg from what was measured.
VALUE_ROUNDING = 0.05
MIN_CONF = 0.35   # metrics.MIN_CONF — below it the analyzer treated the point as missing
REF = {"vertical": (0.0, -1.0), "plumb": (0.0, 1.0), "horizontal": (1.0, 0.0)}


def _kp(fr, idx, name):
    i = idx.get(name)
    if i is None:
        return None
    p = fr["kp"][i]
    return (p[0], p[1]) if p[2] >= MIN_CONF else None


def _resolve(expr, fr, idx, ser, head):
    """The point-expression forms metrics._angle_geometry emits."""
    if isinstance(expr, str):
        return _kp(fr, idx, expr)
    if "club" in expr:
        return tuple(head) if head else None
    if "feet" in expr:
        pts = []
        for side in ("left", "right"):
            h = _kp(fr, idx, f"{side}_heel")
            t = _kp(fr, idx, f"{side}_foot_index")
            if h and t:
                pts.append((h[0] + expr["feet"] * (t[0] - h[0]),
                            h[1] + expr["feet"] * (t[1] - h[1])))
        if not pts:
            return None
        return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))
    named = ser.get(expr["src"]) if expr.get("src") else None
    if isinstance(named, str) and _kp(fr, idx, named):
        return _kp(fr, idx, named)
    for name in expr["chain"]:
        p = _kp(fr, idx, name)
        if p:
            return p
    return None


def _rays(geom, fr, idx, ser, head):
    """(u, v) in normalised coords, or None where an input point is missing."""
    def R(e):
        return _resolve(e, fr, idx, ser, head) if e is not None else None

    def sub(a, b):
        return (a[0] - b[0], a[1] - b[1])

    if geom["kind"] == "interior":
        o, a, b = R(geom["vertex"]), R(geom["a"]), R(geom["b"])
        if not (o and a and b):
            return None
        return (sub(o, a) if geom.get("supplement") else sub(a, o)), sub(b, o)
    if geom["kind"] == "vectors":
        o = R(geom["at"])
        u0, u1 = R(geom["u"][0]), R(geom["u"][1])
        v0, v1 = R(geom["v"][0]), R(geom["v"][1])
        if not (o and u0 and u1 and v0 and v1):
            return None
        return sub(u1, u0), sub(v1, v0)
    o, to = R(geom["from"]), R(geom["to"])
    if not (o and to):
        return None
    return sub(to, o), REF[geom["kind"]]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("out_dir", help="an analyzer output folder, e.g. out/swing1")
    ap.add_argument("--field", default=None, help="check one field only")
    ap.add_argument("--tol", type=float, default=DEFAULT_TOL, help="degrees")
    args = ap.parse_args()

    path = Path(args.out_dir) / "analysis.json"
    if not path.exists():
        print(f"no analysis.json in {args.out_dir}")
        return 1
    a = json.loads(path.read_text(encoding="utf-8"))
    fields = (a.get("metrics") or {}).get("angle_fields")
    if not fields:
        print("no metrics.angle_fields — re-run burnin.py on this clip")
        return 1

    idx = {n: i for i, n in enumerate(a["pose"]["keypoint_names"])}
    W, H = a["video"]["width"], a["video"]["height"]
    club = (a.get("club") or {}).get("frames")
    series = a["metrics"]["series"]

    # Canvas space is (x*W, y*H); the analyzer measures in (x*W/H, y). Those differ by a
    # uniform factor of H, and uniform scales preserve angles — which is the whole reason the
    # player can draw an aspect-corrected angle without correcting anything itself. Comparing
    # in canvas space is therefore the real test, not a convenience.
    def ang(u, v):
        d = (math.degrees(math.atan2(u[1] * H, u[0] * W) - math.atan2(v[1] * H, v[0] * W)))
        return abs((d + 180) % 360 - 180)

    # Coordinates are stored to 5 decimals, so each endpoint carries up to +-0.5e-5 of
    # normalised error. On a long ray that is nothing; on a short one it is an angle. The hip
    # line seen down the line projects to about TWO PIXELS on swing2, where the same rounding
    # is worth half a degree — so a fixed tolerance would either miss real errors on long rays
    # or cry wolf on short ones. Scale it by the ray that actually limits the angle.
    def allowance(u, v, dashed_v):
        lu = math.hypot(u[0] * W, u[1] * H)
        # A reference direction (vertical/plumb/horizontal) is exact — it has no endpoints to
        # round — so only the measured ray contributes.
        lv = math.inf if dashed_v else math.hypot(v[0] * W, v[1] * H)
        shortest = min(lu, lv)
        if shortest < 1e-6:
            return math.inf
        # Two endpoints, each free to move up to half a unit in the last stored decimal in
        # both axes: 1e-5 * hypot(W, H) pixels of relative displacement, worst case.
        return VALUE_ROUNDING + math.degrees(1e-5 * math.hypot(W, H) / shortest)

    checked = failed = undrawable = 0
    rows = []
    for spec in fields:
        if args.field and spec["field"] != args.field:
            continue
        geom = spec["geom"]
        if not geom:
            undrawable += 1
            continue
        checked += 1
        dashed_v = geom["kind"] in REF
        # Tracked by headroom (err - allowed), not by raw error, so the frame reported is the
        # worst-conditioned one rather than merely the one with the biggest number. Seeded
        # below any real value so the first measurable frame always wins.
        worst, worst_bound, worst_f, headroom = 0.0, 0.0, None, -math.inf
        n = bad = 0
        for f, (fr, ser) in enumerate(zip(a["pose"]["frames"], series)):
            val = ser.get(spec["field"])
            if not isinstance(val, (int, float)):
                continue
            head = (club[f] or {}).get("head") if club and f < len(club) else None
            r = _rays(geom, fr, idx, ser, head)
            if r is None:
                continue
            # Magnitude only: several fields are signed (from-vertical, tilt) and the sign is
            # a direction the arc cannot carry. The label shows it; the arc shows how big.
            err = abs(ang(*r) - abs(val))
            allow = max(args.tol, allowance(r[0], r[1], dashed_v))
            n += 1
            if err > allow:
                bad += 1
            if err - allow > headroom:
                headroom, worst, worst_bound, worst_f = err - allow, err, allow, f
        ok = n > 0 and bad == 0
        if not ok:
            failed += 1
        rows.append((spec["field"], geom["kind"], n, worst, worst_bound, worst_f, bad, ok))

    print(f"{'field':<34}{'kind':<11}{'frames':>7}{'max err':>9}{'allowed':>9}  {'at':>6}")
    for field, kind, n, worst, bound, wf, bad, ok in rows:
        if n == 0:
            print(f"{field:<34}{kind:<11}{0:>7}{'':>18}          no drawable frame")
            continue
        mark = "" if ok else f"   <-- MISMATCH on {bad} frame(s)"
        b = "  inf" if bound == math.inf else f"{bound:>9.3f}"
        print(f"{field:<34}{kind:<11}{n:>7}{worst:>9.3f}{b}  f{wf:<5}{mark}")

    print(f"\n{checked} drawable fields checked, {failed} mismatched; {undrawable} field(s) "
          f"have no geometry (rotation estimates — expected).")
    print(f"Allowance per frame = max({args.tol} deg floor, {VALUE_ROUNDING} for the published "
          f"value's own\nrounding + what 5-decimal coordinate rounding is worth on the shorter "
          f"ray). An\nedge-on hip line two pixels wide cannot be held to the tolerance of a "
          f"spine line\nsix hundred pixels long.")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
