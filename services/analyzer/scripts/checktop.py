"""Where is the top of the backswing, really? (the scoring spec)

    python scripts/checktop.py out/<stem> [out/<stem> ...]

`detect()` places Top at the hands' highest point before the hand-speed peak. That is a
*hand* landmark, and the phase boundary a coach means is a *club* one — the club keeps working
at the top after the hands have stopped rising and started down. Since `events` segments the
trace, an early Top makes the drawn line turn downswing-coloured while the club is still going
back, which is how this gets noticed.

This lays out every signal that could define Top, side by side, with the tempo each would imply.
It deliberately does not pick a winner: on the current fixtures the club-based candidates
disagree with each other by more than the transition is long, and on half of them the detector
has nothing near the top at all. Read the coverage line first — where it is low, every club
column below it is noise.

What would settle it is hand-labelled truth, which the project has never had
(`tests/fixtures.json:hand_labeled` is null). The player's head-marker editor writes
exactly that.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

#: Typical tour backswing:downswing. Not a threshold — context for the tempo column.
TYPICAL_TEMPO = 3.0


def smooth(x, k=7):
    if len(x) < k:
        return x
    pad = np.pad(x, (k // 2, k // 2), mode="edge")
    return np.convolve(pad, np.ones(k) / k, mode="valid")[:len(x)]


def report(out: Path) -> None:
    d = json.loads((out / "analysis.json").read_text(encoding="utf-8"))
    ev, pose, v = d["events"], d["pose"], d["video"]
    c = d.get("club")
    W, H = v["analysis_res"]["width"], v["analysis_res"]["height"]
    fps = v["fps"] or 60.0
    n = len(pose["frames"])
    addr, top, imp = ev["address"]["frame"], ev["top"]["frame"], ev["impact"]["frame"]
    gi = pose["keypoint_names"].index("grip_center")

    tempo = lambda f: (f - addr) / max(1, imp - f)
    line = lambda lbl, f, extra="": print(
        f"    {lbl:34s} f{f:<5} {f - top:+4d}   tempo {tempo(f):5.2f}:1  {extra}")

    print(f"\n=== {out.name}   address {addr}   top {top}   impact {imp}")
    print(f"    backswing {(top - addr) / fps * 1000:.0f}ms   "
          f"downswing {(imp - top) / fps * 1000:.0f}ms   "
          f"tempo {tempo(top):.2f}:1  (typical {TYPICAL_TEMPO:.0f}:1)")

    # --- hand signals: what Stage 5 can see, and what it currently uses ------------------
    g = np.array([[f["kp"][gi][0] * W, f["kp"][gi][1] * H, f["kp"][gi][2]] for f in pose["frames"]])
    ok = g[:, 2] > 0.3
    idx = np.arange(n)
    gx = smooth(np.interp(idx, idx[ok], g[ok, 0]))
    gy = smooth(np.interp(idx, idx[ok], g[ok, 1]))
    spd = np.hypot(np.gradient(gx), np.gradient(gy))
    lo, hi = max(addr, 0), min(imp, n - 1)

    print("  hands (what detect() uses):")
    hh = lo + int(np.argmin(gy[lo:hi + 1]))
    line("highest", hh)
    w0, w1 = hh, min(n - 1, hh + int(0.6 * (imp - hh)) + 1)
    line("slowest after the height peak", w0 + int(np.argmin(spd[w0:w1 + 1])) if w1 > w0 else hh)
    back = np.array([gx[hh] - gx[addr], gy[hh] - gy[addr]])
    if np.linalg.norm(back) > 1e-6:
        u = back / np.linalg.norm(back)
        proj = (gx - gx[addr]) * u[0] + (gy - gy[addr]) * u[1]
        line("travel along the backswing reverses", lo + int(np.argmax(proj[lo:hi + 1])))

    # --- club signals: only meaningful where the club was actually measured -------------
    if not c:
        print("  club: not tracked on this swing")
        return
    var = "model_traj_measured" if "model_traj_measured" in (c.get("variants") or {}) else None
    fr = {f["f"]: f for f in (c["variants"][var]["frames"] if var else c["frames"])}
    meas = [f for f in range(addr, imp + 1)
            if fr.get(f) and fr[f].get("head") and fr[f].get("from_model") and not fr[f]["interp"]]
    near = [f for f in meas if abs(f - top) <= 12]
    print(f"  club ({len(meas)}/{imp - addr + 1} of the swing measured, "
          f"{len(near)} within 12 frames of Top):")
    if len(near) < 6:
        print("    ! too few measured frames at the top - the club cannot answer this here.")
        print("      This is the usual case: the club is slow and behind the golfer at the top,")
        print("      which is exactly where the detector is weakest.")
        return

    sp = d.get("address_span") or [addr, addr]
    hs = [fr[f]["head"] for f in range(sp[0], sp[1] + 1) if fr.get(f) and fr[f].get("head")]
    ball = np.array([np.median([p[0] for p in hs]), np.median([p[1] for p in hs])]) * [W, H]
    head = lambda f: np.array(fr[f]["head"]) * [W, H]

    line("head furthest from the ball", max(meas, key=lambda f: np.linalg.norm(head(f) - ball)))
    dist = {f: float(np.linalg.norm(head(f) - ball)) for f in meas}
    fs = sorted(dist)
    down = fs[0]
    for i in range(len(fs) - 1, 0, -1):
        if dist[fs[i]] > dist[fs[i - 1]]:
            down = fs[i]
            break
    line("head starts down for good", down)
    line("head highest", min(meas, key=lambda f: head(f)[1]))

    # Shaft sweep. If the total swept angle across the transition is far below 180 deg the
    # solver was not tracking the shaft through it, and its turning point means nothing.
    ang = {}
    for f in meas:
        s = fr[f].get("shaft")
        if not s:
            continue
        (bx, by), (hx, hy) = s
        ang[f] = np.arctan2((hy - by) * H, (hx - bx) * W)
    afs = sorted(ang)
    if len(afs) >= 8:
        un = np.degrees(np.unwrap([ang[f] for f in afs]))
        swept = float(un.max() - un.min())
        note = "" if swept > 120 else f"(only {swept:.0f} deg swept — shaft not tracked here)"
        pre = [i for i, f in enumerate(afs) if f <= top]
        sign = np.sign(un[max(pre)] - un[0]) if pre else 1.0
        line("shaft sweep turns", afs[int(np.argmax(sign * un))], note)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("out_dirs", nargs="+")
    args = ap.parse_args()
    for o in args.out_dirs:
        report(Path(o).resolve())
    print("\nNo column here is ground truth. Where the club columns disagree with each other by")
    print("more than the transition is long, they are measuring the detector, not the swing.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
