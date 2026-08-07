"""Test 8 phase fusion (track step 14) — pure fusion math + cached-experiment plumbing."""
from __future__ import annotations

import numpy as np

from swingsage.club_tracking import ClubTrackingContext, available, get_test
from swingsage.club_tracking.fusion import fuse_frame, phase_of

FPS = 60.0


class TestPhaseOf:
    EVENTS = {"address": 10, "top": 60, "impact": 100}

    def test_phases(self):
        assert phase_of(10, self.EVENTS) == "address"
        assert phase_of(30, self.EVENTS) == "backswing"
        assert phase_of(60, self.EVENTS) == "top"
        assert phase_of(80, self.EVENTS) == "downswing"
        assert phase_of(95, self.EVENTS) == "impact"


class TestFuseFrame:
    def test_outlier_expert_ejected(self):
        pts = [("t1_candidate_graph", 0.50, 0.50, 0.8, "observed"),
               ("t10_physics_conic", 0.505, 0.498, 0.8, "observed"),
               ("t4_video_segmentation", 0.9, 0.1, 0.9, "observed")]  # parked wrong
        x, y, conf, mode, dis, who = fuse_frame(pts, "backswing")
        assert abs(x - 0.5025) < 0.01 and abs(y - 0.5) < 0.01
        assert "t4_video_segmentation" not in who
        assert mode == "observed"

    def test_phase_weighting_shifts_result(self):
        pts = [("t5_blur_flow", 0.60, 0.60, 0.8, "observed"),
               ("t3_point_tracking", 0.64, 0.64, 0.8, "observed")]
        xi, *_ = fuse_frame(pts, "impact")       # t5 owns impact
        xt, *_ = fuse_frame(pts, "top")          # t3 owns the top
        assert xi < xt, "phase weights had no effect"

    def test_inferred_only_stays_inferred(self):
        pts = [("t6_grip_kinematic", 0.5, 0.5, 0.6, "inferred")]
        *_, mode, dis, who = fuse_frame(pts, "downswing")
        assert mode == "inferred"

    def test_empty(self):
        assert fuse_frame([], "backswing") is None


def _experiment(tid, pts):
    return {"test": {"id": tid, "label": tid, "version": "1"},
            "events": {"impact": {"frame": 55, "time_s": 55 / FPS,
                                  "confidence": 0.9,
                                  "source": "experiment" if tid == "t10_physics_conic"
                                  else "artifact"}},
            "trace": {"display_mode": "continuous", "phase_spans": {},
                      "variants": {"default": pts}},
            "diagnostics": {}}


def _make_doc(n=60):
    names = ["kp", "grip_center"]
    frames = [{"f": f, "kp": [[0.0, 0.0, 0.0], [0.5, 0.5, 0.9]], "st": 1,
               "interp": False} for f in range(n)]

    def pts(bias, noise_seed):
        rng = np.random.default_rng(noise_seed)
        out = []
        for f in range(5, 56):
            t = f / FPS
            x = 0.5 + 0.3 * np.sin(1.5 * t) + bias + rng.normal(0, 0.002)
            y = 0.5 + 0.25 * np.cos(1.2 * t) + rng.normal(0, 0.002)
            out.append({"frame": f, "x": float(x), "y": float(y),
                        "confidence": 0.8, "mode": "observed"})
        return out

    return {
        "video": {"fps": FPS, "frame_count": n, "width": 720, "height": 1280,
                  "view": "dtl", "handedness": "right", "source": {"path": "x.mp4"}},
        "pose": {"model": "synthetic", "keypoint_names": names, "frames": frames},
        "events": {"address": {"frame": 5, "conf": 0.9},
                   "top": {"frame": 30, "conf": 0.5},
                   "impact": {"frame": 55, "conf": 0.9}},
        "club": {"frames": []},
        "club_tracking": {"schema_version": 1, "experiments": {
            "t1_candidate_graph": _experiment("t1_candidate_graph", pts(0.0, 1)),
            "t10_physics_conic": _experiment("t10_physics_conic", pts(0.004, 2)),
            "t6_grip_kinematic": _experiment("t6_grip_kinematic", pts(-0.004, 3)),
        }},
    }


class TestTracker:
    def test_registered(self):
        assert "t8_phase_fusion" in available()

    def test_fuses_cached_experts(self):
        ctx = ClubTrackingContext.from_artifacts(_make_doc())
        res = get_test("t8_phase_fusion").run(ctx)
        assert len(res.observations) == 51
        for o in res.observations:
            t = o.frame / FPS
            tx = 0.5 + 0.3 * np.sin(1.5 * t)
            ty = 0.5 + 0.25 * np.cos(1.2 * t)
            assert abs(o.x - tx) < 0.01 and abs(o.y - ty) < 0.01
            assert o.source == "fused"
        assert set(res.diagnostics["experts_used"]) == {
            "t1_candidate_graph", "t10_physics_conic", "t6_grip_kinematic"}
        # refined (non-artifact) impact evidence inherited
        assert any(e.event == "impact" for e in res.event_evidence)

    def test_needs_experiments(self):
        doc = _make_doc()
        doc["club_tracking"]["experiments"] = {}
        ctx = ClubTrackingContext.from_artifacts(doc)
        res = get_test("t8_phase_fusion").run(ctx)
        assert res.observations == []
        assert res.diagnostics["reason"] == "needs_cached_expert_experiments"
