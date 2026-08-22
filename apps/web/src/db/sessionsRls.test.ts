import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SessionError, createSession, listSessions, updateSession } from "../lib/sessions";
import { endAppPool, withUser } from "./session";

/**
 * The session boundary and the type lock, both proved through the connection the product
 * actually serves requests on.
 *
 * Two different kinds of rule are checked here on purpose, because they fail in different ways
 * and each would look fine without the other:
 *
 *   1. **Whose session is it.** Row-level security decides — `sessions_write` is owner-only and
 *      `sessions_select` is owner-or-approved-coach. Asserted through `withUser` plus the real
 *      `lib/sessions` functions rather than hand-rolled SQL, so a route that forgets a `where`
 *      clause is still caught: the policy is the backstop, not the check.
 *   2. **A session's type locks once it has swings.** That one is application logic, not a
 *      policy, and it protects a claim about a golfer's history — flipping a finished session
 *      to `practice_drills` would retroactively quarantine swings they hit as analysis.
 *
 * FAILS rather than skips without a database, like every db suite here: a boundary test that
 * silently skips still reports green. `docker compose up -d` then `pnpm --filter web db:migrate`.
 */

const GOLFER_A = "cccccccc-0000-4000-8000-000000000001";
const GOLFER_B = "cccccccc-0000-4000-8000-000000000002";
const COACH_C = "cccccccc-0000-4000-8000-000000000003";
const SWING_A = "cccccccc-1111-4000-8000-000000000001";

/** The OWNER connection — fixtures and swing attachment only, never an assertion. */
let owner: postgres.Sql;

beforeAll(async () => {
  expect(
    process.env.DATABASE_URL,
    "DATABASE_URL is not set — needed to create this suite's fixtures. Run `docker compose up -d`.",
  ).toBeTruthy();
  expect(
    process.env.APP_DATABASE_URL,
    "APP_DATABASE_URL is not set. This suite proves the session routes obey row-level security, " +
      "so it cannot be skipped. Run `pnpm --filter web db:migrate`.",
  ).toBeTruthy();

  owner = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });

  await owner`
    insert into auth.users (id, email) values
      (${GOLFER_A}, 'sess-a@test.local'),
      (${GOLFER_B}, 'sess-b@test.local'),
      (${COACH_C},  'sess-c@test.local')
    on conflict (id) do nothing
  `;
  await owner`
    insert into public.users (id, email, display_name) values
      (${GOLFER_A}, 'sess-a@test.local', 'Session Golfer A'),
      (${GOLFER_B}, 'sess-b@test.local', 'Session Golfer B'),
      (${COACH_C},  'sess-c@test.local', 'Session Coach C')
    on conflict (id) do nothing
  `;
  // An APPROVED coach, so "a coach can read but still cannot rename" is a real case rather
  // than a stranger being denied.
  await owner`
    insert into public.coach_links (golfer_id, coach_id, status)
    values (${GOLFER_A}, ${COACH_C}, 'approved')
    on conflict (golfer_id, coach_id) do update set status = 'approved'
  `;
});

afterAll(async () => {
  if (owner) {
    await owner`delete from public.swings where id = ${SWING_A}`;
    await owner`delete from auth.users where id in (${GOLFER_A}, ${GOLFER_B}, ${COACH_C})`;
    await owner.end();
  }
  await endAppPool();
});

const mint = (userId: string, input: Parameters<typeof createSession>[2] = {}) =>
  withUser(userId, (tx) => createSession(tx, userId, input));

/** Attach the suite's one swing to `sessionId`, from the owner connection. */
async function attachSwing(sessionId: string): Promise<void> {
  await owner`
    insert into public.swings (id, user_id, session_id, handedness)
    values (${SWING_A}, ${GOLFER_A}, ${sessionId}, 'right')
    on conflict (id) do update set session_id = ${sessionId}
  `;
}

