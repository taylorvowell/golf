import type { Analysis } from "@swingsage/schema/contract";

import {
  alignment,
  alignmentBetween,
  alignmentResult,
  anchorsOf,
  type Anchor,
} from "./align";

/**
 * Two swings at the same place in the swing at once.
 *
 * These run on the **real fixture anchor tables**, confidences included, not invented ones.
 * `swing1` and `pro_3` differ in length by more than five times — 93 frames of swing against 1267 —
 * which is exactly the case a frame-offset or a time-scale gets wrong while looking plausible on a
 * chart. `7wood-1` is here because it is the table that broke the first version: ten rows, strictly
 * increasing, and seven of them fabricated.
 */

// Read off services/analyzer/out/<stem>/analysis.json — frame AND conf, because the confidence is
// now load-bearing and a table of round numbers would test a rule that does not exist.
const SWING1: Anchor[] = [
  { p: "P1", frame: 150, conf: 0.6 },
  { p: "P2", frame: 167, conf: 0.8 },
  { p: "P3", frame: 183, conf: 0.94 },
  { p: "P4", frame: 198, conf: 0.35 },
  { p: "P5", frame: 212, conf: 0.95 },
  { p: "P6", frame: 219, conf: 0.5 },
  { p: "P7", frame: 221, conf: 0.98 },
  { p: "P8", frame: 230, conf: 0.8 },
  { p: "P9", frame: 234, conf: 0.9 },
  { p: "P10", frame: 243, conf: 0.75 },
];

const PRO3: Anchor[] = [
  { p: "P1", frame: 210, conf: 0.75 },
  { p: "P2", frame: 378, conf: 0.8 },
  { p: "P3", frame: 523, conf: 0.95 },
  { p: "P4", frame: 760, conf: 0.6 },
  { p: "P5", frame: 935, conf: 0.4 },
  { p: "P6", frame: 1025, conf: 0.8 },
  { p: "P7", frame: 1060, conf: 0.7 },
  { p: "P8", frame: 1201, conf: 0.4 },
  { p: "P9", frame: 1202, conf: 0.9 },
  { p: "P10", frame: 1477, conf: 0.6 },
];

/** `services/analyzer/out/7wood-1` verbatim. P4–P10 are the ordering nudge, not positions. */
const WOOD7 = [
  { p: "P1", frame: 236, conf: 0.9 },
  { p: "P2", frame: 266, conf: 0.8 },
  { p: "P3", frame: 342, conf: 0.95 },
  { p: "P4", frame: 343, conf: 0.35 },
  { p: "P5", frame: 344, conf: 0.35 },
  { p: "P6", frame: 345, conf: 0.3 },
  { p: "P7", frame: 346, conf: 0.35 },
  { p: "P8", frame: 347, conf: 0.35 },
  { p: "P9", frame: 348, conf: 0.3 },
  { p: "P10", frame: 349, conf: 0.35 },
];

function artifact(checkpoints: unknown, extra: Record<string, unknown> = {}): Analysis {
  return { checkpoints, ...extra } as unknown as Analysis;
}

/* ── the map ───────────────────────────────────────────────────────────────────────────────── */

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

it("uses only the positions BOTH swings admitted", () => {
  // A position one side never detected cannot anchor anything. With only P1 and P7 shared the map
  // is still valid — it is simply linear from address to impact.
  const sparse: Anchor[] = [
    { p: "P1", frame: 210, conf: 0.9 },
    { p: "P7", frame: 1060, conf: 0.9 },
  ];
  const a = alignment(SWING1, sparse)!;
  expect(a.anchors).toBe(2);
  expect(a.positions).toEqual(["P1", "P7"]);
  expect(a.at(150)).toBe(210);
  expect(a.at(221)).toBe(1060);
  // P4 is no longer an anchor, so it interpolates rather than snapping to the other's top.
  expect(a.at(198)).not.toBe(760);
});

/* ── grading ───────────────────────────────────────────────────────────────────────────────── */

it("calls a densely shared swing aligned and a sparse one approximate", () => {
  expect(alignment(SWING1, PRO3)!.quality).toBe("aligned");

  // Three shared positions, and none of them the takeaway: the map holds at the anchors and is a
  // straight line for the long stretches between, which is not the same claim.
  const sparse: Anchor[] = [
    { p: "P4", frame: 760, conf: 0.9 },
    { p: "P7", frame: 1060, conf: 0.9 },
    { p: "P10", frame: 1477, conf: 0.9 },
  ];
  expect(alignment(SWING1, sparse)!.quality).toBe("approximate");
});

