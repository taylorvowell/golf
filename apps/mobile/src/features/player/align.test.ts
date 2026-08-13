import type { Analysis } from "@swingsage/schema/contract";

import { alignment, alignmentBetween, anchorsOf, type Anchor } from "./align";

/**
 * Two swings at the same place in the swing at once.
 *
 * These run on the **real fixture anchor tables**, not invented ones. `swing1` and `pro_3` differ
 * in length by more than five times — 93 frames of swing against 1267 — which is exactly the case
 * a frame-offset or a time-scale gets wrong while looking plausible on a chart.
 */

// Read off services/analyzer/out/<stem>/analysis.json.
const SWING1: Anchor[] = [
  { p: "P1", frame: 150 },
  { p: "P2", frame: 167 },
  { p: "P3", frame: 183 },
  { p: "P4", frame: 198 },
  { p: "P5", frame: 212 },
  { p: "P6", frame: 219 },
  { p: "P7", frame: 221 },
  { p: "P8", frame: 230 },
  { p: "P9", frame: 234 },
  { p: "P10", frame: 243 },
];

const PRO3: Anchor[] = [
  { p: "P1", frame: 210 },
  { p: "P2", frame: 378 },
  { p: "P3", frame: 523 },
  { p: "P4", frame: 760 },
  { p: "P5", frame: 935 },
  { p: "P6", frame: 1025 },
  { p: "P7", frame: 1060 },
  { p: "P8", frame: 1201 },
  { p: "P9", frame: 1202 },
  { p: "P10", frame: 1477 },
];

it("puts both swings at the top at the same moment", () => {
  // The whole point. P4 is the top; it must map to the other's top exactly, not near it.
  const a = alignment(SWING1, PRO3)!;
  expect(a.at(198)).toBe(760);
  expect(alignment(PRO3, SWING1)!.at(760)).toBe(198);
});

it("maps every shared position onto its own counterpart exactly", () => {
  const a = alignment(SWING1, PRO3)!;
  for (let i = 0; i < SWING1.length; i++) {
    expect(a.at(SWING1[i].frame)).toBe(PRO3[i].frame);
  }
});

it("lands halfway between two positions at halfway between the other's", () => {
  // swing1 P4@198 → P5@212 is 14 frames; frame 205 is the midpoint. pro_3's P4@760 → P5@935 is
  // 175 frames, so the midpoint is 847.5. A frame-offset scheme would answer ~767 here.
  const a = alignment(SWING1, PRO3)!;
  expect(a.at(205)).toBe(848);
});

it("never extrapolates outside the detected swing", () => {
  // Before address and after finish there is only footage — there is no corresponding position,
  // and inventing one is the failure this clamp exists to prevent.
  const a = alignment(SWING1, PRO3)!;
  expect(a.at(0)).toBe(210);
  expect(a.at(149)).toBe(210);
  expect(a.at(9999)).toBe(1477);
});

it("survives a five-fold difference in swing length without drifting", () => {
  // Monotonic and in range across the whole clip — the property a scale-and-offset breaks.
  const a = alignment(SWING1, PRO3)!;
  let prev = -1;
  for (let f = 150; f <= 243; f++) {
    const mapped = a.at(f);
    expect(mapped).toBeGreaterThanOrEqual(prev);
    expect(mapped).toBeGreaterThanOrEqual(210);
    expect(mapped).toBeLessThanOrEqual(1477);
    prev = mapped;
  }
});

it("uses only the positions BOTH swings detected", () => {
  // A position one side never detected cannot anchor anything. With only P1 and P10 shared the
  // map is still valid — it is simply linear across the whole swing.
  const sparse: Anchor[] = [
    { p: "P1", frame: 210 },
    { p: "P10", frame: 1477 },
  ];
  const a = alignment(SWING1, sparse)!;
  expect(a.anchors).toBe(2);
  expect(a.at(150)).toBe(210);
  expect(a.at(243)).toBe(1477);
  // P4 is no longer an anchor, so it interpolates rather than snapping to the other's top.
  expect(a.at(198)).not.toBe(760);
});

it("refuses to align two swings that share fewer than two positions", () => {
  expect(alignment(SWING1, [{ p: "P4", frame: 760 }])).toBeNull();
  expect(alignment(SWING1, [{ p: "PX", frame: 1 }, { p: "PY", frame: 2 }])).toBeNull();
  expect(alignment(SWING1, null)).toBeNull();
  expect(alignment(null, PRO3)).toBeNull();
});

/* ── anchorsOf ─────────────────────────────────────────────────────────────────────────────── */

function artifact(checkpoints: unknown): Analysis {
  return { checkpoints } as unknown as Analysis;
}

it("reads the anchor table off an artifact", () => {
  const a = anchorsOf(artifact([
    { p: "P1", label: "Address", frame: 150 },
    { p: "P4", label: "Top", frame: 198 },
  ]));
  expect(a).toEqual([{ p: "P1", frame: 150 }, { p: "P4", frame: 198 }]);
});

it("rejects a table whose frames do not increase with the position", () => {
  // Ordered by POSITION, not by frame — sorting by frame would order any table into compliance and
  // silently accept a swing whose top was detected before its address. A zero or negative span has
  // no defined fraction across it either.
  expect(anchorsOf(artifact([{ p: "P1", frame: 150 }, { p: "P2", frame: 150 }]))).toBeNull();
  expect(anchorsOf(artifact([{ p: "P1", frame: 150 }, { p: "P2", frame: 149 }]))).toBeNull();
  // Out of order in the array but correct in the swing — that is fine, and must not be rejected.
  expect(anchorsOf(artifact([{ p: "P4", frame: 198 }, { p: "P1", frame: 150 }]))).toEqual([
    { p: "P1", frame: 150 },
    { p: "P4", frame: 198 },
  ]);
  // P10 must sort after P2, not before it as a string compare would have it.
  expect(anchorsOf(artifact([{ p: "P10", frame: 243 }, { p: "P2", frame: 167 }]))).toEqual([
    { p: "P2", frame: 167 },
    { p: "P10", frame: 243 },
  ]);
});

it("treats an artifact with no usable checkpoints as unalignable, not a crash", () => {
  expect(anchorsOf(artifact(null))).toBeNull();
  expect(anchorsOf(artifact(undefined))).toBeNull();
  expect(anchorsOf(artifact([]))).toBeNull();
  expect(anchorsOf(artifact([{ p: "P1", frame: 150 }]))).toBeNull(); // one anchor defines no segment
  expect(anchorsOf(null)).toBeNull();
});

it("skips a checkpoint with no real frame rather than failing the whole table", () => {
  const a = anchorsOf(artifact([
    { p: "P1", frame: 150 },
    { p: "P2", frame: null },
    { p: "P3", frame: Number.NaN },
    { p: "P4", frame: 198 },
  ]));
  expect(a).toEqual([{ p: "P1", frame: 150 }, { p: "P4", frame: 198 }]);
});

it("says an unanalysed reference cannot be aligned", () => {
  // The common real case: the reference swing has no artifact at all.
  expect(alignmentBetween(artifact(SWING1.map((a) => ({ ...a, label: a.p }))), null)).toBeNull();
});
