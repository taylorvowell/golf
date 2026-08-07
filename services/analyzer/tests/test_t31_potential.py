"""t31 "Potential" — trajectory-gated head + moving-average trace."""
from __future__ import annotations

from swingsage.club_tracking import ClubTrackingContext, available, get_test
from swingsage.club_tracking.tests_impl.t31_potential import moving_average

FPS = 60.0


class TestMovingAverage:
    def test_smooths_a_spike_but_keeps_endpoints(self):
        pts = [(f, 0.5, 0.5, 0.8) for f in range(9)]
        pts[4] = (4, 0.9, 0.5, 0.8)                # one spike
        out = moving_average(pts)
        assert abs(out[4][1] - 0.58) < 0.02, "spike not averaged down"
        assert out[0][1] == 0.5 and out[-1][1] == 0.5, "endpoints moved"
        assert [p[0] for p in out] == [p[0] for p in pts]

    def test_short_series_untouched(self):
        pts = [(0, 0.1, 0.2, 0.5), (1, 0.3, 0.4, 0.5)]
        assert moving_average(pts) == pts


def _make_doc(n=60, variant="model_traj", interp_at=()):
    names = ["kp", "grip_center"]
    frames = [{"f": f, "kp": [[0.0, 0.0, 0.0], [0.5, 0.5, 0.9]], "st": 1,
               "interp": False} for f in range(n)]
    vframes = [{"f": f, "head": [0.3 + 0.005 * f, 0.6], "conf": 0.72,
                "interp": f in interp_at} for f in range(n)]
    return {
        "video": {"fps": FPS, "frame_count": n, "width": 720, "height": 1280,
                  "view": "dtl", "handedness": "right", "source": {"path": "x.mp4"}},
        "pose": {"model": "synthetic", "keypoint_names": names, "frames": frames},
        "events": {"address": {"frame": 5, "conf": 0.9},
                   "top": {"frame": 30, "conf": 0.5},
                   "impact": {"frame": 55, "conf": 0.9}},
        "club": {"frames": [], "variants": {
            variant: {"label": "Model head + trajectory gate (low conf admitted)",
                      "frames": vframes, "trace": {}, "trace_frames": {}}}},
    }


def test_registered():
    assert "t31_potential" in available()


def test_uses_trajectory_gated_variant_and_averages():
    res = get_test("t31_potential").run(
        ClubTrackingContext.from_artifacts(_make_doc()))
    assert res.diagnostics["variant"] == "model_traj"
    assert res.diagnostics["ma_window"] == 5
    assert res.diagnostics["points"] == 51            # frames 5..55 inclusive
    for o in res.observations:
        assert o.source == "classical" and o.mode == "observed"
        assert abs(o.x - (0.3 + 0.005 * o.frame)) < 1e-6   # a line survives averaging


def test_interpolated_frames_excluded():
    res = get_test("t31_potential").run(
        ClubTrackingContext.from_artifacts(_make_doc(interp_at={10, 11, 12})))
    assert res.diagnostics["skipped_interpolated"] == 3
    assert not {10, 11, 12} & {o.frame for o in res.observations}


def test_prefers_model_traj_then_falls_back():
    res = get_test("t31_potential").run(
        ClubTrackingContext.from_artifacts(_make_doc(variant="model_traj_raw")))
    assert res.diagnostics["variant"] == "model_traj_raw"


def test_no_gated_variant_honest():
    doc = _make_doc()
    doc["club"]["variants"] = {"classical": {"frames": []}}
    res = get_test("t31_potential").run(ClubTrackingContext.from_artifacts(doc))
    assert res.observations == []
    assert res.diagnostics["reason"] == "no_trajectory_gated_variant"