it("refuses a pair with nothing anchored at or after impact", () => {
  // Everything a golfer studies is after the top. Without an anchor past it the whole downswing is
  // extrapolation, and drawing it at the same confidence as the rest is the failure being avoided.
  const backswingOnly: Anchor[] = [
    { p: "P1", frame: 210, conf: 0.9 },
    { p: "P2", frame: 378, conf: 0.9 },
    { p: "P4", frame: 760, conf: 0.9 },
  ];
  expect(alignmentResult(SWING1, backswingOnly)).toEqual({
    ok: false,
    reason: "impact-uncovered",
  });
});

it("refuses to align two swings that share fewer than two positions", () => {
  expect(alignmentResult(SWING1, [{ p: "P4", frame: 760, conf: 0.9 }])).toEqual({
    ok: false,
    reason: "too-few-shared",
  });
  expect(
    alignmentResult(SWING1, [
      { p: "PX", frame: 1, conf: 1 },
      { p: "PY", frame: 2, conf: 1 },
    ]),
  ).toEqual({ ok: false, reason: "too-few-shared" });
  expect(alignmentResult(SWING1, null)).toEqual({ ok: false, reason: "no-anchors" });
  expect(alignmentResult(null, PRO3)).toEqual({ ok: false, reason: "no-anchors" });
});

/* ── anchorsOf: admission ──────────────────────────────────────────────────────────────────── */

it("reads the anchor table off an artifact", () => {
  const a = anchorsOf(
    artifact([
      { p: "P1", label: "Address", frame: 150, conf: 0.9 },
      { p: "P4", label: "Top", frame: 198, conf: 0.6 },
    ]),
  );
  expect(a).toEqual([
    { p: "P1", frame: 150, conf: 0.9 },
    { p: "P4", frame: 198, conf: 0.6 },
  ]);
});

it("throws out the seven fabricated rows in 7wood-1 and keeps the three real ones", () => {
  // The table that broke the first version: strictly increasing, ten rows, and P4–P10 stacked into
  // eight consecutive frames by the ordering nudge. Taking all ten mapped the whole downswing onto
  // a single instant while reporting ten healthy anchors.
  expect(anchorsOf(artifact(WOOD7))!.map((a) => a.p)).toEqual(["P1", "P2", "P3"]);
});

it("will not compare a swing whose impact was never really found", () => {
  // The consequence of the above, and the behaviour that matters: 7wood-1 has nothing admitted at
  // or after impact, so it does not get a quietly wrong comparison — it gets a refusal.
  expect(alignmentBetween(artifact(WOOD7), artifact(SWING1))).toEqual({
    ok: false,
    reason: "impact-uncovered",
  });
});

it("drops the analyzer's own admitted proxies", () => {
  // `proxy: midpoint of P5 -> impact` and `no span between P8 and the finish` both publish at 0.30,
  // just under the contract's confidence floor. They carry no information their neighbours do not
  // already carry, and anchoring on one pins the map to a frame nobody measured.
  const a = anchorsOf(
    artifact([
      { p: "P5", frame: 100, conf: 0.95, basis: "events.mid_downswing" },
      { p: "P6", frame: 110, conf: 0.3, basis: "proxy: midpoint of P5 -> impact" },
      { p: "P7", frame: 120, conf: 0.98, basis: "events.impact" },
    ]),
  );
  expect(a!.map((x) => x.p)).toEqual(["P5", "P7"]);
});

it("keeps a tight gap the analyzer stands behind", () => {
  // A fast swing genuinely puts impact one frame before mid-follow-through (7wood-2, conf 0.98) and
  // a tour finish one frame after P9 (pro_3, conf 0.90). Rejecting on the gap alone would throw
  // away the best anchors in the table — it takes a low confidence AND a tight gap to be a nudge.
  const a = anchorsOf(
    artifact([
      { p: "P6", frame: 310, conf: 0.8 },
      { p: "P7", frame: 320, conf: 0.98 },
      { p: "P8", frame: 321, conf: 0.7 },
    ]),
  );
  expect(a!.map((x) => x.p)).toEqual(["P6", "P7", "P8"]);
});

