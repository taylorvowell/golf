"""Contract invariants — properties that must hold for ANY swing, with no golden file.

This is the half of the suite that keeps working as fixtures are added. A snapshot needs a
recorded answer per clip; an invariant needs nothing, so dropping a tenth fixture into the
manifest immediately buys ten clips' worth of contract checking.

Everything asserted here is a promise `analysis.json` makes to the player (the architecture spec) or a rule
the scoring spec states about event ordering. A violation is a bug in the analyzer, never a
fixture-specific quirk.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from swingsage import events  # noqa: E402
from swingsage.skeleton import IDX  # noqa: E402

EVENT_ORDER = events.EVENT_ORDER


@pytest.fixture
def detected(frozen):
    v = frozen["video"]
    res, sg = events.detect(frozen["pose"]["frames"], v["handedness"], v["fps"])
    return res, sg


def test_keypoint_block_is_49_and_append_only(frozen):
    """33 native + 7 derived + 8 measured + 1 derived-tail, in that published order.

    Reordering would silently change the meaning of published indices 0-47 for every stored
    artifact, which is why this is asserted rather than trusted. The anchors below are one
    per block boundary, so an insertion anywhere lands on one of them — `chin` in particular
    is the canary for the tempting mistake of slotting a new derived joint next to its
    siblings at index 40 instead of appending it at the end.
    """
    names = frozen["pose"]["keypoint_names"]
    assert len(names) == 49, f"expected 49 keypoints, got {len(names)}"
    assert all(len(f["kp"]) == 49 for f in frozen["pose"]["frames"]), \
        "a frame carries a different number of keypoints than keypoint_names declares"
    for anchor, i in (("nose", 0), ("neck", 33), ("grip_center", 37), ("chin", 44),
                      ("waist", 48)):
        assert names[i] == anchor, f"keypoint {i} is {names[i]!r}, expected {anchor!r}"
        assert IDX[anchor] == i, f"skeleton.IDX disagrees with the artifact for {anchor!r}"


def test_coordinates_are_normalized(frozen):
    """x right, y down, both 0-1, so the client only ever scales (the architecture spec).

    A small overshoot is legitimate: a joint can be estimated just outside frame. A large one
    means an un-normalized pixel value leaked through, which is the failure this catches.
    """
    bad = []
    for fr in frozen["pose"]["frames"]:
        for i, (x, y, c) in enumerate(fr["kp"]):
            if not (-0.5 <= x <= 1.5 and -0.5 <= y <= 1.5) or not (0.0 <= c <= 1.0):
                bad.append((fr["f"], i, x, y, c))
    assert not bad[:5], f"{len(bad)} keypoints outside the normalized contract: {bad[:5]}"


def test_confidence_is_truncated_not_rounded(frozen):
    """Every consumer re-applies the same MIN_CONF gate, so a value rounding *up* onto the
    threshold makes the client include a point the analyzer dropped. Truncation can only ever
    move a value away from the gate. Verified structurally — 5 decimals, never a 6th."""
    for fr in frozen["pose"]["frames"]:
        for i, kp in enumerate(fr["kp"]):
            c = kp[2]
            assert round(c, 5) == c, \
                f"frame {fr['f']} kp {i} confidence {c!r} carries more than 5 decimals"


def test_event_ordering_is_strict(detected):
    """A < TU < MB < T < MD < I < MFT < F (the scoring spec), strictly increasing."""
    ev = detected[0]["events"]
    frames = [ev[n]["frame"] for n in EVENT_ORDER]
    assert frames == sorted(frames) and len(set(frames)) == len(frames), \
        "events are not strictly ordered: " + ", ".join(
            f"{n}={ev[n]['frame']}" for n in EVENT_ORDER)


def test_every_event_has_a_confidence(detected):
    ev = detected[0]["events"]
    assert set(ev) == set(EVENT_ORDER), f"event set is {sorted(ev)}"
    for n, item in ev.items():
        assert 0.0 <= item["conf"] <= 1.0, f"{n} confidence {item['conf']} out of range"


def test_events_lie_inside_the_clip(detected, frozen):
    n = len(frozen["pose"]["frames"])
    for name, item in detected[0]["events"].items():
        assert 0 <= item["frame"] < n, f"{name} at frame {item['frame']} outside 0..{n-1}"


def test_phases_tile_the_events_without_gaps(detected):
    """The phase list is what the player's segment bar is drawn from; a gap or an overlap there
    is a visibly wrong UI, so it is cheaper to assert than to notice."""
    ev, phases = detected[0]["events"], detected[0]["phases"]
    assert len(phases) == len(EVENT_ORDER) - 1
    for i, ph in enumerate(phases):
        s, e = EVENT_ORDER[i], EVENT_ORDER[i + 1]
        assert ph["name"] == f"{s}->{e}"
        assert ph["from"] == ev[s]["frame"] and ph["to"] == ev[e]["frame"]


def test_playback_window_contains_the_swing(detected, frozen):
    """The window's core promise: it can be wider than address..finish but never narrower, or
    the player would refuse to seek to a frame it is drawing events for."""
    res = detected[0]
    n = len(frozen["pose"]["frames"])
    lo, hi = res["playback_window"]
    addr = res["events"]["address"]["frame"]
    fin = res["events"]["finish"]["frame"]
    assert 0 <= lo < hi <= n - 1, f"playback_window {[lo, hi]} invalid for {n} frames"
    assert lo <= addr, f"playback_window starts at {lo}, after address {addr}"
    assert hi >= fin, f"playback_window ends at {hi}, before finish {fin}"


def test_address_span_ends_at_the_address_event(detected):
    """The span is the hold that *ended* at Address; setup metrics average over it, so a span
    running past the event would average in the takeaway."""
    res = detected[0]
    s, e = res["address_span"]
    assert s <= e, f"address_span {[s, e]} inverted"
    assert e == res["events"]["address"]["frame"], \
        f"address_span ends at {e}, address event is {res['events']['address']['frame']}"


def test_tempo_is_self_consistent(detected, frozen):
    """The published ms figures must agree with the frame counts and the clip's fps — these are
    three views of one measurement and nothing in the code forces them to match."""
    res = detected[0]
    t = res["tempo"]
    if t is None:
        pytest.skip("no tempo for this clip")
    fps = frozen["video"]["fps"]
    ev = res["events"]
    assert t["backswing_frames"] == ev["top"]["frame"] - ev["address"]["frame"]
    assert t["downswing_frames"] == ev["impact"]["frame"] - ev["top"]["frame"]
    assert abs(t["backswing_ms"] - t["backswing_frames"] / fps * 1000) <= 1
    assert abs(t["downswing_ms"] - t["downswing_frames"] / fps * 1000) <= 1
    assert abs(t["ratio"] - t["backswing_frames"] / t["downswing_frames"]) < 0.01
