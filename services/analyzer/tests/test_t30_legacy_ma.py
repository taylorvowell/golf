"""t30 legacy model head + moving-average trace, SG default — hermetic."""
from __future__ import annotations

from swingsage.club_tracking import ClubTrackingContext, available, get_test
from swingsage.club_tracking.pathfit import VARIANT_IDS, fit_variants
from swingsage.club_tracking.tests_impl.t30_legacy_model_ma import LegacyModelMaTracker

FPS = 60.0


def _make_doc(n=60, variant="model_trace_moving", with_frames=True):
    names = ["kp", "grip_center"]
    frames = [{"f": f, "kp": [[0.0, 0.0, 0.0], [0.5, 0.5, 0.9]], "st": 1,
               "interp": False} for f in range(n)]
    back_f = list(range(5, 30))
    down_f = list(range(30, 56))
    mk = lambda fs: [[0.3 + 0.005 * f, 0.6 - 0.002 * f] for f in fs]
    var = {"label": "Model head + trace: moving average",
           "trace": {"backswing": mk(back_f), "downswing": mk(down_f),
                     "followthrough": []},
           "trace_frames": {"backswing": back_f, "downswing": down_f,
                            "followthrough": []},
           "frames": ([{"f": f, "conf": 0.77} for f in range(n)] if with_frames else [])}
    return {
        "video": {"fps": FPS, "frame_count": n, "width": 720, "height": 1280,
                  "view": "dtl", "handedness": "right", "source": {"path": "x.mp4"}},
        "pose": {"model": "synthetic", "keypoint_names": names, "frames": frames},
        "events": {"address": {"frame": 5, "conf": 0.9},
                   "top": {"frame": 30, "conf": 0.5},
                   "impact": {"frame": 55, "conf": 0.9}},
        "club": {"frames": [], "variants": {variant: var}},
    }


def test_registered_with_savgol_default():
    assert "t30_legacy_model_ma" in available()
    assert LegacyModelMaTracker.default_style == "savgol"


def test_sources_the_moving_average_trace():
    res = get_test("t30_legacy_model_ma").run(
        ClubTrackingContext.from_artifacts(_make_doc()))
    assert res.diagnostics["variant"] == "model_trace_moving"
    assert res.diagnostics["points"] == 51            # 25 backswing + 26 downswing
    for o in res.observations:
        assert o.source == "classical" and o.confidence == 0.77
        assert abs(o.x - (0.3 + 0.005 * o.frame)) < 1e-9
    # follow-through excluded, address..impact only
    assert min(o.frame for o in res.observations) >= 5
    assert max(o.frame for o in res.observations) <= 55


def test_falls_back_through_the_variant_order():
    res = get_test("t30_legacy_model_ma").run(
        ClubTrackingContext.from_artifacts(_make_doc(variant="model_smooth")))
    assert res.diagnostics["variant"] == "model_smooth"


def test_no_model_variant_honest():
    doc = _make_doc()
    doc["club"]["variants"] = {"classical": {"trace": {}, "trace_frames": {}}}
    res = get_test("t30_legacy_model_ma").run(
        ClubTrackingContext.from_artifacts(doc))
    assert res.observations == []
    assert res.diagnostics["reason"] == "no_model_club_variant"


def test_savgol_default_equals_variant_p():
    res = get_test("t30_legacy_model_ma").run(
        ClubTrackingContext.from_artifacts(_make_doc()))
    v = fit_variants(res.observations, FPS, (5, 55), top_frame=30,
                     default_style="savgol")
    assert set(v) == set(VARIANT_IDS)
    assert v["default"] == v["p"]
