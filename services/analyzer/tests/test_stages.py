"""Golden snapshots for the deterministic stages: events -> checkpoints -> metrics.

These replay over frozen pose/club data (see scripts/make_test_data.py), so they are fast,
hermetic, and independent of ffmpeg, ONNX, the GPU and `out/`. What they catch is *drift*: a
tweak to a threshold in one stage that quietly moves a number three stages downstream.

They do not and cannot tell you the detector is correct — that is test_hand_labeled.py.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from conftest import assert_golden  # noqa: E402
from swingsage import checkpoints, events, metrics  # noqa: E402


def _detect(frozen):
    v = frozen["video"]
    return events.detect(frozen["pose"]["frames"], v["handedness"], v["fps"])


def test_events(request, fx, frozen):
    """The 8 GolfDB events, phases, tempo, and both windows."""
    res, _sg = _detect(frozen)
    assert_golden(request, f"{fx['stem']}.events", res)


def test_checkpoints(request, fx, frozen):
    """The 10 P-system positions. Club is passed as None here on purpose.

    `checkpoints.build` takes club data to resolve the three shaft-defined positions (D31), and
    the frozen input carries per-frame heads but not shafts. Pinning the club-free path is still
    worth doing — it is the path every clip takes when coverage fails the quality gate, and P6's
    proxy fallback is exactly the kind of code that rots unnoticed.
    """
    res, sg = _detect(frozen)
    cps = checkpoints.build(res, sg, frozen["pose"]["frames"],
                            frozen["video"]["handedness"], club=None,
                            n_frames=len(frozen["pose"]["frames"]))
    assert_golden(request, f"{fx['stem']}.checkpoints", cps)


def test_metrics(request, fx, frozen):
    """Angle catalogue, per-checkpoint deltas and the summary.

    The per-frame series is deliberately excluded from the snapshot: it is ~350 frames x 28
    fields, which would make the golden file larger than the input and every real diff
    unreadable. `summary` and `checkpoints` are the numbers a human ever reads, and both are
    derived from the series, so a change in it surfaces here anyway.
    """
    res, sg = _detect(frozen)
    v = frozen["video"]
    cps = checkpoints.build(res, sg, frozen["pose"]["frames"], v["handedness"], club=None,
                            n_frames=len(frozen["pose"]["frames"]))
    mt = metrics.compute(frozen["pose"]["frames"], res, v["view"], v["handedness"],
                         aspect=v["width"] / v["height"], fps=v["fps"],
                         club_frames=frozen.get("club_frames"), checkpoints=cps)
    trimmed = {k: val for k, val in mt.items() if k != "series"}
    trimmed["series_len"] = len(mt.get("series") or [])
    assert_golden(request, f"{fx['stem']}.metrics", trimmed)


def test_determinism(fx, frozen):
    """Same input twice, same output. Guards against an accidental dependence on iteration
    order, uninitialised state, or (as in D-era history) a mutating `finalize` call."""
    a, _ = _detect(frozen)
    b, _ = _detect(frozen)
    assert a == b, "events.detect is not deterministic over identical input"
