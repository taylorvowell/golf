import { sql } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { endAppPool, withUser } from "./session";

/**
 * Row-level security, exercised through **the connection the product actually serves requests on**.
 *
 * `rls.test.ts` proves the POLICIES are right: it opens its own superuser connection and
 * impersonates `authenticated` by hand. That is a necessary test and it is not this one — it
 * passed for the entire period in which the running application bypassed every policy it was
 * checking (D26). The gap between "the policy is correct" and "the product uses it" is precisely
 * where that defect lived, so this file closes it by using `withUser` and nothing else.
 *
 * If `APP_DATABASE_URL` is ever pointed back at an owner or superuser account, these fail. That is
 * the point: the defect they exist to catch is invisible to every other kind of test.
 *
 * **Fails rather than skips without a database**, for the same reason the RLS suite does — a
 * security test that silently skips still reports green.
 */

const GOLFER_A = "dddddddd-0000-4000-8000-000000000001";
const GOLFER_B = "dddddddd-0000-4000-8000-000000000002";
const INSTRUCTOR_C = "dddddddd-0000-4000-8000-000000000003";
const SWING_A = "eeeeeeee-0000-4000-8000-000000000001";
const VIEW_A = "ffffffff-0000-4000-8000-000000000001";

/** The OWNER connection, used only to build and tear down fixtures — never to make an assertion. */
let owner: postgres.Sql;

beforeAll(async () => {
  expect(
    process.env.DATABASE_URL,
    "DATABASE_URL is not set — needed to create this suite's fixtures. Run `docker compose up -d`.",
  ).toBeTruthy();
  expect(
    process.env.APP_DATABASE_URL,
    "APP_DATABASE_URL is not set. This is the suite that proves the APP's connection obeys " +
      "row-level security, so it cannot be skipped. Run `pnpm --filter web db:migrate`.",
  ).toBeTruthy();

  owner = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });

  await owner`
    insert into auth.users (id, email) values
      (${GOLFER_A}, 'app-a@test.local'),
      (${GOLFER_B}, 'app-b@test.local'),
      (${INSTRUCTOR_C},  'app-c@test.local')
    on conflict (id) do nothing
  `;
  await owner`
    insert into public.users (id, email, display_name) values
      (${GOLFER_A}, 'app-a@test.local', 'App Golfer A'),
      (${GOLFER_B}, 'app-b@test.local', 'App Golfer B'),
      (${INSTRUCTOR_C},  'app-c@test.local', 'App Instructor C')
    on conflict (id) do nothing
  `;
  await owner`
    insert into public.swings (id, user_id, handedness)
    values (${SWING_A}, ${GOLFER_A}, 'right')
    on conflict (id) do nothing
  `;
  await owner`
    insert into public.swing_views (id, swing_id, view, media_key, is_primary)
    values (${VIEW_A}, ${SWING_A}, 'dtl', 'app-boundary-spec', true)
    on conflict (id) do nothing
  `;
});

afterAll(async () => {
  if (owner) {
    await owner`delete from auth.users where id in (${GOLFER_A}, ${GOLFER_B}, ${INSTRUCTOR_C})`;
    await owner.end();
  }
  await endAppPool();
});

async function swingsVisibleTo(userId: string): Promise<number> {
  const rows = await withUser(userId, (tx) =>
    tx.execute<{ n: string }>(sql`select count(*)::text as n from public.swings where id = ${SWING_A}`),
  );
  return Number(rows[0].n);
}

