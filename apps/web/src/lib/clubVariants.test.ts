import { expect, it } from "vitest";
import type { Analysis } from "@swingsage/schema/contract";

import { defaultClubVar } from "./clubVariants";

/**
 * Which club solution the player draws by default.
 *
 * This has a bug in its history and the bug was invisible: `model_traj_moving` was added at the
 * FRONT of the chain and inherited none of the half-the-swing gate the branch below it already
 * had, so a swing the trajectory solve barely measured became the default anyway. On `swing1` that
 * drew a single dashed chord with **no downswing at all** — the trajectory solve measured 0% of it
 * — where the classical `primary` solve has 90 points at 100% coverage.
 *
 * Nothing went red. Coverage percentages looked healthy. It is the third time in this project's
 * history that a club number looked fine and the drawn result did not, which is why the rule is to
 * look at the club over real pixels (`scripts/checkoverlay.ts`, RUNBOOK §12a) rather than at a
 * coverage figure.
 */

function analysis(variants: Record<string, { back: number; down: number }>): Analysis {
  const frames = (n: number, from: number) => Array.from({ length: n }, (_, i) => from + i * 2);
  return {
    events: { address: { frame: 0 }, impact: { frame: 99 } },
    club: {
      variants: Object.fromEntries(
        Object.entries(variants).map(([k, v]) => [
          k,
          {
            label: k,
            trace_frames: { backswing: frames(v.back, 0), downswing: frames(v.down, 50) },
          },
        ]),
      ),
    },
  } as unknown as Analysis;
}

/** The swing spans 100 frames, so N trace frames is N% of it. */
const HEALTHY = { back: 40, down: 40 }; // 0.80
const STARVED = { back: 15, down: 13 }; // 0.28 — swing1's real figure

it("prefers the trajectory-gated solve when it measured the swing", () => {
  expect(defaultClubVar(analysis({ model_traj_moving: HEALTHY }))).toBe("model_traj_moving");
});

it("refuses a solve that measured less than half the swing", () => {
  // The bar is the architecture spec's own for showing a trace at all. A precise solve that saw a
  // quarter of the swing is worse than a conservative one that saw all of it.
  expect(defaultClubVar(analysis({ model_traj_moving: STARVED }))).toBe("primary");
});

it("falls all the way through when every model solve is starved", () => {
  // swing1's real shape: all three model candidates sit at 0.25-0.28 together, because they share
  // the detections. Gating only the first one lands on the second, which is just as empty.
  expect(
    defaultClubVar(
      analysis({
        model_traj_moving: STARVED,
        model_traj_measured: STARVED,
        model_trace_savgol: STARVED,
      }),
    ),
  ).toBe("primary");
});

it("takes the next candidate when only the first is starved", () => {
  expect(
    defaultClubVar(analysis({ model_traj_moving: STARVED, model_traj_measured: HEALTHY })),
  ).toBe("model_traj_measured");
});

it("is primary on a swing with no variants at all", () => {
  expect(defaultClubVar({ club: null } as unknown as Analysis)).toBe("primary");
});
