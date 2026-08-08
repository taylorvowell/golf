"""Stage 5b — the ten swing checkpoints (the P-system, P1–P10).

The scoring spec's Part A detects the eight canonical GolfDB events, and those stay exactly as they are:
`analysis.json.events` is a published contract keyed to a labelled dataset, and nothing here
touches it. But coaches do not talk in eight positions, they talk in ten — the P-system —
and the ten are the eight events plus two positions GolfDB does not label:

    P1   Address                             -> events.address
    P2   Shaft parallel, takeaway            -> events.toe_up
    P3   Lead arm parallel, backswing        -> events.mid_backswing
    P4   Top of backswing                    -> events.top
    P5   Lead arm parallel, downswing        -> events.mid_downswing
    P6   Shaft parallel, downswing           -> detected here          (new)
    P7   Impact                              -> events.impact
    P8   Shaft parallel, follow-through      -> events.mid_follow_through
    P9   Trail arm parallel, follow-through  -> detected here          (new)
    P10  Finish                              -> events.finish

Note the symmetry, because it is what makes the two new positions detectable rather than
invented: P2/P8 are the shaft horizontal either side of the ball, P3/P5 are the lead arm
horizontal either side of the top, and P6/P9 close the pattern — the shaft horizontal coming
down, and the trail arm horizontal going up. Each has a real geometric criterion.

Both new positions follow Stage 5's two-tier policy: use the true criterion where the data
supports it, fall back to a stated pose proxy where it does not, and let the confidence say
which one answered. `basis` names it in words so a low number is diagnosable rather than
merely low.

Build this AFTER `club.refine_events` — P2 and P8 are only shaft-defined once club data
exists, and P6 needs the shaft directly.
"""
from __future__ import annotations

import numpy as np

from .events import _cross, _fill, _series

# (p, id, label, event, phase, definition). `event` is the canonical Stage 5 event this
# position is the same frame as, or None where the position is detected here.
#
# The ids are the names a golfer uses for the position, not the GolfDB event names: the
# backswing has a bottom / middle / top, the downswing a top and a middle, and the
# follow-through a middle and a top. `event` keeps the mapping back to the eight explicit.
CHECKPOINTS = [
    ("P1", "address", "Address", "address", "setup",
     "Setup. Static angles here are the median of the whole address hold, not one frame."),
    ("P2", "backswing_bottom", "Backswing — bottom", "toe_up", "backswing",
     "Club shaft parallel to the ground in the takeaway."),
    ("P3", "backswing_middle", "Backswing — middle", "mid_backswing", "backswing",
     "Lead arm parallel to the ground in the backswing."),
    ("P4", "backswing_top", "Backswing — top", "top", "backswing",
     "Top of the backswing: highest grip before the change of direction."),
    ("P5", "downswing_top", "Downswing — top", "mid_downswing", "downswing",
     "Lead arm parallel to the ground on the way down."),
    ("P6", "downswing_middle", "Downswing — middle", None, "downswing",
     "Club shaft parallel to the ground on the way down — the delivery position."),
    ("P7", "impact", "Impact", "impact", "impact",
     "Impact."),
    ("P8", "follow_through_middle", "Follow-through — middle", "mid_follow_through",
     "follow_through", "Club shaft parallel to the ground after impact."),
    ("P9", "follow_through_top", "Follow-through — top", None, "follow_through",
     "Trail arm parallel to the ground in the follow-through — the mirror of P3."),
    ("P10", "finish", "Finish", "finish", "finish",
     "Finish: motion has decayed and the hands are high."),
]


def _wrap180(a):
    """Shaft angle folded onto -90..90 — a shaft is a line, so 170 deg IS 10 deg off."""
    return (a + 90.0) % 180.0 - 90.0


