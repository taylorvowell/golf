"""t20 raw head trace — the red boxes connected, nothing else."""
from __future__ import annotations

from swingsage.club_tracking import ClubTrackingContext, available, get_test


def _make_doc(with_boxes=True):
    n = 40
    names = ["kp", "grip_center"]
    frames = [{"f": f, "kp": [[0.0, 0.0, 0.0], [0.5, 0.5, 0.9]], "st": 1,
               "interp": False} for f in range(n)]
    boxes = []
    if with_boxes:
        for f in range(0, n, 2):          # heads every other frame
            boxes.append({"f": f, "d": [
                {"c": 0, "xy": [0.3 + 0.01 * f, 0.6], "wh": [0.02, 0.02], "p": 0.5},
                {"c": 0, "xy": [0.31 + 0.01 * f, 0.61], "wh": [0.02, 0.02], "p": 0.9},
                # the shaft box CONTAINS the heads — the green-gate rule needs it
                {"c": 1, "xy": [0.45, 0.55], "wh": [0.5, 0.3], "p": 0.99},
            ]})
    return {
        "video": {"fps": 60.0, "frame_count": n, "width": 720, "height": 1280,
                  "view": "dtl", "handedness": "right", "source": {"path": "x.mp4"}},
        "pose": {"model": "synthetic", "keypoint_names": names, "frames": frames},
        "events": {"address": {"frame": 0, "conf": 0.9},
                   "top": {"frame": 20, "conf": 0.5},
                   "impact": {"frame": 39, "conf": 0.9}},
        "club": {"frames": [],
                 "detector": {"names": {"0": "clubhead", "1": "stick"},
                              "boxes": boxes}},
    }


def test_registered():
    assert "t20_raw_head_trace" in available()


def test_best_head_per_frame_sticks_ignored():
    res = get_test("t20_raw_head_trace").run(
        ClubTrackingContext.from_artifacts(_make_doc()))
    assert res.diagnostics["boxes_from"] == "artifact"
    assert len(res.observations) == 20
    for o in res.observations:
        assert o.confidence == 0.9, "did not pick the highest-p head"
        assert abs(o.x - (0.31 + 0.01 * o.frame)) < 1e-9
        assert o.mode == "observed" and o.source == "detector"
    assert res.diagnostics["longest_gap_frames"] == 2


def test_red_outside_green_does_not_count():
    doc = _make_doc()
    # a rogue high-conf red far outside every shaft box on frame 0
    doc["club"]["detector"]["boxes"][0]["d"].append(
        {"c": 0, "xy": [0.95, 0.05], "wh": [0.02, 0.02], "p": 0.99})
    res = get_test("t20_raw_head_trace").run(
        ClubTrackingContext.from_artifacts(doc))
    by = {o.frame: o for o in res.observations}
    assert by[0].confidence == 0.9, "green-gate failed: rogue red won the frame"


def test_frame_without_green_validates_nothing():
    doc = _make_doc()
    # strip the shaft box from frame 2 — its reds must not count (user rule: MUST be
    # in a green box)
    doc["club"]["detector"]["boxes"][1]["d"] = [
        d for d in doc["club"]["detector"]["boxes"][1]["d"] if d["c"] == 0]
    res = get_test("t20_raw_head_trace").run(
        ClubTrackingContext.from_artifacts(doc))
    assert 2 not in {o.frame for o in res.observations}


def test_t23_registered_with_linear_default():
    from swingsage.club_tracking.tests_impl.t23_red_connected import (
        RedConnectedTracker)
    assert "t23_red_connected" in available()
    assert RedConnectedTracker.default_style == "linear"
    res = RedConnectedTracker().run(ClubTrackingContext.from_artifacts(_make_doc()))
    assert res.diagnostics["default_is"] == "straight_chords"
    assert res.observations


def test_no_boxes_honest():
    res = get_test("t20_raw_head_trace").run(
        ClubTrackingContext.from_artifacts(_make_doc(with_boxes=False)))
    assert res.observations == []
    assert res.diagnostics["reason"] == "no_raw_head_boxes"
