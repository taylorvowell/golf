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
    # Trail shoulder->wrist, same convention. The backswing checkpoints are defined by the
    # LEAD arm reaching horizontal and the follow-through ones by the TRAIL arm (P9), which
    # is the mirror image of P3 — so both arms are needed, not just the lead.
    trail_arm: np.ndarray = None
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

    def arm_angle(shoulder, wrist):
        """Shoulder->wrist elevation, deg from horizontal; 0 = arm parallel to the ground.

        `abs` on the x component folds the two horizontal directions together, so the signal
        is "how far off horizontal" regardless of which way the arm points — which is what
        every arm-parallel checkpoint tests.
        """
        v = _fill(_series(frames, wrist)) - _fill(_series(frames, shoulder))
        return np.degrees(np.arctan2(-v[:, 1], np.abs(v[:, 0]) + 1e-9))

    trail_w = "right_wrist" if handedness == "right" else "left_wrist"
    trail_s = "right_shoulder" if handedness == "right" else "left_shoulder"

    return Signals(grip=grip, grip_ok=grip_ok, speed=speed,
                   lead_arm=arm_angle(lead_s, lead_w),
                   trail_arm=arm_angle(trail_s, trail_w),
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


def _settle(speed, start, thr, hold):
    """First index at or after `start` where speed stays under `thr` for `hold` frames.

    Sustained, not instantaneous, and that is the whole point. The hands slow almost to a stop
    at the top of the follow-through arc before the golfer settles into the finish, so a
    first-crossing test stops there: on swing2 the first frame under threshold is f148 but the
    golfer is not actually still until f167, nineteen frames later. Returns None when the clip
    never contains a rest — someone who walks straight out of frame never settles.
    """
    n = len(speed)
    run = 0
    for i in range(max(0, start), n):
        if speed[i] < thr:
            run += 1
            if run >= hold:
                return i - hold + 1
        else:
            run = 0
    return None


def playback_window(sg, out, peak, fps, n, lead_s=1.0, tail_s=1.0):
    """The part of the clip worth playing: the approach, the swing, and the held finish.

    Distinct from `swing_window` above, which is a motion burst around the speed peak and is
    used to gate Stage 3's grip prior. That one is far too tight to play — on swing1 it is
    frames 195-250, which starts most of the way down the downswing, because the backswing
    never reaches 10% of the downswing's hand speed.

    Anchored on the events at the front and on *stillness* at the back:

    * **Start** is one second before the Address event. Address is the end of the LAST
      quasi-static hold at setup height, so a second before it is the last second of the
      setup — the approach. It is only that tight because Address takes the last hold rather
      than the longest one; the longest is usually an early settle and cost 0.8s of dead air.
    * **End** is one second after the golfer comes to rest, which is not the same frame as the
      Finish event. Finish is defined as the moment motion decays (doc 05 A.9) and fires as
      soon as the hands slow; arriving at the finish position and holding it happens later.
      `_settle` finds the holding, and the window can only ever be wider than the event, never
      narrower.

    Deliberately not clamped to where motion *ends*: on both fixtures the last frame above
    threshold is near the end of the clip (f395 of 396, f321 of 341) because the golfer lowers
    the club and walks off. That trailing motion is exactly what this is trimming away.
    """
    lead = int(round(lead_s * fps))
    tail = int(round(tail_s * fps))
    addr = out["address"]["frame"]
    fin = out["finish"]["frame"]

    thr = max(float(sg.speed[peak]) * 0.06, 1e-6)
    hold = max(4, int(round(0.30 * fps)))
    settled = _settle(sg.speed, fin, thr, hold)
    if settled is None:
        sg.notes.append("no settled finish found; playback window ends at the finish event")

    a = max(0, addr - lead)
    b = min(n - 1, max(fin, settled if settled is not None else fin) + tail)
    # The window must contain the swing whatever the anchors did, and must not invert on a
    # clip too short to hold one.
    a = min(a, addr)
    b = max(b, min(n - 1, fin))
    if b <= a:
        a, b = 0, n - 1
    return [int(a), int(b)]


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

    # --- Address: end of the LAST quasi-static hold at setup height before the backswing.
    #
    # Not the *longest* such hold, which is what this used to take. A golfer settles, waggles,
    # re-settles and only then takes it away, so the longest hold is usually an early one:
    # swing1's longest is frames 48-102, but two more follow it (110-131, 140-150). Choosing
    # the long one put Address 48 frames early and reported a 1600ms backswing against a real
    # 800ms — and because `playback_window` anchors its start on Address, it also left 0.8s of
    # dead air at the front of the trimmed clip.
    #
    # The height gate is what makes "last" safe. The hands also go quiet at the top of the
    # backswing — swing2 holds still at 83-86, right at Top — and a bare last-hold rule would
    # call that Address and report a 0ms backswing. Setup holds sit at the bottom of the
    # pre-Top vertical range and the transition pause sits at the very top of it, so a quarter
    # of that range separates the two with room to spare.
    still = sg.speed < max(sg.speed[peak] * 0.04, 1e-6)
    y_low = float(np.max(y[:top + 1]))    # hands at their lowest  -> setup
    y_high = float(np.min(y[:top + 1]))   # hands at their highest -> Top
    setup_gate = y_low - 0.25 * max(y_low - y_high, 1e-6)

    holds, run_start = [], None
    for f in range(top + 1):
        if still[f]:
            run_start = f if run_start is None else run_start
        elif run_start is not None:
            holds.append((run_start, f - 1))
            run_start = None
    if run_start is not None:
        holds.append((run_start, top))
    # A hold has to last long enough to be a stance rather than one slow frame, and has to end
    # with the hands still down at setup height.
    holds = [(s, e) for s, e in holds if e - s + 1 >= 8 and y[e] >= setup_gate]

    if holds:
        span_start, addr = holds[-1]
        best = addr - span_start + 1
    else:
        span_start = addr = max(0, a)
        best = 0
        sg.notes.append("no still hold at setup height before Top; address fell back to the "
                        "motion-window start")
    ev["address"] = (int(addr), 0.9 if best >= 15 else 0.6)

    # The hold that *ended* at `addr`, exported so setup measurements can average over the
    # whole stance instead of sampling one frame of it.
    address_span = [int(span_start), int(addr)]

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
        # Real swings cluster hard around 3:1 with a backswing near 0.8s, which makes tempo a
        # free check on our own event detection rather than only a coaching number: a figure
        # this far out is likelier to be a misplaced Address or Top than a golfer who actually
        # swings that way. It caught the address bug above — 4.17:1 on swing1.
        #
        # Flagged, never corrected. A deliberate rehearsal swing genuinely reads slow (swing2
        # is 1.55:1 and its impact frame is confirmed by the club-head low point), so moving
        # events to satisfy this prior would be fitting the data to the expectation.
        odd = []
        if not 0.45 <= bs / fps <= 1.30:
            odd.append(f"backswing {tempo['backswing_ms']}ms outside 450-1300ms")
        if not 0.15 <= ds / fps <= 0.40:
            odd.append(f"downswing {tempo['downswing_ms']}ms outside 150-400ms")
        if not 1.8 <= tempo["ratio"] <= 4.2:
            odd.append(f"ratio {tempo['ratio']}:1 outside 1.8-4.2:1")
        tempo["implausible"] = odd or None
        for o in odd:
            sg.notes.append(f"tempo implausible ({o}) — check address/top/impact")

    # Clip the still span to the (possibly nudged) address frame so it can never run past it.
    address_span = [min(address_span[0], out["address"]["frame"]), out["address"]["frame"]]

    # Computed from the ORDERED events, not from the raw ones above, so the window can never
    # disagree with the frames the player draws its phase bar from.
    play = playback_window(sg, out, peak, fps, n)

    return {"events": out, "phases": phases, "swing_window": [int(a), int(b)],
            "playback_window": play,
            "address_span": address_span, "tempo": tempo, "notes": sg.notes}, sg
