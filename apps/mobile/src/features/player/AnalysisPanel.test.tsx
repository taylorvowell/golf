import { fireEvent, render } from "@testing-library/react-native";
import type { Analysis, CheckResult, CoachReport } from "@swingsage/schema/contract";

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

/* ── The swing, explained: findings, the checks behind a score, and landing on the frame ────── */

const ARTIFACT = {
  checkpoints: [
    { p: "P1", label: "Address", frame: 150 },
    { p: "P4", label: "Top", frame: 198 },
  ],
} as unknown as Analysis;

function check(over: Partial<CheckResult> = {}): CheckResult {
  return {
    id: "SET-01",
    label: "Spine forward bend",
    category: "setup_posture",
    weight: 1,
    field: "spine_forward_bend",
    fix: "Bend from the hips.",
    unit: "deg",
    checkpoint: "P1",
    value: 62.3,
    score: 41,
    skip_reason: null,
    advice: null,
    leverage: 60,
    leverage_breakdown: null,
    effort: 2,
    kind: "band",
    band: { min: 35, max: 45, falloff: 10 },
    abs_value: false,
    good_values: null,
    deferred: false,
    ...over,
  } as CheckResult;
}

it("renders findings, and shows the category as words rather than a slug", async () => {
  // `Finding.detail` is a category slug. Printing it raw puts `downswing_plane` in front of a
  // golfer — this is the assertion that catches that.
  const { getByText, queryByText } = await render(
    <AnalysisPanel
      state={{
        kind: "ok",
        report: report({
          findings: [
            { tone: "negative", icon: "↓", title: "Lag / wrist angle retention", detail: "downswing_plane" },
            // `✓` is what the config actually emits for a positive finding — pinned because an
            // allow-list built on a guess (`↑`) blanked the mark on every one of them silently.
            { tone: "positive", icon: "✓", title: "Head stability through impact", detail: "impact" },
          ],
        }),
      }}
    />,
  );
  expect(getByText("Lag / wrist angle retention")).toBeTruthy();
  expect(getByText("Head stability through impact")).toBeTruthy();
  expect(getByText("Downswing & Plane")).toBeTruthy();
  expect(queryByText("downswing_plane")).toBeNull();
  expect(getByText("↓")).toBeTruthy();
  expect(getByText("✓")).toBeTruthy();
});

it("seeks the player to the frame a row is about, and gets out of the way", async () => {
  const onSeekToFrame = jest.fn();
  const { getByLabelText } = await render(
    <AnalysisPanel
      state={{ kind: "ok", report: report() }}
      analysis={ARTIFACT}
      onSeekToFrame={onSeekToFrame}
    />,
  );
  // The primary fix is anchored to P1, which this artifact places at frame 150.
  fireEvent.press(getByLabelText("Address, frame 150"));
  expect(onSeekToFrame).toHaveBeenCalledWith(150);
});

it("offers no tap at all when the checkpoint cannot be placed", async () => {
  // Not a disabled-looking control that does nothing, and never a guess at a nearby frame.
  const onSeekToFrame = jest.fn();
  const { queryByLabelText } = await render(
    <AnalysisPanel
      state={{ kind: "ok", report: report({ primary: { ...report().primary, checkpoint: "P8" } }) }}
      analysis={ARTIFACT}
      onSeekToFrame={onSeekToFrame}
    />,
  );
  expect(queryByLabelText(/frame/i)).toBeNull();
});

it("does not offer a tap when the player cannot seek", async () => {
  const { queryByLabelText } = await render(
    <AnalysisPanel state={{ kind: "ok", report: report() }} analysis={ARTIFACT} />,
  );
  expect(queryByLabelText(/frame/i)).toBeNull();
});

it("keeps the two unscored reasons distinct on the individual checks, not just the headline", async () => {
  // The panel would contradict its own coverage line if these merged one level down.
  const { findByText, getByLabelText } = await render(
    <AnalysisPanel
      state={{
        kind: "ok",
        report: report({
          categories: {
            setup_posture: {
              category: "setup_posture",
              score: 69.4,
              n_measurable: 7,
              n_total: 9,
              n_deferred: 1,
              checks: [
                check(),
                check({ id: "SET-02", label: "Hip rotation", score: null, value: null, deferred: true, skip_reason: "no rotation estimate" }),
                check({ id: "SET-03", label: "Knee flex", score: null, value: null, deferred: false, skip_reason: "confidence below threshold" }),
              ],
            },
          },
        }),
      }}
    />,
  );
  // Async queries throughout: this root flushes a press-driven re-render on a microtask, so a
  // synchronous getBy* here reads the pre-press tree and fails on a panel that is working.
  fireEvent.press(getByLabelText(/^Setup & Posture, scored/));
  expect(await findByText("62.3° (target 35–45°)")).toBeTruthy();
  expect(await findByText(/^Not scored yet — no rotation estimate$/)).toBeTruthy();
  expect(await findByText(/^Not measured on this clip — confidence below threshold$/)).toBeTruthy();
});

it("keeps the checks behind a score collapsed until asked", async () => {
  // The panel opens as a summary, not a spreadsheet.
  const categories = {
    setup_posture: {
      category: "setup_posture",
      score: 69.4,
      n_measurable: 7,
      n_total: 9,
      n_deferred: 0,
      checks: [check()],
    },
  };
  const { findByText, getByLabelText, queryByText } = await render(
    <AnalysisPanel state={{ kind: "ok", report: report({ categories }) }} />,
  );
  expect(queryByText("Spine forward bend")).toBeNull();
  fireEvent.press(getByLabelText(/^Setup & Posture, scored/));
  expect(await findByText("Spine forward bend")).toBeTruthy();
});

it("shows a position with nothing measurable as abstained, never as a zero", async () => {
  const { getByText } = await render(
    <AnalysisPanel
      state={{
        kind: "ok",
        report: report({
          checkpoints: {
            P1: { p: "P1", label: "Address", score: 62.3, n_measurable: 6 },
            P5: { p: "P5", label: "Early downswing", score: 0, n_measurable: 0 },
          },
        }),
      }}
    />,
  );
  expect(getByText("62")).toBeTruthy();
  expect(getByText("—")).toBeTruthy();
});
