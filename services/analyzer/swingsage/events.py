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


#: How far the speed-based Impact may sit from the hand-height landmark before the landmark
#: wins. The two normally agree within a frame or two; a gap this large means one is wrong,
#: and it is the speed-based one that slow motion breaks. Set well above the 1-11 frame
#: spread seen across the working fixtures so those are never re-decided.
LANDMARK_DISAGREE = 20

#: A peak must be reversed by this fraction of the hand-height range to count as the top —
#: enough to ignore the wobble at the top of the backswing without missing the top itself.
LANDMARK_PROMINENCE = 0.25


def _first_extremum(h, start, prom, direction):
    """First extremum at/after `start` that is then reversed by `prom`.

    `direction` 1 finds a peak, -1 a trough. Returning the *first* prominent one rather than
    the global extremum is the whole point: the hands are usually higher at the finish than at
    the top, so a global max finds the wrong landmark entirely.
    """
    best, bv = start, direction * h[start]
    for f in range(start, len(h)):
        v = direction * h[f]
        if v > bv:
            bv, best = v, f
        elif bv - v > prom:
            return best
    return best


def _hand_landmarks(frames, addr):
    """(top, impact, finish) from hand height above the hips, or None if untrackable.

    Independent of speed and frame rate — see the call site for why that matters.
    """
    gi, hp = IDX["grip_center"], IDX["mid_hip"]
    raw = np.full(len(frames), np.nan)
    for i, fr in enumerate(frames):
        g, h = fr["kp"][gi], fr["kp"][hp]
        if g[2] >= 0.35 and h[2] >= 0.35:
            raw[i] = h[1] - g[1]
    if np.isnan(raw).sum() > len(raw) * 0.6 or np.count_nonzero(~np.isnan(raw)) < 20:
        return None

    filled = _fill(raw.reshape(-1, 1))[:, 0]
    if np.isnan(filled).any():
        return None
    # Light smoothing so single-frame jitter cannot create a peak.
    sm = filled.copy()
    if len(filled) >= 5:
        sm[2:-2] = np.convolve(filled, np.ones(5) / 5, mode="valid")

    if addr >= len(sm) - 4:
        return None
    prom = (float(sm[addr:].max()) - float(sm[addr])) * LANDMARK_PROMINENCE
    if not prom > 0:
        return None

    top = _first_extremum(sm, addr, prom, 1)
    imp = _first_extremum(sm, top, prom, -1)
    fin = _first_extremum(sm, imp, prom, 1)
    return (top, imp, fin) if addr < top < imp < fin else None


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


def build_tempo(out, fps):
    """`(tempo, implausible_reasons)` from the three events it is made of.

    A function rather than inline, because `club.refine_events` can move Impact after this has
    already been computed (D50) and a tempo left over from the pre-refinement frames is worse
    than none: it is the number the scorecard reads and the one the implausibility check fires
    on, so a stale one both misreports the swing and mis-blames the detector.
    """
    bs = out["top"]["frame"] - out["address"]["frame"]
    ds = out["impact"]["frame"] - out["top"]["frame"]
    if ds <= 0:
        return None, []
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
    return tempo, odd


