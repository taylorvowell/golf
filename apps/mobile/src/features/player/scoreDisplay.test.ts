import type { CheckResult } from "@swingsage/schema/contract";

import { categoryLabel, describeCheck, scoreBand } from "./scoreDisplay";

/**
 * The phone and the web player must put the same words on the same number.
 *
 * These pin the formatting contract rather than the markup: a golfer who opens the same swing on
 * both surfaces and sees `62.3° (target 35–45°)` on one and `62.3 (35-45)` on the other is looking
 * at a product that disagrees with itself about its own measurement.
 */

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

it("states the measured value against the target it was judged on", () => {
  expect(describeCheck(check())).toBe("62.3° (target 35–45°)");
});

it("renders a categorical check against its accepted values, not a band", () => {
  const c = check({ kind: "categorical", value: "S-posture", good_values: ["neutral"], band: null, unit: null });
  expect(describeCheck(c)).toBe("S-posture (target: neutral)");
});

it("marks an absolute-value band as one, so a negative reading is not read as out of band", () => {
  expect(describeCheck(check({ abs_value: true }))).toBe("62.3° (target |value| 35–45°)");
});

it("prints an em dash for a value that is absent — never a zero", () => {
  expect(describeCheck(check({ value: null }))).toBe("— (target 35–45°)");
});

it("carries a non-degree unit through instead of assuming degrees", () => {
  const c = check({ unit: "cm", value: 12, band: { min: 0, max: 5, falloff: 3 } });
  expect(describeCheck(c)).toBe("12.0cm (target 0–5 cm)");
});

it("turns a category slug into something a golfer reads", () => {
  // `Finding.detail` is a slug, not prose — printing it raw would put an identifier on screen.
  expect(categoryLabel("downswing_plane")).toBe("Downswing & Plane");
});

it("degrades an unknown category to readable text rather than dropping it", () => {
  // A config that adds a category must not make a finding vanish from the panel.
  expect(categoryLabel("wrist_conditions")).toBe("Wrist conditions");
});

it("names bands exactly as the scoring engine does", () => {
  // Mirrors swingsage/scoring.py's BANDS — a disagreement shows a score and a badge that contradict.
  expect(scoreBand(90)).toBe("Elite");
  expect(scoreBand(75)).toBe("Pure");
  expect(scoreBand(60)).toBe("Solid");
  expect(scoreBand(40)).toBe("Building");
  expect(scoreBand(0)).toBe("Reset");
  expect(scoreBand(74.9)).toBe("Solid");
});
