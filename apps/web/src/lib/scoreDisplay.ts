import type { CheckResult } from "@swingsage/schema/contract";

/**
 * Pure, client-safe display helpers over `coach_report.json`.
 *
 * Deliberately separate from `lib/scoring.ts`: that file reads the artifact through `lib/media`,
 * which is server-only. This file has no I/O at all, so client components (`OverviewView`,
 * `CoachView`, `CriteriaBreakdown` — all `"use client"`) can import `scoreColor` /
 * `CATEGORY_LABELS` without pulling the Postgres client into the browser bundle. A prior version
 * split them by accident and Next's bundler caught it immediately (`Client Component SSR` chain
 * "./node_modules/postgres/..."): that failure mode is why the split exists, not a hypothetical.
 *
 * The SHAPES it describes are gone from here as of step 07 — `CheckResult`, `CategoryResult` and
 * the rest are generated from `coach-report.schema.json`, which the analyzer validates its output
 * against. `@swingsage/schema/contract` carries no validator, so importing it from a client
 * component costs nothing at runtime.
 */

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
