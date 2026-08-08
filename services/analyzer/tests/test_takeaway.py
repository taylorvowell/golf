"""Backswing start from the club head — `club.takeaway_start` and what it moves.

Synthetic head paths rather than a fixture, because the thing under test is a decision rule and
the cases that matter are the ones the fixtures happen not to contain: a detector gap in the
middle of the lookback, motion that runs off the edge of the window, a 30fps source doubled to
60. Each case here is a shape the rule must get right, written so the shape is readable in the
test rather than buried in a frozen array.

The rule's load-bearing half is the rest guard, so most of these are cases where it must
DECLINE to move Address — a golfer walking the club into the ball produces the same forward
signal as a takeaway, and dragging Address back into the setup would corrupt everything
measured over `address_span`.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from swingsage import club  # noqa: E402

CLUB_PX = 400.0
CFG = club.ClubConfig()
#: 0.5% of club length over 3 frames is the default "moving" threshold, so 2px/frame is
#: unambiguous motion and 0.05px/frame is unambiguous rest, whatever the exact tolerance.
MOVING, STILL = 2.0, 0.05


def heads(steps, start=(500.0, 900.0), first=0):
    """`{frame: xy}` from a list of per-frame step sizes; `None` means the detector declined."""
    out, xy = {}, np.array(start, float)
    for i, s in enumerate(steps):
        if s is None:
            continue
        xy = xy + np.array([float(s), 0.0])
        out[first + i] = xy.copy()
    return out


def test_moves_address_back_to_where_the_head_left_rest():
    """Ten still frames, then six moving ones — the backswing starts at the last still frame."""
    m = heads([STILL] * 10 + [MOVING] * 6)
    f0, why = club.takeaway_start(m, 15, CLUB_PX, CFG)
    assert f0 == 9, why
    assert "left its rest position" in why


def test_declines_when_the_club_was_being_walked_into_the_ball():
    """The forward signal is identical; only what came BEFORE separates the two cases."""
    m = heads([MOVING] * 16)
    f0, why = club.takeaway_start(m, 15, CLUB_PX, CFG)
    assert f0 == 15
    assert "walked into the ball" in why or "cannot be told" in why


def test_declines_when_the_head_never_moved():
    m = heads([STILL] * 16)
    f0, why = club.takeaway_start(m, 15, CLUB_PX, CFG)
    assert f0 == 15
    assert "already at rest" in why


def test_never_reaches_further_back_than_the_lookback():
    """Motion running off the edge of the window is unresolvable, not maximally early.

    The whole window moving means the club may have started before it, so the honest answer is
    to leave the hand-based frame alone rather than to return the edge.
    """
    n = CFG.takeaway_lookback + 8
    m = heads([STILL] * 4 + [MOVING] * n)
    f0, why = club.takeaway_start(m, n + 3, CLUB_PX, CFG)
    assert f0 == n + 3, why
    assert "cannot be told" in why


def test_survives_a_30fps_source_doubled_to_60():
    """Every other frame repeats, so per-frame steps alternate zero / double.

    A single-frame stillness test reads "still" on half of a moving club and stops one frame
    into the walk-back; measuring over `takeaway_span` frames is what makes this work.
    """
    m = heads([STILL, STILL] * 5 + [0.0, 2 * MOVING] * 4)
    f0, why = club.takeaway_start(m, 17, CLUB_PX, CFG)
    assert f0 <= 11, why


def test_stops_at_a_detector_gap_rather_than_guessing_across_it():
    m = heads([STILL] * 6 + [None] * 5 + [MOVING] * 5)
    f0, why = club.takeaway_start(m, 15, CLUB_PX, CFG)
    assert f0 == 15
    assert "no detector head behind" in why


def test_declines_without_a_head_on_the_address_frame():
    m = heads([STILL] * 10 + [MOVING] * 5 + [None])
    f0, why = club.takeaway_start(m, 15, CLUB_PX, CFG)
    assert f0 == 15
    assert "no detector head at the Address frame" in why


def test_declines_when_the_whole_move_is_within_detector_noise():
    """Sustained but tiny: over the threshold every frame, under it in total."""
    tiny = CFG.takeaway_move_tol * CLUB_PX / CFG.takeaway_span * 1.2
    m = heads([STILL] * 10 + [tiny] * 3)
    f0, why = club.takeaway_start(m, 12, CLUB_PX, CFG)
    assert f0 == 12
    assert "detector's own noise" in why


def test_off_when_disabled():
    m = heads([STILL] * 10 + [MOVING] * 6)
    f0, _ = club.takeaway_start(m, 15, CLUB_PX,
                                club.replace(CFG, takeaway_refine=False))
    assert f0 == 15


# --- what moving Address drags along with it -----------------------------------------------

def _ev(addr, top, impact, finish):
    """A minimal Stage 5 result: the events, the hold, the window and the tempo."""
    order = [("address", addr), ("toe_up", addr + 15), ("mid_backswing", addr + 30),
             ("top", top), ("mid_downswing", top + 20), ("impact", impact),
             ("mid_follow_through", impact + 15), ("finish", finish)]
    ev = {"events": {k: {"frame": f, "conf": 0.8} for k, f in order},
          "phases": [{"name": f"{a}->{b}", "from": fa, "to": fb}
                     for (a, fa), (b, fb) in zip(order[:-1], order[1:])],
          "address_span": [addr - 20, addr],
          "playback_window": [addr - 60, finish + 60], "playback_pad": [0, 0]}
    from swingsage import events as ev_mod
    ev["tempo"], _ = ev_mod.build_tempo(ev["events"], 60.0)
    return ev


#: The synthetic swing the integration cases below run over. Address sits well clear of both
#: ends of the clip so the one-second window is never clamped by the footage instead of by the
#: rule under test.
N_FRAMES, ADDRESS, TAKEAWAY = 340, 100, 94


@pytest.fixture
def refined():
    """`refine_events` over a club whose head leaves rest 6 frames before the hand-based Address."""
    m = heads([STILL] * (TAKEAWAY + 1) + [MOVING] * (N_FRAMES - TAKEAWAY - 1))
    res = club.ClubResult(frames=[club.ClubFrame(f=f) for f in range(N_FRAMES)],
                          club_len=CLUB_PX / 1000.0, width=1000, height=1000)
    ev = _ev(addr=ADDRESS, top=190, impact=220, finish=260)
    msgs = club.refine_events(res, ev, CFG,
                              heads={f: (p[0] / 1000.0, p[1] / 1000.0) for f, p in m.items()},
                              fps=60.0)
    return ev, msgs


def test_refine_moves_address_and_keeps_the_events_ordered(refined):
    ev, msgs = refined
    assert ev["events"]["address"]["frame"] == TAKEAWAY, msgs
    fs = [ev["events"][k]["frame"] for k in
          ["address", "toe_up", "mid_backswing", "top", "mid_downswing", "impact",
           "mid_follow_through", "finish"]]
    assert fs == sorted(fs) and len(set(fs)) == len(fs)


def test_the_setup_hold_still_ends_at_address(refined):
    """`address_span` is what setup medians are taken over — it cannot outlive the takeaway."""
    ev, _ = refined
    s, e = ev["address_span"]
    assert s <= e == ev["events"]["address"]["frame"]


def test_the_approach_stays_exactly_one_second(refined):
    """The window's front edge is pinned to Address - 1s, so it moves with Address."""
    ev, _ = refined
    assert ev["playback_window"][0] == ev["events"]["address"]["frame"] - 60


def test_phases_and_tempo_are_rebuilt_from_the_moved_event(refined):
    ev, _ = refined
    e = ev["events"]
    assert ev["phases"][0] == {"name": "address->toe_up", "from": e["address"]["frame"],
                               "to": e["toe_up"]["frame"]}
    assert ev["tempo"]["backswing_frames"] == e["top"]["frame"] - e["address"]["frame"]
