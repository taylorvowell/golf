// Club-tracking experiment catalogue — TS mirror of the analyzer registry.
//
// MIRROR CONTRACT: services/analyzer/tests/test_ts_mirror.py parses THIS file and diffs
// it against swingsage/club_tracking/registry.py (TEST_IDS, available()) and
// pathfit.py (VARIANT_LABELS). Edit ids/labels there first; this file follows. The arrays
// below are data the test regex-extracts — keep them as plain literals.

export const TRACKING_TEST_IDS = [
  "t1_candidate_graph",
  "t2_temporal_heatmap",
  "t3_point_tracking",
  "t4_video_segmentation",
  "t5_blur_flow",
  "t6_grip_kinematic",
  "t7_claude_adjudicated",
  "t8_phase_fusion",
  "t9_forensic_fusion",
  "t10_physics_conic",
  "t11_temporal_densification",
  "t12_av_impact",
  "t13_motion_composite",
  "t14_silhouette_subtract",
  "t15_envelope_graph",
  "t16_ridge_trace",
  "t17_llm_gap_fill",
  "t18_shaft_line",
  "t19_legacy_isolation_gate",
  "t20_raw_head_trace",
  "t21_red_legacy_ball",
  "t22_red_dedup",
  "t23_red_connected",
  "t24_momentum",
  "t25_gated_red_legacy_ball",
] as const;

export type TrackingTestId = (typeof TRACKING_TEST_IDS)[number];

export const TEST_LABELS: Record<TrackingTestId, string> = {
  t1_candidate_graph: "Global Candidate Graph",
  t2_temporal_heatmap: "Club-Specific Temporal Heatmap",
  t3_point_tracking: "Modern Point Tracking",
  t4_video_segmentation: "Video Object Segmentation",
  t5_blur_flow: "Blur + SEA-RAFT + Deblatting",
  t6_grip_kinematic: "Grip-Centered Kinematic Reconstruction",
  t7_claude_adjudicated: "Claude Bounded Adjudication",
  t8_phase_fusion: "Phase-Adaptive Multi-Tracker Fusion",
  t9_forensic_fusion: "Coarse-to-Fine Source-Time Forensic Fusion",
  t10_physics_conic: "Physics-Constrained Conic / Factor-Graph",
  t11_temporal_densification: "Synthetic Temporal Densification",
  t12_av_impact: "Audio-Visual Impact Anchor",
  t13_motion_composite: "Motion Composite / Long-Exposure Envelope",
  t14_silhouette_subtract: "Silhouette-Subtracted Motion",
  t15_envelope_graph: "Envelope-Constrained Candidate Graph",
  t16_ridge_trace: "Motion Ridge Centerline",
  t17_llm_gap_fill: "Confidence-Triaged LLM Gap Fill",
  t18_shaft_line: "Shaft-Line Far End",
  t19_legacy_isolation_gate: "Legacy Solve Gated by Isolation",
  t20_raw_head_trace: "Raw Head Trace (red boxes only)",
  t21_red_legacy_ball: "Red Boxes + Legacy Fill + Ball Impact",
  t22_red_dedup: "Red + Deduped Legacy",
  t23_red_connected: "Frame Red Box Connected",
  t24_momentum: "Momentum",
  t25_gated_red_legacy_ball: "Gated, Red, Legacy, Ball",
};

// Tests with a registered implementation in the analyzer TODAY. Rows outside this set
// render disabled — the registry's NotImplementedError, surfaced honestly in the menu.
export const IMPLEMENTED_TESTS = [
  "t1_candidate_graph",
  "t2_temporal_heatmap",
  "t3_point_tracking",
  "t4_video_segmentation",
  "t5_blur_flow",
  "t6_grip_kinematic",
  "t7_claude_adjudicated",
  "t8_phase_fusion",
  "t9_forensic_fusion",
  "t10_physics_conic",
  "t11_temporal_densification",
  "t12_av_impact",
  "t13_motion_composite",
  "t14_silhouette_subtract",
  "t15_envelope_graph",
  "t16_ridge_trace",
  "t17_llm_gap_fill",
  "t18_shaft_line",
  "t19_legacy_isolation_gate",
  "t20_raw_head_trace",
  "t21_red_legacy_ball",
  "t22_red_dedup",
  "t23_red_connected",
  "t24_momentum",
  "t25_gated_red_legacy_ball",
] as const;

export const VARIANT_IDS = [
  "default", "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l",
] as const;

export type VariantId = (typeof VARIANT_IDS)[number];

export const VARIANT_LABELS: Record<VariantId, string> = {
  default: "Robust global fit",
  a: "Light robust B-spline",
  b: "Strong robust B-spline",
  c: "RTS constant-acceleration",
  d: "Phase Hermite",
  e: "Minimum jerk",
  f: "Bezier-style few-knot fit",
  g: "Centripetal Catmull-Rom",
  h: "Penalized P-spline",
  i: "SG + Catmull-Rom",
  j: "Robust LOWESS",
  k: "Fourier low-pass",
  l: "Total-variation",
};

// Plan §2.2: backswing blue, downswing green. Keyed by the artifact's color_role so the
// renderer maps color from data; the legacy trace palette (skeleton.ts) is untouched.
export const PHASE_COLORS: Record<string, string> = {
  backswing: "#2E9BFF",
  downswing: "#22C55E",
};

// ---- artifact shapes (experiment_store.py, snake_case) ----

export interface ExperimentTracePoint {
  frame: number;
  x: number; // normalized 0-1
  y: number;
  confidence: number;
  mode: "observed" | "mixed" | "inferred";
}

export interface ExperimentPhaseSpan {
  start_frame: number;
  end_frame: number;
  color_role: string;
}

export interface ExperimentEvent {
  frame: number;
  time_s: number;
  confidence: number;
  source: "experiment" | "artifact";
}

export interface ClubTrackingExperiment {
  test: { id: TrackingTestId; label: string; version: string };
  models: Record<string, string>;
  source_timing: {
    nominal_fps: number;
    distinct_observation_count: number;
    has_audio: boolean;
  } | null;
  events: Partial<Record<"address" | "top" | "impact", ExperimentEvent>>;
  trace: {
    display_mode: "continuous" | "split_at_top";
    phase_spans: Record<string, ExperimentPhaseSpan>;
    variants: Partial<Record<VariantId, ExperimentTracePoint[]>>;
  };
  diagnostics: Record<string, number | string>;
}

export interface ClubTrackingBlock {
  schema_version: number;
  experiments: Partial<Record<TrackingTestId, ClubTrackingExperiment>>;
}

export function isImplemented(id: TrackingTestId): boolean {
  return (IMPLEMENTED_TESTS as readonly string[]).includes(id);
}
