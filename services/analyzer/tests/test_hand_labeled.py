"""doc 08 Phase 3's acceptance criterion: 8 events within ±3 frames of hand-judged truth.

Kept apart from the snapshots on purpose. A golden file proves the detector has not *changed*;
only a human who watched the video frame by frame can say it is *right*. Today's session is the
argument: a 48-frame Address error sat in the artifact reporting a 1600ms backswing, and a
snapshot taken while it was wrong would have locked it in and gone green forever.

Fill `hand_labeled` in fixtures.json by scrubbing each clip and recording the frame for each of
the eight events. Do **not** paste the detector's own output in — that makes the criterion
self-satisfying and this file worthless.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from swingsage import events  # noqa: E402

TOLERANCE = 3          # frames, doc 08 Phase 3
PASS_FRACTION = 0.80   # of fixtures, doc 08 Phase 3


def test_events_match_hand_labels(fx, frozen):
    truth = fx.get("hand_labeled")
    if not truth:
        pytest.skip(
            f"{fx['stem']} has no hand-labelled events — doc 08 Phase 3 cannot be verified "
            f"until fixtures.json carries them. This is an unmet acceptance criterion, not a "
            f"passing test.")

    v = frozen["video"]
    res, _ = events.detect(frozen["pose"]["frames"], v["handedness"], v["fps"])

    off = {}
    for name, want in truth.items():
        got = res["events"][name]["frame"]
        if abs(got - want) > TOLERANCE:
            off[name] = f"detected {got}, labelled {want} (off by {got - want:+d})"
    assert not off, (f"{fx['stem']}: {len(off)}/{len(truth)} events outside ±{TOLERANCE} "
                     f"frames:\n  " + "\n  ".join(f"{k}: {v_}" for k, v_ in off.items()))


def test_fixture_count_meets_phase_0(request):
    """doc 08 Phase 0 wants >=10 fixtures across both views, both handedness, sim + range.

    An xfail rather than a skip: this is a real, known, unmet requirement and it should stay
    visible in every test run instead of being quietly absent. It flips to a pass — and starts
    reporting XPASS — the moment the set is filled out.
    """
    import json
    manifest = json.loads((Path(__file__).resolve().parent / "fixtures.json")
                          .read_text(encoding="utf-8"))["fixtures"]
    n = len(manifest)
    views = {f["view"] for f in manifest}
    hands = {f["handedness"] for f in manifest}
    if n < 10 or len(views) < 2 or len(hands) < 2:
        pytest.xfail(f"fixture set incomplete: {n}/10 clips, views={sorted(views)}, "
                     f"handedness={sorted(hands)} — doc 08 Phase 0")
    assert n >= 10
