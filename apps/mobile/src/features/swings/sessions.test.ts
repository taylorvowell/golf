import {
  SESSION_GAP_MS,
  isQuarantined,
  logStats,
  mergeByDay,
  sessionStats,
  sessionize,
  type SessionMeta,
} from "./sessions";
import type { SwingSummary } from "@swingsage/schema/contract";

/**
 * Two groupings live here and both are pinned.
 *
 * The TIME inference — the gap splits, the ordering reads like a range visit (newest session
 * first, swings within it in the order they were hit), `best` ignores unscored swings instead of
 * treating them as zero — is what every swing recorded before session mode still gets.
 *
 * The REAL grouping is by the `sessionId` the capture flow mints, and it has to coexist with the
 * inference in one log rather than replacing it: a golfer's history does not start over when the
 * feature ships. The mixed case is therefore a first-class test, not an edge case.
 */

function swing(id: string, createdAt: number, overallScore: number | null = null): SwingSummary {
  return { id, createdAt, overallScore } as SwingSummary;
}

/** A swing the capture flow minted a session for. */
function inSession(
  id: string,
  createdAt: number,
  sessionId: string,
  overallScore: number | null = null,
): SwingSummary {
  return { id, createdAt, overallScore, sessionId } as SwingSummary;
}

function meta(id: string, sessionType: SessionMeta["sessionType"], name: string | null = null): SessionMeta {
  return { id, name, sessionType };
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

describe("sessionStats (the hero's numbers)", () => {
  it("derives avg/best/start/improvement from scored swings only", () => {
    const [s] = sessionize([
      swing("a", T0, 74),
      swing("b", T0 + 60_000, null),
      swing("c", T0 + 120_000, 91),
      swing("d", T0 + 180_000, 81),
    ]);
    expect(sessionStats(s)).toEqual({ avg: 82, best: 91, start: 74, improvement: 7 });
  });

  it("abstains entirely when nothing scored — never fabricates a zero", () => {
    const [s] = sessionize([swing("a", T0, null)]);
    expect(sessionStats(s)).toEqual({ avg: null, best: null, start: null, improvement: null });
  });

  it("withholds improvement under two scored swings", () => {
    const [s] = sessionize([swing("a", T0, 80)]);
    expect(sessionStats(s).improvement).toBeNull();
  });
});

describe("logStats (the hero's whole-log overview)", () => {
  it("counts every session and swing, and averages scored swings across sessions", () => {
    const sessions = sessionize([
      swing("a", T0 - SESSION_GAP_MS - 60_000, 70),
      swing("b", T0, 85),
      swing("c", T0 + 60_000, null),
    ]);
    expect(logStats(sessions)).toEqual({ sessions: 2, swings: 3, avg: 78, best: 85 });
  });

  it("abstains from avg/best when nothing scored — never fabricates a zero", () => {
    const sessions = sessionize([swing("a", T0, null)]);
    expect(logStats(sessions)).toEqual({ sessions: 1, swings: 1, avg: null, best: null });
  });
});

describe("real session rows", () => {
  it("groups by the minted id, not by time — two sessions minutes apart stay apart", () => {
    // The exact case time inference cannot see: the golfer ended a session and started another
    // without leaving the range, so both sit inside one SESSION_GAP_MS window.
    const sessions = sessionize(
      [
        inSession("a", T0, "s1", 70),
        inSession("b", T0 + 60_000, "s1", 74),
        inSession("c", T0 + 5 * 60_000, "s2", 66),
      ],
      [meta("s1", "swing_analysis"), meta("s2", "swing_analysis")],
    );
    expect(sessions.map((s) => s.id)).toEqual(["s2", "s1"]);
    expect(sessions[1].swings.map((w) => w.id)).toEqual(["a", "b"]);
  });

  it("carries the golfer's name and mode, and abstains when the rows have not loaded", () => {
    const swings = [inSession("a", T0, "s1", 70)];
    const named = sessionize(swings, [meta("s1", "practice_drills", "Wedge day")]);
    expect(named[0].name).toBe("Wedge day");
    expect(named[0].sessionType).toBe("practice_drills");

    // No metadata (offline, or a session row that has not arrived): grouping still holds, but the
    // log says nothing it cannot back up.
    const bare = sessionize(swings);
    expect(bare[0].id).toBe("s1");
    expect(bare[0].name).toBeNull();
    expect(bare[0].sessionType).toBeNull();
  });

  it("sessionizes a log holding both kinds at once", () => {
    const sessions = sessionize(
      [
        swing("old-a", T0 - 3 * SESSION_GAP_MS, 60),
        swing("old-b", T0 - 3 * SESSION_GAP_MS + 60_000, 64),
        inSession("new-a", T0, "s1", 80),
      ],
      [meta("s1", "swing_analysis")],
    );
    expect(sessions.map((s) => s.id)).toEqual(["s1", "old-a"]);
    expect(sessions[1].swings.map((w) => w.id)).toEqual(["old-a", "old-b"]);
  });
});

describe("drills and video-only are quarantined from durable numbers", () => {
  const drills = () =>
    sessionize(
      [inSession("a", T0, "s1", 70), inSession("b", T0 + 60_000, "s1", 90)],
      [meta("s1", "practice_drills")],
    )[0];

  it("names which modes are quarantined", () => {
    expect(isQuarantined({ sessionType: "practice_drills" })).toBe(true);
    expect(isQuarantined({ sessionType: "video_only" })).toBe(true);
    expect(isQuarantined({ sessionType: "swing_analysis" })).toBe(false);
    // A time-inferred session was never declared a drill, so it is not quarantined.
    expect(isQuarantined({ sessionType: null })).toBe(false);
  });

  it("reports no best and no stats — absent, never zero", () => {
    const session = drills();
    expect(session.best).toBeNull();
    expect(sessionStats(session)).toEqual({
      avg: null,
      best: null,
      start: null,
      improvement: null,
    });
  });

  it("still counts in the log's session and swing totals", () => {
    // The golfer showed up and hit balls. Hiding that would make the log claim less practice
    // than they did — quarantine is about AVERAGES, not about existence.
    const sessions = sessionize(
      [
        inSession("a", T0, "s1", 70),
        inSession("b", T0 + 60_000, "s1", 90),
        inSession("c", T0 + 2 * SESSION_GAP_MS, "s2", 80),
      ],
      [meta("s1", "practice_drills"), meta("s2", "swing_analysis")],
    );
    expect(logStats(sessions)).toEqual({ sessions: 2, swings: 3, avg: 80, best: 80 });
  });
});

/**
 * The LOG's grouping is a day, not a session row (Taylor, 2026-08-22).
 *
 * `sessionize` is unchanged — every screen that reasons about a session's mode or its trend point
 * still sees the real rows — and `mergeByDay` is the visual layer over it. What is pinned here is
 * the part that would silently lose data: the merged card must carry EVERY row it stands for in
 * `parts`, because that is what its delete iterates.
 */
describe("mergeByDay", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const morning = new Date(2026, 7, 22, 9, 0, 0).getTime();
  const evening = new Date(2026, 7, 22, 19, 0, 0).getTime();

  it("draws one card for a day the app minted several sessions in", () => {
    const days = mergeByDay(
      sessionize(
        [
          inSession("a", morning, "s1", 70),
          inSession("b", morning + 60_000, "s1", 80),
          inSession("c", evening, "s2", 90),
        ],
        [meta("s1", "swing_analysis"), meta("s2", "swing_analysis")],
      ),
    );

    expect(days).toHaveLength(1);
    expect(days[0].swings.map((s) => s.id)).toEqual(["a", "b", "c"]);
    // Every row the card stands for — the delete iterates this, and a missing id is a session
    // that survives its own deletion.
    expect(days[0].parts.sort()).toEqual(["s1", "s2"]);
    expect(days[0].best).toBe(90);
  });

  it("keeps different days apart, newest first", () => {
    const days = mergeByDay(
      sessionize([swing("old", morning - DAY), swing("new", morning)]),
    );
    expect(days.map((d) => d.swings[0].id)).toEqual(["new", "old"]);
  });

  it("abstains on a name and a mode the day does not agree on", () => {
    const days = mergeByDay(
      sessionize(
        [inSession("a", morning, "s1"), inSession("b", evening, "s2")],
        [meta("s1", "swing_analysis", "Range"), meta("s2", "practice_drills", "Wedges")],
      ),
    );
    expect(days[0].name).toBeNull();
    expect(days[0].sessionType).toBeNull();
  });

  it("leaves a quarantined session out of the day's best", () => {
    const days = mergeByDay(
      sessionize(
        [inSession("a", morning, "s1", 70), inSession("b", evening, "s2", 99)],
        [meta("s1", "swing_analysis"), meta("s2", "practice_drills")],
      ),
    );
    expect(days[0].best).toBe(70);
  });
});