describe("the app's own connection is bound by row-level security", () => {
  it("connects as a role that cannot bypass a policy", async () => {
    // `withUser` asserts this at startup and refuses to serve otherwise; stating it here as well
    // means the failure names the actual problem instead of surfacing as eleven denied queries.
    const rows = await withUser(GOLFER_A, (tx) =>
      tx.execute<{
        role_name: string; is_superuser: boolean; bypassrls: boolean; service_role: boolean;
      }>(sql`
        select r.rolname                                              as role_name,
               r.rolsuper                                             as is_superuser,
               r.rolbypassrls                                         as bypassrls,
               pg_has_role(r.rolname, 'service_role', 'MEMBER')       as service_role
          from pg_roles r
         where r.rolname = session_user
      `),
    );
    expect(rows[0].is_superuser).toBe(false);
    expect(rows[0].bypassrls).toBe(false);
    expect(rows[0].service_role).toBe(false);
  });

  it("puts a real identity behind auth.uid()", async () => {
    // The other half of the D26 defect: even with a non-superuser connection, policies comparing
    // against a NULL `auth.uid()` match nothing and would look like "RLS works" while being an
    // outage rather than a boundary.
    const rows = await withUser(GOLFER_A, (tx) =>
      tx.execute<{ uid: string | null; role: string }>(
        sql`select (select auth.uid())::text as uid, current_user::text as role`,
      ),
    );
    expect(rows[0].uid).toBe(GOLFER_A);
    expect(rows[0].role).toBe("authenticated");
  });

  it("drops the identity when the transaction ends", async () => {
    // `set local` on a POOLED connection: if either the role or the claim survived the commit, the
    // next request on that connection would inherit the previous request's identity. This is the
    // assertion that the pooling is safe.
    await withUser(GOLFER_A, async () => {});
    const rows = await withUser(GOLFER_B, (tx) =>
      tx.execute<{ uid: string | null }>(sql`select (select auth.uid())::text as uid`),
    );
    expect(rows[0].uid).toBe(GOLFER_B);
  });

  it("lets a golfer read their own swing", async () => {
    expect(await swingsVisibleTo(GOLFER_A)).toBe(1);
  });

  it("does not let another golfer read it — through the app's connection", async () => {
    // The assertion the product rests on, made where the product actually lives. Before D42 this
    // returned 1: the query ran as a superuser and every policy was skipped.
    expect(await swingsVisibleTo(GOLFER_B)).toBe(0);
  });

  it("hides the view row, which is where the storage key lives", async () => {
    const visible = async (userId: string) => {
      const rows = await withUser(userId, (tx) =>
        tx.execute<{ n: string }>(
          sql`select count(*)::text as n from public.swing_views where id = ${VIEW_A}`,
        ),
      );
      return Number(rows[0].n);
    };
    expect(await visible(GOLFER_A)).toBe(1);
    expect(await visible(GOLFER_B)).toBe(0);
  });

  it("refuses a write to someone else's swing", async () => {
    const rows = await withUser(GOLFER_B, (tx) =>
      tx.execute<{ id: string }>(
        sql`update public.swings set notes = 'B was here' where id = ${SWING_A} returning id`,
      ),
    );
    expect(rows.length).toBe(0);
  });

  it("grants and then revokes an instructor, with no restart in between", async () => {
    const setLink = (status: string) => owner`
      insert into public.instructor_links (golfer_id, instructor_id, status)
      values (${GOLFER_A}, ${INSTRUCTOR_C}, ${status})
      on conflict (golfer_id, instructor_id) do update set status = ${status}
    `;
    await setLink("pending");
    expect(await swingsVisibleTo(INSTRUCTOR_C)).toBe(0);
    await setLink("approved");
    expect(await swingsVisibleTo(INSTRUCTOR_C)).toBe(1);
    await setLink("revoked");
    expect(await swingsVisibleTo(INSTRUCTOR_C)).toBe(0);
  });

  it("refuses to run a query with no identity at all", async () => {
    // Fail closed. An empty user id must not become a query that runs with `auth.uid()` NULL and
    // silently returns nothing — that reads as "no swings yet" rather than as a bug.
    await expect(withUser("", async () => 1)).rejects.toThrow(/no identity|no user id/i);
  });
});

describe("ensure_profile — first sign-in without an elevated connection", () => {
  const NEWCOMER = "dddddddd-0000-4000-8000-00000000000f";

  afterAll(async () => {
    await owner`delete from auth.users where id = ${NEWCOMER}`;
  });

  it("creates exactly the caller's own profile row", async () => {
    await withUser(NEWCOMER, (tx) =>
      tx.execute(sql`select app.ensure_profile('newcomer@test.local')`),
    );
    const rows = await owner<{ id: string; display_name: string }[]>`
      select id, display_name from public.users where id = ${NEWCOMER}
    `;
    expect(rows[0]?.display_name).toBe("newcomer");
  });

  it("is idempotent", async () => {
    await withUser(NEWCOMER, (tx) =>
      tx.execute(sql`select app.ensure_profile('newcomer@test.local')`),
    );
    const rows = await owner<{ n: string }[]>`
      select count(*)::text as n from public.users where id = ${NEWCOMER}
    `;
    expect(Number(rows[0].n)).toBe(1);
  });

  it("cannot be used to create anyone else's profile", async () => {
    // The identity is read from `auth.uid()` inside the function, so there is no argument to
    // point at another user. The function's signature is the proof, and this asserts it stays so:
    // calling it never creates a row for an id the caller does not hold.
    const before = await owner<{ n: string }[]>`select count(*)::text as n from public.users`;
    await withUser(NEWCOMER, (tx) =>
      tx.execute(sql`select app.ensure_profile('someone.else@test.local')`),
    );
    const after = await owner<{ n: string }[]>`select count(*)::text as n from public.users`;
    expect(after[0].n).toBe(before[0].n);
  });
});
