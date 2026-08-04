"""Stage 5 — swing event detection (doc 05 Part A).

The 8 canonical GolfDB events: Address, Toe-Up, Mid-Backswing, Top, Mid-Downswing, Impact,
Mid-Follow-Through, Finish.

This is the club-independent implementation doc 05 asks for in Phase 3 — club tracking does
not exist yet, so every event resolves from pose alone, using the fallbacks the doc
specifies. Phase 4 refines Impact and Toe-Up once shaft data exists.

Each event carries a confidence derived from how cleanly its criterion resolved: a sharp,
unambiguous extremum scores high, a mushy one low. Ordering (A<TU<MB<T<MD<I<MFT<F) is
enforced at the end, and violations reduce confidence rather than being silently clamped.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .skeleton import IDX

EVENT_ORDER = ["address", "toe_up", "mid_backswing", "top",
               "mid_downswing", "impact", "mid_follow_through", "finish"]


@dataclass
class Signals:
    grip: np.ndarray      # (n,2) normalized, gap-filled
    grip_ok: np.ndarray   # (n,) bool — was this frame actually observed
    speed: np.ndarray     # (n,) grip speed, body-heights per frame
    lead_arm: np.ndarray  # (n,) lead shoulder->wrist angle, deg from horizontal
    body_h: float
    fps: float
    window: tuple = (0, 0)
    notes: list = field(default_factory=list)


def _series(frames, name, min_conf=0.3):
    xy = np.full((len(frames), 2), np.nan)
    for i, fr in enumerate(frames):
        p = fr["kp"][IDX[name]]
        if p[2] >= min_conf:
            xy[i] = (p[0], p[1])
    return xy


def _fill(a):
    """Linear-fill NaN gaps so downstream extrema are not broken by short dropouts."""
    out = a.copy()
    for ax in range(a.shape[1]):
        col = out[:, ax]
        ok = ~np.isnan(col)
        if ok.sum() < 2:
            continue
        idx = np.arange(len(col))
        col[~ok] = np.interp(idx[~ok], idx[ok], col[ok])
    return out


def _smooth(x, k=5):
    if len(x) < k:
        return x
    ker = np.ones(k) / k
    return np.convolve(np.pad(x, (k // 2, k // 2), mode="edge"), ker, mode="valid")[:len(x)]


def build_signals(frames, handedness="right", fps=60.0) -> Signals:
    n = len(frames)
    lead_w = "left_wrist" if handedness == "right" else "right_wrist"
    lead_s = "left_shoulder" if handedness == "right" else "right_shoulder"

    grip_raw = _series(frames, "grip_center")
    # grip_center can be absent where both wrists failed; fall back to either wrist so the
    # trace stays continuous — the events depend on shape, not on which hand supplied it.
    for alt in ("right_wrist", "left_wrist"):
        alt_xy = _series(frames, alt)
        miss = np.isnan(grip_raw[:, 0]) & ~np.isnan(alt_xy[:, 0])
        grip_raw[miss] = alt_xy[miss]
    grip_ok = ~np.isnan(grip_raw[:, 0])
    grip = _fill(grip_raw)

    # Scale: ankle-to-head, so thresholds are camera-distance independent (doc 03 §5).
    head = _fill(_series(frames, "head_center"))
    ank = _fill(_series(frames, "left_ankle"))
    ank2 = _fill(_series(frames, "right_ankle"))
    body_h = float(np.nanmedian(np.maximum(ank[:, 1], ank2[:, 1]) - head[:, 1]))
    if not np.isfinite(body_h) or body_h < 1e-3:
        body_h = 0.5

    d = np.gradient(grip, axis=0)
    speed = _smooth(np.linalg.norm(d, axis=1) / body_h, 5)

    sh = _fill(_series(frames, lead_s))
    wr = _fill(_series(frames, lead_w))
    v = wr - sh
    lead_arm = np.degrees(np.arctan2(-v[:, 1], np.abs(v[:, 0]) + 1e-9))

    return Signals(grip=grip, grip_ok=grip_ok, speed=speed, lead_arm=lead_arm,
                   body_h=body_h, fps=fps)


def swing_window(sg: Signals, frac=0.10):
    """Motion burst around the fastest hand movement (doc 05 A.1) — also the auto-trim span.

    Thresholding relative to the peak, not to a percentile of the whole clip: a percentile
    assumes a known ratio of moving to still frames, and these clips vary from a long static
    address to a held finish to the golfer wandering off. Peak-relative is scale-free.
    """
    n = len(sg.speed)

    # Anchor on sustained swing energy, not the single fastest frame. A golf swing keeps the
    # hands moving hard for well over a second; casually lowering the club or walking off
    # can momentarily beat it. On swing1 the bare argmax lands ~90 frames past Impact, in
    # exactly that kind of after-the-fact motion, and every event downstream follows it.
    win = max(3, int(round(1.4 * sg.fps)))
    ker = np.ones(win)
    energy = np.convolve(np.pad(sg.speed, (win // 2, win // 2), mode="constant"),
                         ker, mode="valid")[:n]
    centre = int(np.argmax(energy))
    lo = max(0, centre - win // 2)
    hi = min(n, centre + win // 2 + 1)
    peak = int(lo + np.argmax(sg.speed[lo:hi]))
    thr = max(sg.speed[peak] * frac, 1e-5)
    a = peak
    while a > 0 and sg.speed[a - 1] > thr:
        a -= 1
    b = peak
    while b < n - 1 and sg.speed[b + 1] > thr:
        b += 1
    return max(0, a - 10), min(n - 1, b + 10), peak


def _sharpness(x, i, half=6):
    """How decisively an extremum stands out from its surroundings -> confidence in [0,1]."""
    lo, hi = max(0, i - half), min(len(x), i + half + 1)
    seg = x[lo:hi]
    if len(seg) < 3:
        return 0.4
    spread = float(np.ptp(seg))
    rng = float(np.ptp(x)) + 1e-9
    return float(np.clip(spread / rng * 3.0, 0.35, 0.98))


def _cross(x, lo, hi, target, rising):
    """First index in [lo,hi) where x crosses `target` in the given direction."""
    for f in range(max(1, lo), min(len(x), hi)):
        a, b = x[f - 1], x[f]
        if rising and a < target <= b:
            return f
        if not rising and a > target >= b:
            return f
    return None


def detect(frames, handedness="right", fps=60.0):
    sg = build_signals(frames, handedness, fps)
    n = len(frames)
    a, b, peak = swing_window(sg)
    sg.window = (a, b)
    y = sg.grip[:, 1]
    ev = {}

    # --- Top: highest grip (min y) BEFORE the speed peak.
    # The peak of hand speed always falls in the downswing, i.e. between Top and Impact, so
    # anchoring there and searching backwards is what separates Top from the finish — the
    # hands are nearly as high at the finish (swing2: 0.513 vs 0.525), and a naive global
    # argmin over the clip picks whichever happens to win by a hair.
    lo = max(0, peak - int(2.0 * fps))
    top = int(lo + np.argmin(y[lo:peak + 1])) if peak > lo else int(peak)
    ev["top"] = (top, _sharpness(-y, top, 8))

    # --- Address: end of the last quasi-static span before the backswing starts.
    still = sg.speed < max(sg.speed[peak] * 0.04, 1e-6)
    addr, run, best = None, 0, 0
    for f in range(top):
        if still[f]:
            run += 1
            if run >= 8 and run >= best:
                best, addr = run, f
        else:
            run = 0
    if addr is None:
        addr = max(0, a)
    ev["address"] = (int(addr), 0.9 if best >= 15 else 0.6)

    addr_y = float(y[addr])

    # --- Impact: the lowest hand position after Top (doc 05 A.4's club-free fallback).
    #
    # Not "hands return to address height": on swing2 they never do — the grip bottoms out
    # at 0.627 against an address of 0.661 — so a crossing test finds nothing and whatever
    # it falls back to lands in the follow-through. The hand low point is a true extremum
    # and survives that. Bounded to one second after Top so the search cannot run on into
    # the golfer lowering the club afterwards, which goes lower still.
    horizon = min(n - 1, top + int(1.0 * fps))
    impact = int(top + np.argmax(y[top:horizon + 1])) if horizon > top else min(top + 1, n - 1)
    ev["impact"] = (impact, _sharpness(y, impact, 6))

    # --- Finish: motion decays after impact and the hands end high (doc 05 A.9).
    quiet = np.flatnonzero(sg.speed[impact:] < max(sg.speed[peak] * 0.06, 1e-6))
    finish = int(impact + quiet[0]) if len(quiet) else min(b, n - 1)
    finish = min(max(finish, impact + 5), n - 1)
    ev["finish"] = (finish, 0.75 if len(quiet) else 0.45)

    # --- Mid-Backswing / Mid-Downswing: lead arm parallel to the ground (doc 05 A.6/A.7).
    def arm_parallel(lo, hi, default):
        if hi <= lo:
            return default, 0.4
        seg = np.abs(sg.lead_arm[lo:hi])
        i = int(lo + np.argmin(seg))
        conf = float(np.clip(1.0 - seg[i - lo] / 45.0, 0.35, 0.95))
        return i, conf

    mb, mb_c = arm_parallel(addr + 1, top, (addr + top) // 2)
    ev["mid_backswing"] = (mb, mb_c)
    md, md_c = arm_parallel(top + 1, impact, (top + impact) // 2)
    ev["mid_downswing"] = (md, md_c)

    # --- Toe-Up: no shaft yet, so doc 05 A.5's fallback — lead wrist reaches trail-hip
    # height during the takeaway.
    trail_hip = "right_hip" if handedness == "right" else "left_hip"
    hip_y = _fill(_series(frames, trail_hip))[:, 1]
    tu = _cross(y, addr + 1, top, float(np.nanmedian(hip_y[addr:top + 1] if top > addr
                                                     else hip_y)), rising=False)
    # Toe-Up sits roughly a third of the way into the backswing. A hip-height crossing that
    # lands right on top of Address is the takeaway barely starting, not the shaft going
    # horizontal — reject it. Doc 05 flags this as club-dependent; Phase 4 replaces the
    # proxy with the real shaft-horizontal test.
    span = max(1, top - addr)
    if tu is None or not (addr + 0.15 * span <= tu <= addr + 0.6 * span):
        tu = int(addr + round(0.33 * span))
        tu_c = 0.4
    else:
        tu_c = 0.7
    ev["toe_up"] = (int(tu), tu_c)

    # --- Mid-Follow-Through: doc 05 A.8 fallback — wrists back at lead-hip height, rising.
    lead_hip = "left_hip" if handedness == "right" else "right_hip"
    lh_y = _fill(_series(frames, lead_hip))[:, 1]
    mft = _cross(y, impact + 1, finish + 1,
                 float(np.nanmedian(lh_y[impact:finish + 1])) if finish > impact
                 else float(np.nanmedian(lh_y)), rising=False)
    if mft is None:
        mft = int((impact + finish) // 2)
        mft_c = 0.4
    else:
        mft_c = 0.7
    ev["mid_follow_through"] = (int(mft), mft_c)

    # --- Ordering constraint (doc 05 A): violations lower confidence, they are not hidden.
    out, prev = {}, -1
    for name in EVENT_ORDER:
        f, c = ev[name]
        f = int(np.clip(f, 0, n - 1))
        if f <= prev:
            f = min(n - 1, prev + 1)
            c = min(c, 0.35)
            sg.notes.append(f"{name} violated ordering; nudged to {f}")
        out[name] = {"frame": f, "conf": round(float(c), 2)}
        prev = f

    phases = []
    for i in range(len(EVENT_ORDER) - 1):
        s, e = EVENT_ORDER[i], EVENT_ORDER[i + 1]
        phases.append({"name": f"{s}->{e}", "from": out[s]["frame"], "to": out[e]["frame"]})

    tempo = None
    bs = out["top"]["frame"] - out["address"]["frame"]
    ds = out["impact"]["frame"] - out["top"]["frame"]
    if ds > 0:
        tempo = {"backswing_frames": bs, "downswing_frames": ds,
                 "ratio": round(bs / ds, 2),
                 "backswing_ms": round(bs / fps * 1000), "downswing_ms": round(ds / fps * 1000)}

    return {"events": out, "phases": phases, "swing_window": [int(a), int(b)],
            "tempo": tempo, "notes": sg.notes}, sg
