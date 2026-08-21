import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The role and profile boundary, proved rather than asserted — the same contract as
 * `rls.test.ts`, for the tables migration 0012 added.
 *
 * Three claims are worth a test each, and all three are the kind that a UI check would appear to
 * satisfy while the database did nothing:
 *
 *   1. **A golfer cannot grant themselves `admin`.** `user_roles` has no INSERT policy at all, so
 *      the only way in is `app.claim_role`, which whitelists what a person may claim for
 *      themselves. An escalation here is the highest-blast-radius bug the schema can hold.
 *   2. **The private profile is private.** §5.1 says sensitive fields are not automatically
 *      public; the schema says it by putting them in a different table from the public ones, and
 *      this proves the policy on that table matches.
 *
 * **Requires a database and FAILS, not skips, without one** — same reasoning as `rls.test.ts`: a
 * security test that silently skips still reports the suite green.
 */

const GOLFER_A = "dddddddd-0000-4000-8000-000000000001";
const GOLFER_B = "dddddddd-0000-4000-8000-000000000002";
const COACH_C = "dddddddd-0000-4000-8000-000000000003";

const url = process.env.DATABASE_URL;
let sql: postgres.Sql;

async function asUser<T>(userId: string, fn: (tx: postgres.TransactionSql) => Promise<T>) {
  return sql.begin(async (tx) => {
    await tx.unsafe(`select set_config('request.jwt.claims', '{"sub":"${userId}"}', true)`);
    await tx.unsafe("set local role authenticated");
    return fn(tx);
  });
}

async function setLink(status: "pending" | "approved" | "revoked") {
  await sql`
    insert into public.coach_links (golfer_id, coach_id, status)
    values (${GOLFER_A}, ${COACH_C}, ${status})
    on conflict (golfer_id, coach_id) do update set status = ${status}
  `;
}

beforeAll(async () => {
  expect(
    url,
    "DATABASE_URL is not set. This is an authorization-boundary suite and it must not be skipped — run `docker compose up -d` and `pnpm --filter web db:migrate`.",
  ).toBeTruthy();

  sql = postgres(url!, { max: 1, onnotice: () => {} });

  await sql`
    insert into auth.users (id, email) values
      (${GOLFER_A}, 'prof-a@test.local'),
      (${GOLFER_B}, 'prof-b@test.local'),
      (${COACH_C},  'prof-c@test.local')
    on conflict (id) do nothing
  `;
  await sql`
    insert into public.users (id, email, display_name) values
      (${GOLFER_A}, 'prof-a@test.local', 'Profile Golfer A'),
      (${GOLFER_B}, 'prof-b@test.local', 'Profile Golfer B'),
      (${COACH_C},  'prof-c@test.local', 'Profile Coach C')
    on conflict (id) do nothing
  `;
  await sql`
    insert into public.golfer_profiles (user_id, handedness, driver_swing_speed_mph)
    values (${GOLFER_A}, 'left', 92)
    on conflict (user_id) do update set handedness = 'left', driver_swing_speed_mph = 92
  `;
});

afterAll(async () => {
  if (!sql) return;
  await sql`delete from public.users where id in (${GOLFER_A}, ${GOLFER_B}, ${COACH_C})`;
  await sql`delete from auth.users where id in (${GOLFER_A}, ${GOLFER_B}, ${COACH_C})`;
  await sql.end();
});

describe("user_roles", () => {
  it("a golfer reads their own roles and nobody else's", async () => {
    await sql`
      insert into public.user_roles (user_id, role) values (${GOLFER_B}, 'coach')
      on conflict do nothing
    `;
    const mine = await asUser(GOLFER_B, (tx) =>
      tx.unsafe<{ role: string }[]>(`select role from public.user_roles order by role`),
    );
    expect(mine.map((r) => r.role)).toContain("coach");

    // A holds no visibility into B's roles — not even as an approved coach (see the policy note).
    await setLink("approved");
    const theirs = await asUser(COACH_C, (tx) =>
      tx.unsafe<{ n: string }[]>(
        `select count(*)::text as n from public.user_roles where user_id = $1`,
        [GOLFER_B],
      ),
    );
    expect(Number(theirs[0].n)).toBe(0);
  });

  it("REFUSES a self-granted admin role", async () => {
    // The direct write: there is no INSERT policy, so this must land nothing.
    await expect(
      asUser(GOLFER_A, (tx) =>
        tx.unsafe(`insert into public.user_roles (user_id, role) values ($1, 'admin')`, [GOLFER_A]),
      ),
    ).rejects.toThrow();

    // And the function refuses by name rather than by silently doing nothing, so a client can
    // tell "not allowed" from "worked".
    await expect(
      asUser(GOLFER_A, (tx) => tx.unsafe(`select app.claim_role('admin')`)),
    ).rejects.toThrow(/SS_ROLE_NOT_CLAIMABLE/);

    const rows = await sql<{ n: string }[]>`
      select count(*)::text as n from public.user_roles
       where user_id = ${GOLFER_A} and role = 'admin'
    `;
    expect(Number(rows[0].n)).toBe(0);
  });

  it("claims the coach role instantly, and is idempotent (D32)", async () => {
    await asUser(GOLFER_A, (tx) => tx.unsafe(`select app.claim_role('coach')`));
    await asUser(GOLFER_A, (tx) => tx.unsafe(`select app.claim_role('coach')`));
    const rows = await sql<{ n: string }[]>`
      select count(*)::text as n from public.user_roles
       where user_id = ${GOLFER_A} and role = 'coach'
    `;
    expect(Number(rows[0].n)).toBe(1);
  });

  it("cannot grant a role to somebody else — the identity is not an argument", async () => {
    // `claim_role` takes only a role; the user comes from auth.uid(). The test that matters is
    // that acting AS A grants A, never the id named in the row.
    await asUser(GOLFER_B, (tx) => tx.unsafe(`select app.claim_role('coach')`));
    const rows = await sql<{ user_id: string }[]>`
      select user_id from public.user_roles where role = 'coach' and user_id = ${GOLFER_B}
    `;
    expect(rows).toHaveLength(1);
  });
});