def playback_window(sg, out, peak, fps, n, lead_s=1.0, tail_s=1.0):
    """The part of the clip worth playing: the approach, the swing, and the held finish.

    Distinct from `swing_window` above, which is a motion burst around the speed peak and is
    used to gate Stage 3's grip prior. That one is far too tight to play — on swing1 it is
    frames 195-250, which starts most of the way down the downswing, because the backswing
    never reaches 10% of the downswing's hand speed.

    **Exactly one second of approach and exactly one second of finish, on every swing.** Both
    ends are pinned to events — `address - 1s` and `finish + 1s` — so the lead-in and the run-out
    are the same length on every clip. That is what makes two swings comparable side by side: a
    window whose ends move with the golfer means the same playhead position is a different part
    of the swing in each pane.

    This deliberately replaces an earlier, cleverer back end. It used to search for the golfer
    coming to *rest* (`_settle`) and end a second after that, because the Finish event fires when
    hand motion decays (doc 05 A.9), a few tenths before the golfer has actually arrived at the
    finish and held it — so on `perfect` the window ran to 2.1s past Finish. That is more
    faithful to one swing and worse across several, and consistency is what the comparison view
    needs. `_settle` is still used by nothing else; it stays for the note it can still emit.

    Returns `([a, b], [pad_before, pad_after])`. A short clip cannot supply its second: swing2's
    Address is at frame 41 and needs 60. Rather than silently showing a shorter approach there —
    which would put the same inconsistency back by another route — the shortfall is reported so
    the player can hold a freeze frame for it, keeping every approach one second whatever the
    footage gives.
    """
    lead = int(round(lead_s * fps))
    tail = int(round(tail_s * fps))
    addr = out["address"]["frame"]
    fin = out["finish"]["frame"]

    thr = max(float(sg.speed[peak]) * 0.06, 1e-6)
    hold = max(4, int(round(0.30 * fps)))
    settled = _settle(sg.speed, fin, thr, hold)
    if settled is not None and settled > fin + tail:
        sg.notes.append(
            f"golfer settles at frame {settled}, {(settled - fin) / fps:.1f}s after the finish "
            f"event; the playback window still ends 1.0s after Finish so every clip runs out "
            f"for the same length")

    want_a, want_b = addr - lead, fin + tail
    a, b = max(0, want_a), min(n - 1, want_b)
    # The window must contain the swing whatever the anchors did, and must not invert on a clip
    # too short to hold one.
    a = min(a, addr)
    b = max(b, min(n - 1, fin))
    if b <= a:
        a, b = 0, n - 1
        return [int(a), int(b)], [0, 0]
    # What the clip could not supply, for the player to hold as a freeze frame.
    pad = [max(0, a - want_a), max(0, want_b - b)]
    return [int(a), int(b)], [int(pad[0]), int(pad[1])]


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

    # --- Cross-check the post-top events against a speed-independent estimator ------------
    #
    # Everything above keys off grip *speed* and motion energy, which assumes a real-time
    # swing. Slow-motion footage breaks that assumption badly: on the bundled pro reference the
    # motion-burst window collapsed onto the downswing alone and Impact landed at f474 against
    # a true ~f530, which then truncated the club trace and every phase span downstream.
    #
    # Hand HEIGHT above the hips has no such dependence — the top is its first prominent peak
    # after Address, Impact the trough after that, the Finish the next peak. Those are
    # geometric extrema of one well-tracked signal, so they read the same whatever the frame
    # rate. Measured against the current detector: swing1 agrees exactly (198/221), swing2
    # within a frame (86/114 vs 86/115), and the pro clip's Impact is recovered at f533.
    #
    # It only OVERRIDES on a large disagreement. The two estimators normally agree within a
    # frame or two, and there are still no hand-labelled event frames for any clip
    # (docs/STATUS.md) — so quietly re-deciding events that are already plausible would be
    # fitting to a sample we cannot check. A gap this size means one of them is simply wrong.
    lm = _hand_landmarks(frames, addr)
    if lm is not None:
        lm_top, lm_imp, lm_fin = lm
        if abs(lm_imp - impact) > LANDMARK_DISAGREE:
            sg.notes.append(
                f"impact {impact} disagreed with the hand-height landmark {lm_imp} by "
                f"{abs(lm_imp - impact)} frames (speed-based detection is unreliable on "
                f"slow-motion footage); post-top events re-anchored on the landmarks")

            impact, finish = lm_imp, lm_fin
            ev["impact"] = (impact, 0.6)
            ev["finish"] = (finish, 0.6)
            if abs(lm_top - top) > LANDMARK_DISAGREE:
                top = lm_top
                ev["top"] = (top, 0.6)

            # The two derived events are re-interpolated, NOT carried over proportionally.
            # Their original positions were solved against the wrong Impact, so the fraction
            # they sat at is wrong too — preserving it just carries the error forward at a new
            # scale. Measured on the pro clip: the old mid-downswing sat at 98% of a span that
            # ended 59 frames early, which re-scaled to 2 frames before the corrected Impact.
            #
            # These fractions are the canonical positions doc 05 A describes (lead arm parallel
            # coming down; shaft parallel through), and sit inside the spread the two working
            # fixtures show. Confidence is dropped to say plainly that they are interpolated
            # rather than detected.
            ev["mid_downswing"] = (int(top + round(0.60 * (impact - top))), 0.4)
            ev["mid_follow_through"] = (int(impact + round(0.35 * (finish - impact))), 0.4)

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
    tempo, odd = build_tempo(out, fps)
    for o in odd:
        sg.notes.append(f"tempo implausible ({o}) — check address/top/impact")

    # Clip the still span to the (possibly nudged) address frame so it can never run past it.
    address_span = [min(address_span[0], out["address"]["frame"]), out["address"]["frame"]]

    # Computed from the ORDERED events, not from the raw ones above, so the window can never
    # disagree with the frames the player draws its phase bar from.
    play, play_pad = playback_window(sg, out, peak, fps, n)

    return {"events": out, "phases": phases, "swing_window": [int(a), int(b)],
            "playback_window": play,
            # Frames of approach/run-out the clip could not supply, for the player to freeze.
            "playback_pad": play_pad,
            "address_span": address_span, "tempo": tempo, "notes": sg.notes}, sg
