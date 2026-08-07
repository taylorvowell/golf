"""The single catalogue of the 12 tracking tests (plan §9, §27).

`TEST_IDS` is the one place the canonical ids live — the safe-reanalysis enum flow
(plan §29) and any TS mirror are checked against it, never hand-copied. Implementations
self-register with `@register` as their track steps land; until then `get_test` distinguishes
"declared but not built yet" (NotImplementedError — the debug menu greys these out honestly)
from "no such test" (KeyError).
"""
from __future__ import annotations

from .interface import ClubTrackingTest

TEST_IDS: dict[str, str] = {
    "t1_candidate_graph": "Global Candidate Graph",
    "t2_temporal_heatmap": "Club-Specific Temporal Heatmap",
    "t3_point_tracking": "Modern Point Tracking",
    "t4_video_segmentation": "Video Object Segmentation",
    "t5_blur_flow": "Blur + SEA-RAFT + Deblatting",
    "t6_grip_kinematic": "Grip-Centered Kinematic Reconstruction",
    "t7_claude_adjudicated": "Claude Bounded Adjudication",
    "t8_phase_fusion": "Phase-Adaptive Multi-Tracker Fusion",
    "t9_forensic_fusion": "Coarse-to-Fine Source-Time Forensic Fusion",
    "t10_physics_conic": "Physics-Constrained Conic / Factor-Graph",
    "t11_temporal_densification": "Synthetic Temporal Densification",
    "t12_av_impact": "Audio-Visual Impact Anchor",
    # Second wave — user brainstorm 2026-08-08 (append-only; the plan's 12 keep their ids)
    "t13_motion_composite": "Motion Composite / Long-Exposure Envelope",
    "t14_silhouette_subtract": "Silhouette-Subtracted Motion",
    "t15_envelope_graph": "Envelope-Constrained Candidate Graph",
    # Third wave — user brainstorm continued
    "t16_ridge_trace": "Motion Ridge Centerline",
    "t17_llm_gap_fill": "Confidence-Triaged LLM Gap Fill",
    "t18_shaft_line": "Shaft-Line Far End",
    "t19_legacy_isolation_gate": "Legacy Solve Gated by Isolation",
    "t20_raw_head_trace": "Raw Head Trace (red boxes only)",
    "t21_red_legacy_ball": "Red Boxes + Legacy Fill + Ball Impact",
    "t22_red_dedup": "Red + Deduped Legacy",
    "t23_red_connected": "Frame Red Box Connected",
}

TESTS: dict[str, type] = {}


def register(cls: type) -> type:
    """Class decorator: `@register` on a ClubTrackingTest implementation."""
    test_id = getattr(cls, "id", None)
    if test_id not in TEST_IDS:
        raise ValueError(f"{cls.__name__}.id {test_id!r} is not a declared test id "
                         f"(valid: {', '.join(TEST_IDS)})")
    if test_id in TESTS:
        raise ValueError(f"test id {test_id!r} already registered "
                         f"by {TESTS[test_id].__name__}")
    TESTS[test_id] = cls
    return cls


def get_test(test_id: str) -> ClubTrackingTest:
    if test_id not in TEST_IDS:
        raise KeyError(f"unknown test id {test_id!r} — valid ids: "
                       f"{', '.join(TEST_IDS)}")
    if test_id not in TESTS:
        raise NotImplementedError(
            f"{test_id} ({TEST_IDS[test_id]}) is declared but not implemented yet — "
            f"see .claude/feature-tracks/club-tracking-test/ for the step that builds it")
    return TESTS[test_id]()


def available() -> list[str]:
    """Implemented test ids, in registration-independent (catalogue) order."""
    return [t for t in TEST_IDS if t in TESTS]
