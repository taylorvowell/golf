import type { CoachReport } from "@swingsage/schema/contract";

import { buildReportViewModel, tempoVerdict } from "./selectors";

/**
 * What is pinned: the mapping's HONESTY. Abstained phases never appear as numbers, an
 * unscored report says so instead of profiling, and the chips are the headline categories,
 * never the dump. Fixture-shaped data, not live artifacts.
 */

function report(over: Partial<CoachReport> = {}): CoachReport {
  return {
    scoring_model_version: "v2",
    club_type: "irons",
    view: "dtl",
    overall: 84.2,
    band: "Solid",
    arc_shift: null,
    coverage: { scored: 18, skipped_this_swing: 4, deferred_in_config: 10, total_checks: 32 },
    categories: {
      balance: {
        category: "balance",
        score: 88.4,
        n_measurable: 5,
        n_total: 6,
        n_deferred: 1,
        checks: [],
      },
      rotation: {
        category: "rotation",
        score: 79.1,
        n_measurable: 4,
        n_total: 5,
        n_deferred: 0,
        checks: [],
      },
      posture: {
        category: "posture",
        score: 72.9,
        n_measurable: 3,
        n_total: 4,
        n_deferred: 1,
        checks: [],
      },
      club: {
        category: "club",
        score: null, // abstained — must never chip
        n_measurable: 0,
        n_total: 3,
        n_deferred: 0,
        checks: [],
      },
    },
    checkpoints: {
      P1: { p: "P1", label: "Setup", score: 89.2, n_measurable: 6 },
      P4: { p: "P4", label: "Top", score: 81.4, n_measurable: 4 },
      P7: { p: "P7", label: "Impact", score: 74.3, n_measurable: 5 },
      P9: { p: "P9", label: "Finish", score: 90.1, n_measurable: 0 }, // abstained
    },
    findings: [
      // Real shape: title = human label, detail = the raw category id (scoring.py).
      { tone: "positive", icon: "✓", title: "Balance held through transition", detail: "balance" },
      { tone: "negative", icon: "↓", title: "Chest closed at impact", detail: "rotation" },
    ],
    priorities: [
      { key: "spine", checkpoint: "P1", label: "Spine angle", score: 60, leverage: 80, cue: "Bend from the hips." },
    ],
    primary: {
      id: "spine_angle",
      checkpoint: "P1",
      title: "More bend from the hips.",
      copy: "You're standing too upright at address.",
      moment: "Address",
      score: 60,
      leverage: 80,
    },
    drill: { title: "", copy: "", dose: "", doseNote: "" },
    ...over,
  };
}

const swing = { label: "7iron-2", view: "dtl", fps: 60, tempoRatio: 3.0 };

it("maps the mockup's slots from real report fields", () => {
  const vm = buildReportViewModel(report(), swing);
  expect(vm.header).toEqual({ title: "7iron-2", meta: "irons · down the line · 60 fps" });
  expect(vm.indicator).toEqual({ band: "Solid", coverage: "18 of 22 checks scored" });
  expect(vm.focus?.issue).toBe("More bend from the hips.");
  expect(vm.board.overall).toBe(84);
  expect(vm.board.strongest).toEqual({ p: "P1", label: "Setup", score: 89 });
  expect(vm.board.weakest).toEqual({ p: "P7", label: "Impact", score: 74 });
  expect(vm.board.tempo).toEqual({ ratio: "3.0:1", verdict: "in range" });
  expect(vm.board.headline).toBe("Strong setup. Impact still leaks points.");
});

it("never turns an abstained phase or category into a number", () => {
  const vm = buildReportViewModel(report(), swing);
  // P9 measured nothing — it must not win "strongest" despite its 90.
  expect(vm.board.strongest?.p).not.toBe("P9");
  // The club category abstained — no chip.
  expect(vm.chips).toEqual(["Balance 88", "Rotation 79", "Posture 73"]);
});

it("says an unscored report is unscored instead of profiling it", () => {
  const vm = buildReportViewModel(
    report({ overall: null, band: null, checkpoints: {} }),
    { ...swing, tempoRatio: null },
  );
  expect(vm.board.overall).toBeNull();
  expect(vm.board.headline).toBe("Not enough measured to profile this swing.");
  expect(vm.board.tempo).toBeNull();
});

it("drops the weakest callout when only one phase measured, not repeats it", () => {
  const vm = buildReportViewModel(
    report({ checkpoints: { P1: { p: "P1", label: "Setup", score: 80, n_measurable: 3 } } }),
    swing,
  );
  expect(vm.board.strongest?.p).toBe("P1");
  expect(vm.board.weakest).toBeNull();
  expect(vm.board.headline).toBe("Setup carries this swing.");
});

it("grades tempo honestly on both sides of the window", () => {
  expect(tempoVerdict(3.0)).toBe("in range");
  expect(tempoVerdict(1.8)).toBe("quick");
  expect(tempoVerdict(4.0)).toBe("slow");
});