def _shaft_horizontal(club, lo, hi, tol=18.0):
    """Frame in (lo, hi) where the tracked shaft is closest to horizontal, or None.

    Same criterion and tolerance as `club.refine_events`, so P2/P6/P8 are all decided by one
    rule rather than three that drift apart. Needs at least three confident frames in the
    span: one lucky frame near horizontal inside a badly tracked stretch is not evidence.
    """
    if club is None:
        return None
    cands = [(abs(_wrap180(c.angle)), c.f) for c in club.frames
             if c.angle is not None and c.conf >= 0.35 and lo < c.f < hi]
    if len(cands) < 3:
        return None
    off, f = min(cands)
    return int(f) if off <= tol else None


def _p6(ev, sg, frames, handedness, club):
    """P6 — shaft parallel to the ground in the downswing (delivery)."""
    e = ev["events"]
    md, imp = e["mid_downswing"]["frame"], e["impact"]["frame"]

    # Searched from P5 rather than from the top, and that bound is load-bearing: a golfer who
    # overswings has the shaft horizontal AT the top too, so a search opened at P4 would
    # return P4 and collapse the two positions onto one frame. At P5 the club still points
    # well above horizontal for any swing, so the first crossing after it is the real one.
    f = _shaft_horizontal(club, md, imp)
    if f is not None:
        return f, 0.8, "shaft horizontal (tracked)"

    # Proxy: at delivery the hands are about trail-hip height, coming down. This is the exact
    # mirror of Stage 5's Toe-Up proxy, and inherits its weakness — hand height is a stand-in
    # for shaft angle, and the two part company for a golfer with unusual lag.
    trail_hip = "right_hip" if handedness == "right" else "left_hip"
    hip_y = _fill(_series(frames, trail_hip))[:, 1]
    ref = hip_y[md:imp + 1] if imp > md else hip_y
    y = sg.grip[:, 1]
    f = _cross(y, md + 1, imp, float(np.nanmedian(ref)), rising=True)
    if f is not None and md < f < imp:
        return int(f), 0.5, "proxy: grip descends past trail-hip height"

    return int(round((md + imp) / 2)), 0.3, "proxy: midpoint of P5 -> impact"


def _p9(ev, sg):
    """P9 — trail arm parallel to the ground in the follow-through."""
    e = ev["events"]
    mft, fin = e["mid_follow_through"]["frame"], e["finish"]["frame"]
    if fin <= mft + 1 or sg.trail_arm is None:
        return int(min(fin, mft + 1)), 0.3, "no span between P8 and the finish"

    seg = np.abs(sg.trail_arm[mft + 1:fin])
    i = int(mft + 1 + np.argmin(seg))
    # Confidence is how close to horizontal it actually got. A clip cut off mid-follow-through
    # never reaches it, and reads low here rather than returning the least-bad frame as fact.
    conf = float(np.clip(1.0 - float(seg[i - mft - 1]) / 45.0, 0.3, 0.9))
    return i, round(conf, 2), f"trail arm {float(seg[i - mft - 1]):.0f} deg off horizontal"


def build(ev, sg, frames, handedness="right", club=None, n_frames=None):
    """Assemble P1–P10. Returns {"items": [...], "notes": [...]}.

    Ordering is enforced the same way Stage 5 does it: a violation nudges the frame and
    *lowers the confidence*, so a squashed swing is visible in the data instead of being
    silently straightened out.
    """
    notes = []
    n = n_frames if n_frames is not None else len(frames)

    detected = {
        "downswing_middle": _p6(ev, sg, frames, handedness, club),
        "follow_through_top": _p9(ev, sg),
    }

    items, prev = [], -1
    for p, cid, label, event, phase, definition in CHECKPOINTS:
        if event is not None:
            e = ev["events"][event]
            frame, conf, basis = e["frame"], e["conf"], f"events.{event}"
        else:
            frame, conf, basis = detected[cid]

        frame = int(np.clip(frame, 0, max(0, n - 1)))
        if frame <= prev:
            frame = min(max(0, n - 1), prev + 1)
            conf = min(conf, 0.35)
            notes.append(f"{p} ({cid}) violated ordering; nudged to {frame}")
        prev = frame

        items.append({"p": p, "id": cid, "label": label, "phase": phase,
                      "event": event, "frame": frame, "conf": round(float(conf), 2),
                      "basis": basis, "definition": definition})

    return {"items": items, "notes": notes}
