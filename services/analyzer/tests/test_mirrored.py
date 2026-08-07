"""Mirrored hermetic fixtures (track step 03, plan §7.4) — handedness invariants.

A right-handed swing mirrored (x -> 1-x) with left/right keypoints swapped IS a left-handed
swing of the same tempo, so event detection must land on the same frames and the lead/trail
resolution must flip. This proves the coordinate/handedness plumbing without new footage —
it is NOT visual-domain validation (the plan is explicit about that limit).
"""
from __future__ import annotations

import copy

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from swingsage import events, metrics  # noqa: E402

EVENT_TOLERANCE = 2  # frames


def _pair_name(name: str) -> str:
    if name.startswith("left_"):
        return "right_" + name[5:]
    if name.startswith("right_"):
        return "left_" + name[6:]
    if name.endswith("_left"):
        return name[:-5] + "_right"
    if name.endswith("_right"):
        return name[:-6] + "_left"
    return name


def mirror_frozen(frozen: dict) -> dict:
    """x -> 1-x, left/right keypoints swapped, handedness flipped. Pure."""
    names = frozen["pose"]["keypoint_names"]
    perm = [names.index(_pair_name(n)) for n in names]
    out = copy.deepcopy(frozen)
    out["video"]["handedness"] = ("left" if frozen["video"]["handedness"] == "right"
                                  else "right")
    for fr in out["pose"]["frames"]:
        kp = fr["kp"]
        fr["kp"] = [
            # zeroed (conf 0) keypoints stay zero — 1-x would invent a point at x=1
            [1.0 - kp[j][0], kp[j][1], kp[j][2]] if kp[j][2] > 0 else list(kp[j])
            for j in perm
        ]
    if out.get("club_frames"):
        for cf in out["club_frames"]:
            if cf.get("head"):
                cf["head"] = [1.0 - cf["head"][0], *cf["head"][1:]]
    return out


def _event_frames(res: dict) -> dict[str, int]:
    return {name: ev["frame"] for name, ev in res["events"].items()}


def test_double_mirror_is_identity(fx, frozen):
    twice = mirror_frozen(mirror_frozen(frozen))
    assert twice["video"]["handedness"] == frozen["video"]["handedness"]
    for a, b in zip(twice["pose"]["frames"], frozen["pose"]["frames"]):
        assert a["f"] == b["f"]
        for pa, pb in zip(a["kp"], b["kp"]):
            assert abs(pa[0] - pb[0]) < 1e-12
            assert pa[1] == pb[1] and pa[2] == pb[2]


def test_mirror_touches_only_x_and_handedness(fx, frozen):
    m = mirror_frozen(frozen)
    assert m["video"]["fps"] == frozen["video"]["fps"]
    assert m["video"]["view"] == frozen["video"]["view"]
    names = frozen["pose"]["keypoint_names"]
    wi = names.index("left_wrist")
    wj = names.index("right_wrist")
    for fa, fb in zip(frozen["pose"]["frames"], m["pose"]["frames"]):
        a = fa["kp"][wi]
        b = fb["kp"][wj]  # mirrored right wrist holds the original left wrist's mirror
        if a[2] > 0:
            assert abs((1.0 - a[0]) - b[0]) < 1e-12
            assert a[1] == b[1] and a[2] == b[2]


def test_events_are_mirror_invariant(fx, frozen):
    v = frozen["video"]
    res, _ = events.detect(frozen["pose"]["frames"], v["handedness"], v["fps"])
    m = mirror_frozen(frozen)
    mres, _ = events.detect(m["pose"]["frames"], m["video"]["handedness"],
                            m["video"]["fps"])
    orig, mirr = _event_frames(res), _event_frames(mres)
    assert set(orig) == set(mirr)
    for name in orig:
        assert abs(orig[name] - mirr[name]) <= EVENT_TOLERANCE, (
            f"{name}: {orig[name]} vs mirrored {mirr[name]} — event detection is "
            f"handedness-asymmetric beyond ±{EVENT_TOLERANCE} frames")


def test_mirrored_events_keep_structural_invariants(fx, frozen):
    m = mirror_frozen(frozen)
    res, _ = events.detect(m["pose"]["frames"], m["video"]["handedness"],
                           m["video"]["fps"])
    order = ["address", "toe_up", "mid_backswing", "top", "mid_downswing",
             "impact", "mid_follow_through", "finish"]
    frames = [res["events"][e]["frame"] for e in order]
    assert frames == sorted(frames), "mirrored events out of order"
    assert all(res["events"][e]["conf"] >= 0 for e in order)


def test_metrics_sides_flip_under_mirror(fx, frozen):
    v = frozen["video"]
    res, sg = events.detect(frozen["pose"]["frames"], v["handedness"], v["fps"])
    mt = metrics.compute(frozen["pose"]["frames"], res, v["view"], v["handedness"],
                         aspect=v["width"] / v["height"], fps=v["fps"],
                         club_frames=frozen.get("club_frames"), checkpoints=None)

    m = mirror_frozen(frozen)
    mres, _ = events.detect(m["pose"]["frames"], m["video"]["handedness"],
                            m["video"]["fps"])
    mmt = metrics.compute(m["pose"]["frames"], mres, m["video"]["view"],
                          m["video"]["handedness"],
                          aspect=v["width"] / v["height"], fps=v["fps"],
                          club_frames=m.get("club_frames"), checkpoints=None)

    assert mt["sides"]["lead"] != mmt["sides"]["lead"]
    assert {mt["sides"]["lead"], mt["sides"]["trail"]} == {"left", "right"}
    assert {mmt["sides"]["lead"], mmt["sides"]["trail"]} == {"left", "right"}