describe("a session belongs to the golfer who recorded it", () => {
  it("mints an unnamed analysis session with no swings in it", async () => {
    const session = await mint(GOLFER_A);
    // Null name, not "Session 1": the default title is a number the app counted, and the log's
    // date-title rule depends on being able to tell it from a name a person chose.
    expect(session.name).toBeNull();
    expect(session.sessionType).toBe("swing_analysis");
    expect(session.swingCount).toBe(0);
    expect(session.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("lists it to its owner and to nobody else", async () => {
    const session = await mint(GOLFER_A, { name: "Range work" });
    const mine = await withUser(GOLFER_A, (tx) => listSessions(tx, GOLFER_A));
    expect(mine.some((s) => s.id === session.id)).toBe(true);

    // Golfer B asking for A's sessions by id gets an empty list, not an error — the policy makes
    // another golfer's rows simply not exist.
    const theirs = await withUser(GOLFER_B, (tx) => listSessions(tx, GOLFER_A));
    expect(theirs.some((s) => s.id === session.id)).toBe(false);
  });

  it("lets an approved coach read the session but never rename it", async () => {
    const session = await mint(GOLFER_A, { name: "Coach can see this" });

    const seen = await withUser(COACH_C, (tx) => listSessions(tx, GOLFER_A));
    expect(seen.some((s) => s.id === session.id)).toBe(true);

    // §24.3 — a coach reviews a golfer's practice, never edits it.
    const attempted = await withUser(COACH_C, (tx) =>
      updateSession(tx, GOLFER_A, session.id, { name: "coach renamed it" }));
    expect(attempted).toBeNull();

    const after = await withUser(GOLFER_A, (tx) => listSessions(tx, GOLFER_A));
    expect(after.find((s) => s.id === session.id)?.name).toBe("Coach can see this");
  });

  it("refuses another golfer's rename and leaves the name alone", async () => {
    const session = await mint(GOLFER_A, { name: "Mine" });
    expect(
      await withUser(GOLFER_B, (tx) => updateSession(tx, GOLFER_B, session.id, { name: "Yours" })),
    ).toBeNull();
    const after = await withUser(GOLFER_A, (tx) => listSessions(tx, GOLFER_A));
    expect(after.find((s) => s.id === session.id)?.name).toBe("Mine");
  });

  it("persists a rename, and clears the name back to null", async () => {
    const session = await mint(GOLFER_A);
    const renamed = await withUser(GOLFER_A, (tx) =>
      updateSession(tx, GOLFER_A, session.id, { name: "Wedge day" }));
    expect(renamed?.name).toBe("Wedge day");

    // Clearing is a real edit, not a no-op: the golfer is putting the date title back.
    const cleared = await withUser(GOLFER_A, (tx) =>
      updateSession(tx, GOLFER_A, session.id, { name: null }));
    expect(cleared?.name).toBeNull();
  });
});

describe("a session's type locks once it has swings", () => {
  it("retypes freely while the session is empty", async () => {
    const session = await mint(GOLFER_A);
    const drills = await withUser(GOLFER_A, (tx) =>
      updateSession(tx, GOLFER_A, session.id, { sessionType: "practice_drills" }));
    expect(drills?.sessionType).toBe("practice_drills");
  });

  it("refuses a retype once a swing points at it, and still allows a rename", async () => {
    const session = await mint(GOLFER_A, { sessionType: "swing_analysis" });
    await attachSwing(session.id);

    const counted = await withUser(GOLFER_A, (tx) => listSessions(tx, GOLFER_A));
    expect(counted.find((s) => s.id === session.id)?.swingCount).toBe(1);

    await expect(
      withUser(GOLFER_A, (tx) =>
        updateSession(tx, GOLFER_A, session.id, { sessionType: "practice_drills" })),
    ).rejects.toBeInstanceOf(SessionError);

    // The lock is on the TYPE alone — a golfer can always rename a session they already filled.
    const renamed = await withUser(GOLFER_A, (tx) =>
      updateSession(tx, GOLFER_A, session.id, { name: "Locked but nameable" }));
    expect(renamed?.name).toBe("Locked but nameable");
    expect(renamed?.sessionType).toBe("swing_analysis");
  });

  it("accepts a patch restating the type it already has", async () => {
    // Idempotent retries must not fail: the client sends the type it believes is current.
    const session = await mint(GOLFER_A, { sessionType: "video_only" });
    await attachSwing(session.id);
    const same = await withUser(GOLFER_A, (tx) =>
      updateSession(tx, GOLFER_A, session.id, { sessionType: "video_only" }));
    expect(same?.sessionType).toBe("video_only");
  });
});
