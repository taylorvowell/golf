import { expect, it } from "vitest";
import type { Analysis } from "@swingsage/schema/contract";

import { defaultClubVar } from "./clubVariants";

/**
 * Which club solution the player draws, and why a SPARSE trace must not change it.
 *
 * The approved pick is `model_traj_moving` — trajectory-gated head, moving-average trace, drawn
 * with Savitzky-Golay render smoothing — chosen on 2026-08-08 from an evaluation of 31 candidates.
 * It is deliberately ungated, and this file exists because that looks like a bug and is not.
 *
 * On `swing1` it draws almost no downswing, which reads as broken next to `primary`'s full arc.
 * But `swing1`'s downswing contains **zero real uninterpolated detections in either solve**:
 * `primary` draws 24 trace points through those 24 frames anyway, this solve draws 1. The prettier
 * line is 24 fabricated positions. A coverage-based fallback to it would make the player assert
 * measurements the detector never made — so the gate that was briefly added here on 2026-08-12 was
 * removed again, and these are the assertions that keep it removed.
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

it("draws the approved solve: trajectory-gated head with a moving-average trace", () => {
  expect(defaultClubVar(analysis({ model_traj_moving: HEALTHY }))).toBe("model_traj_moving");
});

it("KEEPS it on a swing the detector barely measured, rather than reaching for a fuller line", () => {
  // The whole point. A sparse trace on a detector-starved clip is the honest output; the fuller
  // alternative is drawing through frames nothing was detected in. Changing this is a decision to
  // argue, not a tidy-up — see the comment on `defaultClubVar`.
  expect(defaultClubVar(analysis({ model_traj_moving: STARVED }))).toBe("model_traj_moving");
});

it("still gates the OLDER measured-trace preference, which was never the approved pick", () => {
  expect(
    defaultClubVar(analysis({ model_traj_measured: STARVED, model_trace_savgol: HEALTHY })),
  ).toBe("model_trace_savgol");
  expect(defaultClubVar(analysis({ model_traj_measured: HEALTHY }))).toBe("model_traj_measured");
});

it("is primary on a swing with no variants at all", () => {
  expect(defaultClubVar({ club: null } as unknown as Analysis)).toBe("primary");
});
