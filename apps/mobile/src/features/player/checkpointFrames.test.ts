import type { Analysis } from "@swingsage/schema/contract";

import { checkpointA11yLabel, checkpointTarget } from "./checkpointFrames";

/**
 * The lookup that turns a scorecard row into a place in the video.
 *
 * The bug these tests exist to prevent is a specific one that the types cannot catch:
 * `CheckResult.checkpoint` is a **P-code** (`"P4"`), not one of the eight GolfDB event names, and
 * both are `string | null`. Resolving through `analysis.events` compiles, passes a casual glance,
 * scores fine on eight of ten positions — and silently drops **P6 and P9**, the two the events do
 * not cover. So P6/P9 are pinned here explicitly.
 */

function analysis(checkpoints: unknown): Analysis {
  return { checkpoints } as unknown as Analysis;
}

const TEN = analysis([
  { p: "P1", label: "Address", frame: 150 },
  { p: "P4", label: "Top", frame: 198 },
  { p: "P6", label: "Shaft parallel down", frame: 219 },
  { p: "P7", label: "Impact", frame: 221 },
  { p: "P9", label: "Trail arm parallel", frame: 234 },
  { p: "P10", label: "Finish", frame: 243 },
]);

it("resolves a P-code to the frame the artifact recorded", () => {
  expect(checkpointTarget(TEN, "P4")).toEqual({ p: "P4", label: "Top", frame: 198 });
});

it("resolves P6 and P9 — the two positions the GolfDB events do not cover", () => {
  // Routing this through `analysis.events` would return null for both while looking correct
  // everywhere else. That is the whole reason this module reads `checkpoints`.
  expect(checkpointTarget(TEN, "P6")?.frame).toBe(219);
  expect(checkpointTarget(TEN, "P9")?.frame).toBe(234);
});

it("abstains rather than guessing a nearby frame", () => {
  expect(checkpointTarget(TEN, "P3")).toBeNull(); // a position this report has, this artifact lacks
  expect(checkpointTarget(TEN, null)).toBeNull();
  expect(checkpointTarget(TEN, undefined)).toBeNull();
  expect(checkpointTarget(null, "P1")).toBeNull();
  expect(checkpointTarget(undefined, "P1")).toBeNull();
});

it("treats an artifact with no checkpoints block as 'no tap', not a crash", () => {
  // A native client cannot be force-updated, so an artifact older than the build is permanent
  // reality here rather than a migration away.
  expect(checkpointTarget(analysis(null), "P1")).toBeNull();
  expect(checkpointTarget(analysis(undefined), "P1")).toBeNull();
});

it("refuses a checkpoint whose frame is not a real number", () => {
  const broken = analysis([
    { p: "P1", label: "Address", frame: null },
    { p: "P2", label: "Takeaway", frame: Number.NaN },
  ]);
  expect(checkpointTarget(broken, "P1")).toBeNull();
  expect(checkpointTarget(broken, "P2")).toBeNull();
});

it("names the destination for a screen reader, not the action", () => {
  expect(checkpointA11yLabel({ p: "P7", label: "Impact", frame: 221 })).toBe("Impact, frame 221");
});
