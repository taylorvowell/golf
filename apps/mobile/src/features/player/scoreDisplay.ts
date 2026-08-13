import type { CheckResult } from "@swingsage/schema/contract";

/**
 * Pure display helpers over `coach_report.json`. No I/O, no state, no React.
 *
 * Ported from `apps/web/src/lib/scoreDisplay.ts`, which carries the same four exports for the same
 * reason: the phone and the web player must put the same words on the same number, or a golfer who
 * looks at both sees a product disagreeing with itself.
 *
 * **`scoreColor` is deliberately NOT ported.** The web version is a violet→blue→cyan ramp chosen
 * for that page's palette; colour on this surface belongs to Deck, whose one rule is that light
 * comes from above and whose accent is a single acid green. Importing a second colour system into
 * the player would put two unrelated palettes on one slab.
 *
 * Nothing here computes a score. Every number is read from the report — `describeCheck` formats a
 * value that arrived, and `scoreBand` names a band the analyzer already agreed to.
 */

/** "62.3° (target 35–45°)" — the plain-language answer to "how was this determined". */
export function describeCheck(check: CheckResult): string {
  const val =
    typeof check.value === "number"
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

/** The scoring spec's category slugs, in scoring-engine order, mapped onto display labels. */
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

/**
 * A category slug as a golfer should read it.
 *
 * `Finding.detail` carries a **category slug**, not prose — `"downswing_plane"`, not a sentence.
 * Printing it raw would put an identifier in front of a golfer, so every consumer routes through
 * here. An unrecognised slug de-snakes rather than disappearing: a config that adds a category
 * must degrade to something readable, not to nothing.
 */
export function categoryLabel(slug: string): string {
  return (
    CATEGORY_LABELS[slug] ?? slug.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())
  );
}

/**
 * Mirrors `swingsage/scoring.py`'s BANDS exactly — both sides must render the same grade for the
 * same number, or a swing's score and its badge would silently disagree.
 */
const SCORE_BANDS: [number, string][] = [
  [90, "Elite"],
  [75, "Pure"],
  [60, "Solid"],
  [40, "Building"],
  [0, "Reset"],
];

export function scoreBand(score: number): string {
  return (SCORE_BANDS.find(([min]) => score >= min) ?? SCORE_BANDS[SCORE_BANDS.length - 1])[1];
}
