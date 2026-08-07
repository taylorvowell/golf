"""Club-tracking shared skeleton (track step 02) — model validation, context extraction,
registry mechanics. Hermetic: synthesized docs only, no artifacts, no video."""
from __future__ import annotations

import pytest

from swingsage.club_tracking import (BlurTrajectoryObservation, ClubCandidate,
                                     ClubObservation, ClubTrackingContext,
                                     ClubTrackingResult, ClubTrackingTest,
                                     EventEvidence, TEST_IDS, TESTS, available,
                                     get_test, register)


class TestModel:
    def test_observation_round_trip(self):
        o = ClubObservation(frame=42, source_time_s=0.7, x=0.5, y=0.6,
                            confidence=0.9, mode="observed", source="detector",
                            visibility="visible", covariance=(1e-4, 2e-4, 0.0))
        assert ClubObservation.from_dict(o.to_dict()) == o

    def test_observation_without_covariance_omits_key(self):
        o = ClubObservation(frame=0, source_time_s=None, x=0.1, y=0.2,
                            confidence=0.5, mode="inferred", source="kinematic",
                            visibility="unobservable")
        assert "covariance" not in o.to_dict()
        assert ClubObservation.from_dict(o.to_dict()) == o

    def test_bad_mode_rejected(self):
        with pytest.raises(ValueError, match="mode"):
            ClubObservation(frame=0, source_time_s=None, x=0.0, y=0.0,
                            confidence=0.5, mode="guessed", source="detector",
                            visibility="visible")

    def test_confidence_out_of_range_rejected(self):
        for bad in (-0.1, 1.1):
            with pytest.raises(ValueError, match="confidence"):
                ClubObservation(frame=0, source_time_s=None, x=0.0, y=0.0,
                                confidence=bad, mode="observed", source="detector",
                                visibility="visible")

    def test_bad_covariance_rejected(self):
        with pytest.raises(ValueError, match="covariance"):
            ClubObservation(frame=0, source_time_s=None, x=0.0, y=0.0,
                            confidence=0.5, mode="observed", source="detector",
                            visibility="visible", covariance=(1.0, 2.0))

    def test_candidate_round_trip(self):
        c = ClubCandidate(frame=10, source_time_s=0.17, x=0.3, y=0.4,
                          confidence=0.2, source="sea_raft",
                          features={"flow_magnitude": 12.5, "grip_distance": 0.31})
        assert ClubCandidate.from_dict(c.to_dict()) == c

    def test_unknown_source_passes_through(self):
        # Experts added later must not require editing the model.
        c = ClubCandidate(frame=0, source_time_s=0.0, x=0.0, y=0.0,
                          confidence=0.1, source="future_expert")
        assert c.source == "future_expert"

    def test_blur_round_trip(self):
        b = BlurTrajectoryObservation(frame=161, source_time_s=2.68,
                                      start_x=0.701, start_y=0.444,
                                      end_x=0.742, end_y=0.407, confidence=0.8)
        assert BlurTrajectoryObservation.from_dict(b.to_dict()) == b

    def test_event_evidence_round_trip_and_validation(self):
        e = EventEvidence(event="impact", time_s=2.6833, confidence=0.91,
                          source="audio")
        assert EventEvidence.from_dict(e.to_dict()) == e
        with pytest.raises(ValueError, match="event"):
            EventEvidence(event="toe_up", time_s=1.0, confidence=0.5, source="pose")

    def test_event_evidence_has_no_coordinates(self):
        # audio_event can never supply x/y — impossible by construction.
        e = EventEvidence(event="impact", time_s=2.68, confidence=0.9,
                          source="audio_event")
        assert not hasattr(e, "x") and not hasattr(e, "y")
        assert set(e.to_dict()) == {"event", "time_s", "confidence", "source"}


def _make_doc(grip_index: int = 5, frame_count: int = 6):
    """Synthetic minimal artifact. grip_center deliberately NOT at its real index (37) —
    extraction must go through keypoint_names, never a hardcoded position."""
    names = [f"kp_{i}" for i in range(8)]
    names[grip_index] = "grip_center"
    frames = []
    for f in range(frame_count):
        if f == 3:
            continue  # a dropped frame -> grip[3] must be None
        kp = [[0.0, 0.0, 0.0]] * len(names)
        kp = [list(p) for p in kp]
        kp[grip_index] = [0.1 * f, 0.2 * f, 0.9]
        frames.append({"f": f, "kp": kp, "st": 1, "interp": False})
    return {
        "video": {"fps": 60.0, "frame_count": frame_count, "width": 1080,
                  "height": 1920, "view": "dtl", "handedness": "left",
                  "source": {"path": "C:/nowhere/clip.mp4"}},
        "pose": {"model": "synthetic", "keypoint_names": names, "frames": frames},
        "events": {"address": {"frame": 0, "conf": 0.6},
                   "impact": {"frame": 4, "conf": 0.98}},
    }


