import { render } from "@testing-library/react-native";
import type { CoachReport } from "@swingsage/schema/contract";

import { AnalysisPanel } from "./AnalysisPanel";

/**
 * The scorecard, and the honesty rules attached to it.
 *
 * **A score alone is a product failure.** The headline must arrive with how much of the config
 * produced it, because `65 from 41 of 58 checks` and `65 from 6 of 58` are different claims about
 * the same number — and the two reasons a check did not score mean opposite things: *skipped for
 * this swing* is about the clip, *deferred* is the config refusing to score a metric it does not
 * trust yet. Collapsing them would report our gap as the golfer's.
 *
 * The other rule is that **not-scored is a state, not an error**: a swing analysed with
 * `--no-scoring` still plays, still draws its overlays, and must say it has no scorecard rather
 * than show a zero.
 */

function report(over: Partial<CoachReport> = {}): CoachReport {
  return {
    scoring_model_version: "v2",
    club_type: "irons",
    view: "dtl",
    overall: 69.8,
    band: "Solid",
    arc_shift: null,
    coverage: { scored: 41, skipped_this_swing: 9, deferred_in_config: 8, total_checks: 58 },
    categories: {
      setup_posture: {
        category: "setup_posture",
        score: 69.4,
        n_measurable: 7,
        n_total: 9,
        n_deferred: 0,
        checks: [],
      },
      impact: { category: "impact", score: null, n_measurable: 0, n_total: 6, n_deferred: 0, checks: [] },
    },
    checkpoints: {},
    findings: [],
    priorities: [],
    primary: {
      id: "SET-01",
      checkpoint: "P1",
      title: "Bend forward more from the hips at address",
      copy: "Hip hinge, club-on-spine drill.",
      moment: "setup_posture",
      score: 0,
      leverage: 83.3,
    },
    drill: { title: "Hip hinge drill", copy: "Club on spine.", dose: "3 x 5", doseNote: "slow rehearsals" },
    ...over,
  } as CoachReport;
}

it("prints how much of the config produced the headline, next to the headline", async () => {
  const { getByText } = await render(<AnalysisPanel state={{ kind: "ok", report: report() }} />);
  expect(getByText("70")).toBeTruthy();
  expect(getByText("from 41 of 58 checks")).toBeTruthy();
});

it("keeps 'not measurable on this clip' apart from 'not trustworthy yet'", async () => {
  // One is about the golfer's video; the other is our gap. A single "17 not scored" would report
  // the second as the first.
  const { getByText } = await render(<AnalysisPanel state={{ kind: "ok", report: report() }} />);
  expect(getByText(/9 could not be measured on this clip/)).toBeTruthy();
  expect(getByText(/8 are not yet trustworthy enough to score/)).toBeTruthy();
});

it("shows a category with nothing measurable as not scored, never as zero", async () => {
  const { getByText } = await render(<AnalysisPanel state={{ kind: "ok", report: report() }} />);
  expect(getByText("not scored")).toBeTruthy();
  expect(getByText("0 of 6 measured")).toBeTruthy();
});

it("leads with the one fix worth making first", async () => {
  const { getByText } = await render(<AnalysisPanel state={{ kind: "ok", report: report() }} />);
  expect(getByText("Work on this first")).toBeTruthy();
  expect(getByText("Bend forward more from the hips at address")).toBeTruthy();
  expect(getByText("Hip hinge drill")).toBeTruthy();
});

it("says a swing has no scorecard rather than showing it a zero", async () => {
  const { getByText, queryByText } = await render(<AnalysisPanel state={{ kind: "not-scored" }} />);
  expect(getByText(/has not been scored/i)).toBeTruthy();
  expect(queryByText("0")).toBeNull();
});

it("separates a missing scorecard from a connection failure", async () => {
  // Only one of the two is fixed by trying again, and a golfer told the wrong one acts on it.
  const { getByText } = await render(<AnalysisPanel state={{ kind: "unreachable" }} />);
  expect(getByText(/connection problem/i)).toBeTruthy();
});
