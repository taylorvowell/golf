"""Test 9 forensic fusion (track step 18) — ROI math + fake source/detector runs."""
from __future__ import annotations

import numpy as np

from swingsage.club_tracking import ClubTrackingContext, available
from swingsage.club_tracking.forensic import coarse_track, roi_for, roi_to_frame
from swingsage.club_tracking.tests_impl.t9_forensic_fusion import ForensicFusionTracker

FPS = 60.0
SW, SH = 2160, 3840      # 4K portrait source


class TestRoiMath:
    def test_roi_scales_with_uncertainty(self):
        tight = roi_for((0.5, 0.5), 1.0, SW, SH)
        loose = roi_for((0.5, 0.5), 0.1, SW, SH)
        assert (loose[2] - loose[0]) > (tight[2] - tight[0])

    def test_roi_clamped_at_edges(self):
        x0, y0, x1, y1 = roi_for((0.01, 0.99), 0.2, SW, SH)
        assert x0 == 0 and y1 == SH and x1 > 0 and y0 < SH

    def test_roi_round_trip(self):
        roi = roi_for((0.6, 0.4), 0.8, SW, SH)
        fx, fy = roi_to_frame(0.5, 0.5, roi, SW, SH)
        assert abs(fx - 0.6) < 0.02 and abs(fy - 0.4) < 0.02

    def test_coarse_track_preference_order(self):
        pts = [{"frame": f, "x": 0.5, "y": 0.5, "confidence": 0.7, "mode": "observed"}
               for f in range(10)]
        exps = {"t1_candidate_graph": {"trace": {"variants": {"default": pts}}},
                "t8_phase_fusion": {"trace": {"variants": {"default": pts[:3]}}}}
        # t8 preferred but too short (<5) -> falls to t1
        assert len(coarse_track(exps)) == 10
        assert coarse_track({}) == {}


def _truth(f):
    t = f / FPS
    return 0.45 + 0.2 * np.sin(1.4 * t), 0.5 + 0.18 * np.cos(1.1 * t)


def _make_doc(n=50):
    names = ["kp", "grip_center"]
    frames = [{"f": f, "kp": [[0.0, 0.0, 0.0], [0.5, 0.5, 0.9]], "st": 1,
               "interp": False} for f in range(n)]
    # coarse pass: slightly OFFSET from truth — the hi-res ROI detector must correct it
    coarse_pts = [{"frame": f, "x": float(_truth(f)[0] + 0.015),
                   "y": float(_truth(f)[1] - 0.015), "confidence": 0.6,
                   "mode": "observed"} for f in range(n)]
    obs = [{"source_frame": i, "source_pts_s": i / FPS,
            "normalized_frames": [i], "is_duplicate_group": False}
           for i in range(n)]
    timing = {"nominal_fps": FPS, "avg_fps": FPS, "time_base": "1/600",
              "start_time_s": 0.0, "duration_s": n / FPS, "has_audio": True,
              "audio_sample_rate": 48000, "audio_codec": "aac",
              "distinct_observation_count": n, "observations": obs}
    doc = {
        "video": {"fps": FPS, "frame_count": n, "width": 720, "height": 1280,
                  "view": "dtl", "handedness": "right",
                  "source": {"path": "x.mp4", "rotation": 0}},
        "pose": {"model": "synthetic", "keypoint_names": names, "frames": frames},
        "events": {"address": {"frame": 2, "conf": 0.9},
                   "top": {"frame": 25, "conf": 0.5},
                   "impact": {"frame": 47, "conf": 0.9}},
        "club": {"frames": []},
        "club_tracking": {"schema_version": 1, "experiments": {
            "t8_phase_fusion": {"trace": {"variants": {"default": coarse_pts}}}}},
    }
    return doc, timing


def _fake_source_loader(ctx, wanted):
    # frame index in pixel [0,0,0], full 4K-ish resolution
    out = {}
    for sf in wanted:
        img = np.zeros((SH // 4, SW // 4, 3), dtype=np.uint8)  # smaller for test speed
        img[0, 0, 0] = sf
        out[sf] = img
    return out


def _fake_detector(crop):
    # cannot know the frame from the crop alone; the tracker slices from the full frame,
    # so pixel [0,0,0] survives only when the ROI touches the origin — instead return a
    # detection at the crop center, which equals the coarse prediction's position; the
    # test then verifies the ROI machinery maps it back near the coarse point.
    return [(0.5, 0.5, 0.9)]


class TestTracker:
    def test_registered(self):
        assert "t9_forensic_fusion" in available()

    def test_runs_and_maps_roi_detections_back(self):
        doc, timing = _make_doc()
        ctx = ClubTrackingContext.from_artifacts(doc, timing_doc=timing)
        tr = ForensicFusionTracker(detector=_fake_detector,
                                   source_loader=_fake_source_loader)
        res = tr.run(ctx)
        assert res.observations, res.diagnostics
        assert res.diagnostics["hires_detections"] > 0
        for o in res.observations:
            if o.source != "detector":
                continue
            cx = _truth(o.frame)[0] + 0.015     # ROI center = coarse prediction
            assert abs(o.x - cx) < 0.02, "ROI->frame mapping broken"

    def test_needs_coarse_pass(self):
        doc, timing = _make_doc()
        doc["club_tracking"]["experiments"] = {}
        ctx = ClubTrackingContext.from_artifacts(doc, timing_doc=timing)
        res = ForensicFusionTracker(detector=_fake_detector,
                                    source_loader=_fake_source_loader).run(ctx)
        assert res.diagnostics["reason"] == "needs_cached_coarse_pass"

    def test_needs_source_timing(self):
        doc, _ = _make_doc()
        ctx = ClubTrackingContext.from_artifacts(doc, timing_doc=None)
        res = ForensicFusionTracker(detector=_fake_detector,
                                    source_loader=_fake_source_loader).run(ctx)
        assert res.diagnostics["reason"] == "needs_source_timing"