it("drops Impact when the audio witness contradicts it, and never moves it", () => {
  // The heard strike carries 121–148 ms of unmeasured recording latency — nine frames at 60fps —
  // so it can veto the video's answer but must never become the answer.
  const table = [
    { p: "P1", frame: 100, conf: 0.9 },
    { p: "P4", frame: 160, conf: 0.9 },
    { p: "P7", frame: 200, conf: 0.98 },
    { p: "P10", frame: 240, conf: 0.8 },
  ];
  const disputed = anchorsOf(artifact(table, { audio_impact: { frame: 160, agrees: false } }));
  expect(disputed!.map((a) => a.p)).toEqual(["P1", "P4", "P10"]);
  expect(disputed!.every((a) => a.frame !== 160 || a.p === "P4")).toBe(true);

  // Agreement is not evidence against anything, and neither is a clip with no audio at all.
  expect(anchorsOf(artifact(table, { audio_impact: { frame: 198, agrees: true } }))!).toHaveLength(4);
  expect(anchorsOf(artifact(table, { audio_impact: null }))!).toHaveLength(4);
});

it("rejects a table whose frames do not increase with the position", () => {
  // Ordered by POSITION, not by frame — sorting by frame would order any table into compliance and
  // silently accept a swing whose top was detected before its address. Checked on the RAW table
  // too: dropping the offending row would repair the symptom and keep the broken swing.
  expect(anchorsOf(artifact([{ p: "P1", frame: 150, conf: 1 }, { p: "P2", frame: 150, conf: 1 }]))).toBeNull();
  expect(anchorsOf(artifact([{ p: "P1", frame: 150, conf: 1 }, { p: "P2", frame: 149, conf: 1 }]))).toBeNull();
  // Out of order in the array but correct in the swing — that is fine, and must not be rejected.
  expect(anchorsOf(artifact([{ p: "P4", frame: 198, conf: 1 }, { p: "P1", frame: 150, conf: 1 }]))).toEqual([
    { p: "P1", frame: 150, conf: 1 },
    { p: "P4", frame: 198, conf: 1 },
  ]);
  // P10 must sort after P2, not before it as a string compare would have it.
  expect(anchorsOf(artifact([{ p: "P10", frame: 243, conf: 1 }, { p: "P2", frame: 167, conf: 1 }]))).toEqual([
    { p: "P2", frame: 167, conf: 1 },
    { p: "P10", frame: 243, conf: 1 },
  ]);
});

it("treats an artifact with no usable checkpoints as unalignable, not a crash", () => {
  expect(anchorsOf(artifact(null))).toBeNull();
  expect(anchorsOf(artifact(undefined))).toBeNull();
  expect(anchorsOf(artifact([]))).toBeNull();
  expect(anchorsOf(artifact([{ p: "P1", frame: 150, conf: 1 }]))).toBeNull(); // one anchor, no segment
  expect(anchorsOf(null)).toBeNull();
});

it("skips a checkpoint with no real frame rather than failing the whole table", () => {
  const a = anchorsOf(
    artifact([
      { p: "P1", frame: 150, conf: 1 },
      { p: "P2", frame: null, conf: 1 },
      { p: "P3", frame: Number.NaN, conf: 1 },
      { p: "P4", frame: 198, conf: 1 },
    ]),
  );
  expect(a).toEqual([
    { p: "P1", frame: 150, conf: 1 },
    { p: "P4", frame: 198, conf: 1 },
  ]);
});

it("takes a hand-built table with no confidences at face value", () => {
  // A pared-down fixture is not a low-confidence detection, and scoring an absent field as zero
  // would make every such table unalignable.
  const a = anchorsOf(artifact([{ p: "P1", frame: 10 }, { p: "P7", frame: 40 }]));
  expect(a).toEqual([
    { p: "P1", frame: 10, conf: 1 },
    { p: "P7", frame: 40, conf: 1 },
  ]);
});

it("says an unanalysed reference cannot be aligned", () => {
  // The common real case: the reference swing has no artifact at all.
  expect(alignmentBetween(artifact(SWING1), null)).toEqual({ ok: false, reason: "no-anchors" });
});
