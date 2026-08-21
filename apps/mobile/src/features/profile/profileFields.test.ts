import type { GolferProfilePrivate } from "@swingsage/schema/contract";

import { PROFILE_FIELDS, displayValue } from "./profileFields";

/**
 * The profile registry's promises, pinned:
 *  - a tile's display string is golfer language, never an enum spelling;
 *  - an unanswered field is null (the tile draws the empty state, never a default);
 *  - the asking surface is EXACTLY six questions (Taylor, 2026-08-20) — a question creeping
 *    back in here without its column is the drift this test exists to catch.
 */

const EMPTY: GolferProfilePrivate = {};

describe("the asking surface is exactly six questions", () => {
  it("asks the six, in order, and nothing else", () => {
    expect(PROFILE_FIELDS.map((f) => f.key)).toEqual([
      "handedness",
      "selfReportedStyle",
      "handicapRange",
      "ageRange",
      "driverSwingSpeedMph",
      "sevenIronCarryYds",
    ]);
  });
});

describe("displayValue", () => {
  it("answers in golfer language, never enum spellings", () => {
    const priv: GolferProfilePrivate = {
      handedness: "left",
      selfReportedStyle: "sty_01",
      handicapRange: "scratch_5",
      ageRange: "30_39",
      driverSwingSpeedMph: 95,
      sevenIronCarryYds: 150,
    };
    const shown = PROFILE_FIELDS.map((f) => displayValue(f, priv));
    expect(shown).toEqual([
      "Left-handed",
      "Rotational",
      "Scratch–5",
      "30–39",
      "95 mph",
      "150 yds",
    ]);
  });

  it("an unanswered field is null", () => {
    for (const field of PROFILE_FIELDS) {
      expect(displayValue(field, EMPTY)).toBeNull();
    }
  });
});
