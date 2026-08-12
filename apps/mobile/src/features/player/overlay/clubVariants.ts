/**
 * COPIED VERBATIM from `apps/web/src/lib/clubVariants.ts`. Do not edit one copy alone.
 *
 * Duplicated rather than shared because the only workspace package a phone build already
 * resolves is `@swingsage/schema`, and adding a second one means Metro resolution and a native
 * rebuild to move pure array math. The trigger to un-duplicate is the THIRD consumer, or the
 * first time the two copies are found to have diverged — see D51.
 *
 * It is here because `scripts/checkoverlay.ts` caught the mobile port drawing the PRIMARY club
 * solution while the web player draws a selected variant — two different lines over the same
 * swing, which is the divergence the harness was built to find.
 */
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
  // The player's chosen solution (user directive 2026-08-08): trajectory-gated head with a
  // moving-average trace. Held to the SAME half-the-swing bar as `model_traj_measured` below —
  // this branch was added in front of that one and inherited none of its gate, so a swing the
  // trajectory solve barely measured became the default anyway.
  //
  // What that cost, measured over all ten fixtures: `model_traj_moving` covers 35-94% of the
  // backswing and 0-100% of the downswing, against primary's 96-100% and 100%. On `swing1` it
  // measures **0% of the downswing** and draws a single dashed chord where the swing arc should
  // be — no backswing loop, no downswing at all. Its measured fraction there is 0.28; every other
  // fixture sits at 0.66-0.94, so the bar separates the one broken case and changes nothing else.
  if (v?.model_traj_moving && measuredFrac("model_traj_moving") >= 0.5) {
    return "model_traj_moving";
  }
  if (v?.model_traj_measured && measuredFrac("model_traj_measured") >= 0.5) {
    return "model_traj_measured";
  }
  // Same bar again, for the same reason. Every candidate above is a MODEL-derived solve whose
  // trace exists only where the detector answered; `primary` is the classical solve, which is
  // conservative but always covers the swing. Measured fraction across all ten fixtures:
  //
  //     traj_moving / traj_measured / trace_savgol
  //     nine fixtures   0.61 - 0.94   ->  a model solve, unchanged by this gate
  //     swing1          0.25 - 0.28   ->  primary
  //
  // On swing1 an ungated chain drew a single dashed chord with NO downswing at all, because the
  // trajectory solve measured 0% of it — 90 primary trace points replaced by 19-23 that cannot
  // form a curve. Falling back to a conservative solve that saw the whole swing beats a precise
  // one that saw a quarter of it.
  if (v?.model_trace_savgol && measuredFrac("model_trace_savgol") >= 0.5) {
    return "model_trace_savgol";
  }
  return "primary";
}