class TestContext:
    def test_from_artifacts_extracts_grip_by_name(self):
        ctx = ClubTrackingContext.from_artifacts(_make_doc(grip_index=2))
        assert ctx.grip[1] == (0.1, 0.2, 0.9)
        assert ctx.grip[3] is None  # dropped frame
        assert len(ctx.grip) == ctx.frame_count

    def test_handedness_and_events_carried(self):
        ctx = ClubTrackingContext.from_artifacts(_make_doc())
        assert ctx.handedness == "left"
        assert ctx.events == {"address": 0, "impact": 4}
        assert ctx.event_confs["impact"] == 0.98
        assert ctx.source_path == "C:/nowhere/clip.mp4"

    def test_no_source_timing_is_fine(self):
        # Legacy artifacts without the D54 sidecar must load.
        ctx = ClubTrackingContext.from_artifacts(_make_doc(), timing_doc=None)
        assert ctx.source_timing is None

    def test_source_timing_parsed_when_present(self):
        timing = {"nominal_fps": 30.0, "avg_fps": 30.0, "time_base": "1/30000",
                  "start_time_s": 0.0, "duration_s": 1.0, "has_audio": False,
                  "audio_sample_rate": None, "audio_codec": None,
                  "distinct_observation_count": 0, "observations": []}
        ctx = ClubTrackingContext.from_artifacts(_make_doc(), timing_doc=timing)
        assert ctx.source_timing is not None
        assert ctx.source_timing.nominal_fps == 30.0


class TestRegistry:
    def test_catalogue_declares_plan_plus_second_wave(self):
        assert len(TEST_IDS) == 31
        assert list(TEST_IDS) == [
            "t1_candidate_graph", "t2_temporal_heatmap", "t3_point_tracking",
            "t4_video_segmentation", "t5_blur_flow", "t6_grip_kinematic",
            "t7_claude_adjudicated", "t8_phase_fusion", "t9_forensic_fusion",
            "t10_physics_conic", "t11_temporal_densification", "t12_av_impact",
            "t13_motion_composite", "t14_silhouette_subtract", "t15_envelope_graph",
            "t16_ridge_trace", "t17_llm_gap_fill", "t18_shaft_line",
            "t19_legacy_isolation_gate", "t20_raw_head_trace",
            "t21_red_legacy_ball", "t22_red_dedup", "t23_red_connected",
            "t24_momentum", "t25_gated_red_legacy_ball",
            "t26_gated_dedup", "t27_red_legacy", "t28_red_llm",
            "t29_red_llm_ball", "t30_legacy_model_ma", "t31_potential",
        ]

    def test_declared_but_unimplemented_raises_not_implemented(self):
        if "t1_candidate_graph" in TESTS:
            pytest.skip("t1 has landed; this guard is for the scaffold era")
        with pytest.raises(NotImplementedError, match="t1_candidate_graph"):
            get_test("t1_candidate_graph")

    def test_unknown_id_raises_keyerror_listing_valid(self):
        with pytest.raises(KeyError, match="t6_grip_kinematic"):
            get_test("nonsense")

    def test_register_and_run_dummy(self, monkeypatch):
        monkeypatch.setitem(TESTS, "t6_grip_kinematic", None)
        monkeypatch.delitem(TESTS, "t6_grip_kinematic")

        @register
        class Dummy:
            id = "t6_grip_kinematic"
            label = TEST_IDS["t6_grip_kinematic"]
            version = "0.0.1"

            def run(self, ctx):
                return ClubTrackingResult(
                    test_id=self.id, label=self.label, version=self.version,
                    observations=[ClubObservation(
                        frame=0, source_time_s=0.0, x=0.5, y=0.5, confidence=0.4,
                        mode="inferred", source="kinematic",
                        visibility="unobservable")],
                    diagnostics={"anchors": 0},
                )
        try:
            assert "t6_grip_kinematic" in available()
            inst = get_test("t6_grip_kinematic")
            assert isinstance(inst, ClubTrackingTest)
            res = inst.run(ClubTrackingContext.from_artifacts(_make_doc()))
            d = res.to_dict()
            assert d["test"]["id"] == "t6_grip_kinematic"
            assert d["observations"][0]["mode"] == "inferred"

            with pytest.raises(ValueError, match="already registered"):
                register(Dummy)
        finally:
            TESTS.pop("t6_grip_kinematic", None)

    def test_register_rejects_undeclared_id(self):
        with pytest.raises(ValueError, match="not a declared"):
            @register
            class Bad:
                id = "t13_wishful_thinking"