describe("golfer_profiles — the private half of §5.1", () => {
  it("the owner reads it", async () => {
    const rows = await asUser(GOLFER_A, (tx) =>
      tx.unsafe<{ handedness: string }[]>(
        `select handedness from public.golfer_profiles where user_id = $1`,
        [GOLFER_A],
      ),
    );
    expect(rows[0]?.handedness).toBe("left");
  });

  it("another golfer does NOT", async () => {
    const rows = await asUser(GOLFER_B, (tx) =>
      tx.unsafe<{ n: string }[]>(
        `select count(*)::text as n from public.golfer_profiles where user_id = $1`,
        [GOLFER_A],
      ),
    );
    expect(Number(rows[0].n)).toBe(0);
  });

  it("an approved coach reads it; a pending or revoked one does not", async () => {
    const visible = async () => {
      const rows = await asUser(COACH_C, (tx) =>
        tx.unsafe<{ n: string }[]>(
          `select count(*)::text as n from public.golfer_profiles where user_id = $1`,
          [GOLFER_A],
        ),
      );
      return Number(rows[0].n);
    };

    await setLink("pending");
    expect(await visible()).toBe(0);
    await setLink("approved");
    expect(await visible()).toBe(1);
    await setLink("revoked");
    expect(await visible()).toBe(0);
  });

  it("an approved coach cannot WRITE it — reading is not editing (§24.3)", async () => {
    await setLink("approved");
    await asUser(COACH_C, (tx) =>
      tx.unsafe(`update public.golfer_profiles set driver_swing_speed_mph = 70 where user_id = $1`, [
        GOLFER_A,
      ]),
    );
    // No error — an UPDATE filtered to zero rows by `using` is a no-op, not a failure. What must
    // be true is that the value did not change.
    const rows = await sql<{ driver_swing_speed_mph: number }[]>`
      select driver_swing_speed_mph from public.golfer_profiles where user_id = ${GOLFER_A}
    `;
    expect(rows[0].driver_swing_speed_mph).toBe(92);
  });

  it("cannot write a profile row for somebody else", async () => {
    await expect(
      asUser(GOLFER_B, (tx) =>
        tx.unsafe(`insert into public.golfer_profiles (user_id, handedness) values ($1, 'right')`, [
          GOLFER_A,
        ]),
      ),
    ).rejects.toThrow();
  });
});

describe("the six-answer profile (migration 0015)", () => {
  it("golfer_profiles carries exactly the six answers plus bookkeeping", async () => {
    const rows = await sql<{ column_name: string }[]>`
      select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'golfer_profiles'
      order by column_name
    `;
    // The 2026-08-20 shape: what the product stops asking it stops storing. A column
    // reappearing here without its question is the drift this test exists to catch.
    expect(rows.map((r) => r.column_name)).toEqual([
      "age_range", "created_at", "driver_swing_speed_mph", "handedness",
      "handicap_range", "onboarding_completed_at", "self_reported_style",
      "seven_iron_carry_yds", "updated_at", "user_id",
    ]);
  });

  it("golfer_goals is gone — goals belong to the guidance features, not the profile", async () => {
    const rows = await sql<{ n: string }[]>`
      select count(*)::text as n from information_schema.tables
       where table_schema = 'public' and table_name = 'golfer_goals'
    `;
    expect(Number(rows[0].n)).toBe(0);
  });
});

describe("the handedness move (migration 0012)", () => {
  it("users no longer carries handedness — the profile does", async () => {
    const rows = await sql<{ column_name: string }[]>`
      select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'users'
         and column_name in ('handedness', 'height_cm')
    `;
    expect(rows).toHaveLength(0);

    const profile = await sql<{ column_name: string }[]>`
      select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'golfer_profiles'
         and column_name = 'handedness'
    `;
    expect(profile.map((r) => r.column_name)).toEqual(["handedness"]);
  });

  it("a swing still carries its own handedness — the profile is a default, not the truth", async () => {
    // §7.2: the per-swing value overrides the profile. It is NOT NULL on `swings` and comes from
    // the analysis artifact, which is what makes an old swing keep its own answer when a golfer
    // corrects their profile.
    const rows = await sql<{ is_nullable: string }[]>`
      select is_nullable from information_schema.columns
       where table_schema = 'public' and table_name = 'swings' and column_name = 'handedness'
    `;
    expect(rows[0]?.is_nullable).toBe("NO");
  });
});
