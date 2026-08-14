import { SESSION_GAP_MS, sessionize } from "./sessions";
import type { SwingSummary } from "@swingsage/schema/contract";

/**
 * The grouping is inferred from time until the contract carries a session id, so what is pinned
 * is the inference: the gap splits, the ordering reads like a range visit (newest session first,
 * swings within it in the order they were hit), and `best` ignores unscored swings instead of
 * treating them as zero.
 */

function swing(id: string, createdAt: number, overallScore: number | null = null): SwingSummary {
  return { id, createdAt, overallScore } as SwingSummary;
}

const T0 = 1_760_000_000_000; // an arbitrary epoch-ms anchor

it("splits on the gap and orders newest session first, oldest swing first inside", () => {
  const sessions = sessionize([
    swing("a", T0, 70),
    swing("b", T0 + 10 * 60_000, 75),
    swing("c", T0 + SESSION_GAP_MS + 20 * 60_000, 62),
    swing("d", T0 + SESSION_GAP_MS + 30 * 60_000, 81),
  ]);

  expect(sessions.map((s) => s.swings.map((w) => w.id))).toEqual([
    ["c", "d"],
    ["a", "b"],
  ]);
  expect(sessions[0].best).toBe(81);
  expect(sessions[1].best).toBe(75);
});

it("keeps a slow visit together: each swing extends the session's end", () => {
  // 3 swings, each 90 minutes apart — no adjacent pair crosses the 2h gap, so one session even
  // though first and last are 3 hours apart.
  const sessions = sessionize([
    swing("a", T0),
    swing("b", T0 + 90 * 60_000),
    swing("c", T0 + 180 * 60_000),
  ]);
  expect(sessions).toHaveLength(1);
  expect(sessions[0].swings.map((w) => w.id)).toEqual(["a", "b", "c"]);
});

it("treats unscored swings as absent from best, never as zero", () => {
  const sessions = sessionize([swing("a", T0, null), swing("b", T0 + 60_000, null)]);
  expect(sessions[0].best).toBeNull();
});

it("normalizes second-precision createdAt, so old rows land in the right session", () => {
  const seconds = Math.floor(T0 / 1000);
  const sessions = sessionize([swing("a", seconds, 50), swing("b", T0 + 60_000, 60)]);
  expect(sessions).toHaveLength(1);
});
