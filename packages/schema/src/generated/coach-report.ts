/* GENERATED from schemas/coach-report.schema.json - do not edit.
 * Run: pnpm --filter @swingsage/schema generate */

/**
 * The deterministic scorecard for one swing — Stage 8's whole output, written as its own artifact rather than folded into `analysis.json`.
 *
 * It is separate on purpose. Stage 8 is a pure function of `analysis.json` plus a versioned `scoring_config`, so a scoring change re-runs `rescore.py` over existing artifacts and never touches the CV contract. `scoring_model_version` is stored on every report so an old report stays reproducible against the config it was scored with.
 *
 * No AI is involved. A narrative model may later replace the wording, but a swing reaches `ready` on this alone.
 */
export interface CoachReport {
  /**
   * Which scoring_config/<version>.json produced these numbers. Thresholds are never hardcoded, so this is what makes an old report reproducible.
   */
  scoring_model_version: string;
  /**
   * Selects club-aware bands. Null when the club was not declared, in which case club-specific checks abstain.
   */
  club_type: "driver" | "irons" | null;
  view: string;
  /**
   * Weighted over the individual measured CHECKS, not an unweighted mean of the category scores — a thin category must not move the headline as much as a broad one. Null when nothing was measurable.
   */
  overall: number | null;
  band: string | null;
  /**
   * No deterministic basis yet — always null. Typed rather than dropped so a future real signal needs no shape change.
   */
  arc_shift: number | null;
  coverage: ScoreCoverage;
  categories: {
    [k: string]: CategoryResult;
  };
  checkpoints: {
    [k: string]: CheckpointScore;
  };
  findings: Finding[];
  priorities: Priority[];
  primary: PrimaryFix;
  drill: Drill;
}
/**
 * How much of the config produced a number for this swing, split by WHY the rest did not. Without this the headline score is unfalsifiable — a reader cannot tell a well-covered 65 from one resting on four checks.
 *
 * This interface was referenced by `CoachReport`'s JSON-Schema
 * via the `definition` "coverage".
 */
export interface ScoreCoverage {
  scored: number;
  /**
   * Skipped for something about THIS clip — wrong club, wrong view, low confidence.
   */
  skipped_this_swing: number;
  /**
   * Abstaining on every swing because the metric behind them is not trustworthy yet. Our gap, not the golfer's — and the two must read differently.
   */
  deferred_in_config: number;
  total_checks: number;
}
/**
 * This interface was referenced by `CoachReport`'s JSON-Schema
 * via the `definition` "category".
 */
export interface CategoryResult {
  category: string;
  score: number | null;
  n_measurable: number;
  /**
   * Checks this config is actually trying to score — deferred ones are excluded, so 'n_measurable of n_total' reads as coverage of a real target.
   */
  n_total: number;
  n_deferred: number;
  checks: CheckResult[];
}
/**
 * This interface was referenced by `CoachReport`'s JSON-Schema
 * via the `definition` "check".
 */
export interface CheckResult {
  id: string;
  label: string;
  category: string;
  weight: number;
  /**
   * The field in `analysis.json.metrics` this check reads — what an overlay needs in order to know which angle to draw.
   */
  field: string;
  fix: string;
  unit: string | null;
  checkpoint: string | null;
  value: number | string | null;
  score: number | null;
  skip_reason: string | null;
  /**
   * Plain-language, DIRECTIONAL 'what to do differently'. Null when the check is already in band or was not measured. Never the technical label.
   */
  advice: string | null;
  /**
   * Severity + impact + ease, equal thirds. Null when unscored.
   */
  leverage: number | null;
  leverage_breakdown: LeverageBreakdown | null;
  effort: number;
  kind: "band" | "categorical";
  /**
   * Null for categorical checks — see `good_values`.
   */
  band: CheckBand | null;
  abs_value: boolean;
  good_values: string[] | null;
  /**
   * The config itself marks this check as not-yet-honestly-measurable, so it abstains on EVERY swing. `skip_reason` alone cannot distinguish that from 'your clip did not support it', and the two mean opposite things to a golfer.
   */
  deferred: boolean;
}
/**
 * This interface was referenced by `CoachReport`'s JSON-Schema
 * via the `definition` "leverageBreakdown".
 */
export interface LeverageBreakdown {
  /**
   * How far off the target this swing measured (100 − score).
   */
  severity: number;
  /**
   * How much this check matters to strike quality, distance and accuracy — the authored causal weight, 1–100.
   */
  impact: number;
  /**
   * How quick a fix this is, inverted from the authored 1 (quick) … 5 (deep pattern change) effort rating onto a 0–100 scale.
   */
  ease: number;
}
/**
 * This interface was referenced by `CoachReport`'s JSON-Schema
 * via the `definition` "checkBand".
 */
export interface CheckBand {
  min: number;
  max: number;
  /**
   * How far past the edge the score decays to zero — every check is a distance from its band with a soft falloff.
   */
  falloff: number;
}
/**
 * This interface was referenced by `CoachReport`'s JSON-Schema
 * via the `definition` "checkpointScore".
 */
export interface CheckpointScore {
  p: string;
  label: string;
  score: number;
  n_measurable: number;
}
/**
 * This interface was referenced by `CoachReport`'s JSON-Schema
 * via the `definition` "finding".
 */
export interface Finding {
  tone: "positive" | "negative";
  icon: string;
  title: string;
  detail: string;
}
/**
 * This interface was referenced by `CoachReport`'s JSON-Schema
 * via the `definition` "priority".
 */
export interface Priority {
  key: string;
  checkpoint: string | null;
  label: string;
  score: number;
  leverage: number;
  cue: string;
}
/**
 * This interface was referenced by `CoachReport`'s JSON-Schema
 * via the `definition` "primaryFix".
 */
export interface PrimaryFix {
  id: string | null;
  checkpoint: string | null;
  title: string;
  copy: string;
  moment: string;
  score: number;
  leverage: number;
}
/**
 * This interface was referenced by `CoachReport`'s JSON-Schema
 * via the `definition` "drill".
 */
export interface Drill {
  title: string;
  copy: string;
  dose: string;
  doseNote: string;
}
