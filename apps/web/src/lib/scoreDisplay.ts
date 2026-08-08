/**
 * The `Scorecard` shape (the scoring spec's Part C1) plus pure, client-safe display helpers.
 *
 * Deliberately separate from `lib/scoring.ts`: that file reads `coach_report.json` off disk
 * (`node:fs`), which is server-only. This file has no I/O at all, so client components
 * (`OverviewView`, `CoachView`, `CriteriaBreakdown` — all `"use client"`) can import `scoreColor`
 * / `CATEGORY_LABELS` / the types here without pulling `fs`, and transitively the Postgres
 * client, into the browser bundle. A prior version of this split them by accident and Next's
 * bundler caught it immediately (`Client Component SSR` chain "./node_modules/postgres/..."):
 * that failure mode is exactly why the split exists, not a hypothetical.
 */
export interface CheckBand {
  min: number;
  max: number;
  falloff: number;
}

export interface LeverageBreakdown {
  /** How far off the target this swing measured (100 - score). */
  severity: number;
  /** How much this check matters to strike quality/distance/accuracy — criteria.md's own
   * causal-weight column, 1-100. */
  impact: number;
  /** How quick a fix this is, inverted from the authored 1 (quick)..5 (deep pattern change)
   * effort rating onto a 0-100 "ease" scale. */
  ease: number;
}

export interface CheckResult {
  id: string;
  label: string;
  category: string;
  weight: number;
  /** The field name in `analysis.json.metrics` this check reads — what a video-overlay needs
   * to know which angle to draw (`SwingStage`'s `angles` prop takes exactly this string). */
  field: string;
  fix: string;
  unit: string | null;
  checkpoint: string | null;
  value: number | string | null;
  score: number | null;
  skip_reason: string | null;
  /** Plain-language, DIRECTIONAL "what to do differently" — null when the check is already in
   * its target band (nothing to fix) or wasn't measured. Never the technical `label`. */
  advice: string | null;
  /** SwingSage's Leverage Score — severity + impact + ease, equal thirds. Null when unscored. */
  leverage: number | null;
  leverage_breakdown: LeverageBreakdown | null;
  /** Authored 1 (quick fix) .. 5 (deep pattern change) — the raw input `leverage_breakdown.ease`
   * is derived from, kept alongside it for a franker "this one's hard" UI note if wanted. */
  effort: number;
  kind: "band" | "categorical";
  /** The target range this check was measured against — null for categorical checks
   * (see `good_values` instead). This is "how it's determined": every check is a distance
   * from this band, with a soft falloff past the edge (`swingsage/scoring.py`). */
  band: CheckBand | null;
  abs_value: boolean;
  good_values: string[] | null;
  /** True when the config itself marks this check as not-yet-honestly-measurable, so it
   * abstains on EVERY swing rather than this one. `skip_reason` alone can't distinguish that
   * from "your clip didn't support it", and the two mean opposite things to a golfer: one is
   * our gap, the other is theirs. Rendered as "not scored yet" rather than "not measured". */
  deferred: boolean;
}

/** "62.3° (target 35–45°)" — the plain-language answer to "how was this determined". */
export function describeCheck(check: CheckResult): string {
  const val = typeof check.value === "number"
    ? `${check.value.toFixed(1)}${check.unit ? check.unit.replace(/^deg$/, "°") : ""}`
    : String(check.value ?? "—");
  if (check.kind === "categorical") {
    return check.good_values ? `${val} (target: ${check.good_values.join(" or ")})` : val;
  }
  if (!check.band) return val;
  const u = check.unit === "deg" ? "°" : check.unit ? ` ${check.unit}` : "";
  const abs = check.abs_value ? "|value| " : "";
  return `${val} (target ${abs}${check.band.min}–${check.band.max}${u})`;
}

export interface CategoryResult {
  category: string;
  score: number | null;
  n_measurable: number;
  /** Checks this config is actually trying to score — deferred ones are excluded, so
   * "n_measurable of n_total" reads as coverage of a real target. */
  n_total: number;
  n_deferred: number;
  checks: CheckResult[];
}

export interface CheckpointScore {
  p: string;
  label: string;
  score: number;
  n_measurable: number;
}

export interface Finding {
  tone: "positive" | "negative";
  icon: string;
  title: string;
  detail: string;
}

export interface Priority {
  key: string;
  checkpoint: string | null;
  label: string;
  score: number;
  leverage: number;
  cue: string;
}

export interface PrimaryFix {
  id: string | null;
  checkpoint: string | null;
  title: string;
  copy: string;
  moment: string;
  score: number;
  leverage: number;
}

export interface Drill {
  title: string;
  copy: string;
  dose: string;
  doseNote: string;
}

export interface ScoreCoverage {
  scored: number;
  /** Skipped for something about THIS clip — wrong club, wrong view, low confidence. */
  skipped_this_swing: number;
  /** Abstaining on every swing because the metric behind them isn't trustworthy yet. */
  deferred_in_config: number;
  total_checks: number;
}

export interface Scorecard {
  scoring_model_version: string;
  club_type: "driver" | "irons" | null;
  view: string;
  overall: number | null;
  band: string | null;
  /** No deterministic basis yet — see services/analyzer/scoring_config/COVERAGE.md. Always
   * null today; kept typed as nullable rather than dropped so a future real signal (or the AI-provider spec's
   * AI narrative) doesn't need a shape change to add it back. */
  arc_shift: number | null;
  /** How much of the config produced a number for this swing, split by why the rest didn't.
   * Without it the headline score is unfalsifiable — a reader can't tell a well-covered 65
   * from one resting on four checks. */
  coverage: ScoreCoverage;
  categories: Record<string, CategoryResult>;
  checkpoints: Record<string, CheckpointScore>;
  findings: Finding[];
  priorities: Priority[];
  primary: PrimaryFix;
  drill: Drill;
}

/** the scoring spec's Part C1's category slugs, in scoring-engine order, mapped onto display labels. */
export const CATEGORY_LABELS: Record<string, string> = {
  setup_posture: "Setup & Posture",
  takeaway: "Takeaway",
  backswing_top: "Backswing & Top",
  transition_tempo: "Transition & Tempo",
  downswing_plane: "Downswing & Plane",
  impact: "Impact",
  follow_through_balance: "Follow-Through & Balance",
};
export const CATEGORY_ORDER = Object.keys(CATEGORY_LABELS);

/** Mirrors `swingsage/scoring.py`'s BANDS exactly — both sides must render the same grade for
 * the same number, or a swing's score and its badge would silently disagree. */
const SCORE_BANDS: [number, string][] = [
  [90, "Elite"], [75, "Pure"], [60, "Solid"], [40, "Building"], [0, "Reset"],
];

export function scoreBand(score: number): string {
  return (SCORE_BANDS.find(([min]) => score >= min) ?? SCORE_BANDS[SCORE_BANDS.length - 1])[1];
}

/** Same ramp `mockScoring.ts` used: violet under 72, blue-ish under 80, acid above. */
export function scoreColor(score: number): string {
  return score < 72 ? "#8b7bff" : score < 80 ? "#6e92ff" : "#5ed0ff";
}
