// Legacy club-solution variants — selection logic shared by SwingStage (rendering) and
// the Debug Menu (picking). Extracted when the picker moved out of the video's Overlay
// menu: engineering comparisons live in Debug, the Overlay menu stays a viewer control
// (user directive 2026-08-08).
import type { Analysis } from "@swingsage/schema/contract";

export interface ClubVariantOption {
  key: string;
  label: string;
  cov?: Record<string, number>;
}

export function clubVariantOptions(analysis: Analysis): ClubVariantOption[] {
  const v = analysis.club?.variants;
  const opts: ClubVariantOption[] = [
    { key: "primary", label: "As analysed (primary)", cov: analysis.club?.coverage },
  ];
  if (v) for (const [k, d] of Object.entries(v)) opts.push({ key: k, label: d.label, cov: d.coverage });
  return opts;
}

/**
 * Default solution: `model_traj_measured` only when it measured at least half the swing
 * (the architecture spec's own bar for showing a trace), else the savgol model trace, else primary.
 * Which solve reads best on a detector-starved clip is unanswerable
 * today, so the default is chosen from the artifact, never assumed.
 */
export function defaultClubVar(analysis: Analysis): string {
  const v = analysis.club?.variants;
  const e = analysis.events;
  const measuredFrac = (key: string) => {
    const tf = v?.[key]?.trace_frames;
    if (!tf || !e) return 0;
    const span = Math.max(1, e.impact.frame - e.address.frame + 1);
    return ((tf.backswing?.length ?? 0) + (tf.downswing?.length ?? 0)) / span;
  };
  /**
   * The approved solution: **trajectory-gated head + moving-average trace**, drawn with
   * Savitzky-Golay render smoothing (`traceSmoothing.ts`'s default). User directive 2026-08-08,
   * from an evaluation of 31 candidates — and note it is a solve that evaluation *created*: the
   * artifact previously carried gated-head-with-measured-trace and moving-average-over-ungated-
   * head, never the combination.
   *
   * **Ungated on purpose, and a sparse trace is the correct output, not a fallback condition.**
   * This was re-litigated on 2026-08-12 and the challenge was wrong. `swing1` draws almost no
   * downswing here, which reads as broken beside `primary`'s full cyan arc — but `primary` draws
   * **24 trace points through 24 frames containing ZERO real uninterpolated detections**, while
   * this solve draws 1. The prettier line is 24 fabricated positions. Falling back to it on a
   * coverage bar would make the player assert measurements the detector never made, which is the
   * one thing this product refuses to do; on `pro_2`, where 11 of 16 downswing frames are real
   * detections, this solve draws 12 and the question does not arise.
   *
   * So an empty stretch of trace is a **detector** result to fix upstream — `swing1`'s detector
   * answered 244/396 frames against 90%+ on the other nine — never a reason to change the pick.
   */
  if (v?.model_traj_moving) return "model_traj_moving";
  if (v?.model_traj_measured && measuredFrac("model_traj_measured") >= 0.5) {
    return "model_traj_measured";
  }
  return v?.model_trace_savgol ? "model_trace_savgol" : "primary";
}
