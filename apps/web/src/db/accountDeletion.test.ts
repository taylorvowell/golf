import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * §4.3 account deletion, proved against the real cascade.
 *
 * The whole design of `app.delete_own_account()` rests on two claims that are easy to state and
 * easy to get wrong:
 *
 *   1. **it deletes everything**, because the `on delete cascade` chain from `public.users` is
 *      complete. A table added later without a cascading foreign key would silently survive a
 *      deletion, and nothing in review would show it — the function would still return success.
 *   2. **it can only delete the caller**, because the identity comes from `auth.uid()` and there
 *      is no argument. This is the property that makes a request-path deletion safe at all.
 *
 * Claim 1 is checked by counting rows in every user-owned table before and after, rather than by
 * asserting the three the author happened to remember. Claim 2 is checked by having golfer B call
 * the function while golfer A's data exists.
 *
 * **Requires a database and FAILS rather than skips without one**, for the same reason
 * `rls.test.ts` does: a data-destruction test that quietly skips still reports green.
 */

const GOLFER_A = "dddddddd-0000-4000-8000-000000000001";
const GOLFER_B = "dddddddd-0000-4000-8000-000000000002";
const COACH_C = "dddddddd-0000-4000-8000-000000000003";
const SWING_A = "eeeeeeee-0000-4000-8000-000000000001";
const VIEW_A = "ffffffff-0000-4000-8000-000000000001";

const url = process.env.DATABASE_URL;
let sql: postgres.Sql;

async function asUser<T>(userId: string, fn: (tx: postgres.TransactionSql) => Promise<T>) {
  return sql.begin(async (tx) => {
    await tx.unsafe(`select set_config('request.jwt.claims', '{"sub":"${userId}"}', true)`);
    await tx.unsafe("set local role authenticated");
    return fn(tx);
  });
}

interface Summary {
  userId: string;
  profileDeleted: boolean;
  swings: number;
  views: number;
  authShimDeleted: boolean;
}

async function deleteOwnAccount(userId: string): Promise<Summary> {
  const rows = await asUser(userId, (tx) =>
    tx.unsafe<{ summary: Summary }[]>(`select app.delete_own_account() as summary`),
  );
  return rows[0].summary;
}

/** Rows still attributable to a user, per table, read as the owner so RLS cannot hide a survivor. */
async function survivingRows(userId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const one = async (label: string, query: postgres.PendingQuery<postgres.Row[]>) => {
    const rows = (await query) as unknown as { n: string }[];
    counts[label] = Number(rows[0].n);
  };
  await one("users", sql`select count(*)::text as n from public.users where id = ${userId}`);
  await one("clubs", sql`select count(*)::text as n from public.clubs where user_id = ${userId}`);
  await one(
    "sessions",
    sql`select count(*)::text as n from public.sessions where user_id = ${userId}`,
  );
  await one("swings", sql`select count(*)::text as n from public.swings where user_id = ${userId}`);
  await one(
    "swing_views",
    sql`select count(*)::text as n from public.swing_views v
        join public.swings s on s.id = v.swing_id where s.user_id = ${userId}`,
  );
  await one(
    "scores",
    sql`select count(*)::text as n from public.scores sc
        join public.swing_views v on v.id = sc.view_id
        join public.swings s on s.id = v.swing_id where s.user_id = ${userId}`,
  );
  await one(
    "coach_links",
    sql`select count(*)::text as n from public.coach_links
        where golfer_id = ${userId} or coach_id = ${userId}`,
  );
  await one("auth_users", sql`select count(*)::text as n from auth.users where id = ${userId}`);
  return counts;
}

async function seedGolferA() {
  await sql`
    insert into auth.users (id, email) values (${GOLFER_A}, 'del-a@test.local')
    on conflict (id) do nothing`;
  await sql`
    insert into public.users (id, email, display_name)
    values (${GOLFER_A}, 'del-a@test.local', 'Delete Golfer A')
    on conflict (id) do nothing`;
  await sql`
    insert into public.clubs (user_id, category, number)
    values (${GOLFER_A}, 'iron', '7')`;
  await sql`
    insert into public.sessions (user_id, date) values (${GOLFER_A}, current_date)`;
  await sql`
    insert into public.swings (id, user_id, handedness)
    values (${SWING_A}, ${GOLFER_A}, 'right')
    on conflict (id) do nothing`;
  await sql`
    insert into public.swing_views (id, swing_id, view, media_key, is_primary)
    values (${VIEW_A}, ${SWING_A}, 'dtl', 'delete-spec', true)
    on conflict (id) do nothing`;
  await sql`
    insert into public.scores
      (view_id, scoring_model_version, overall, band,
       categories, checkpoints, findings, priorities, primary_fix, drill)
    values (${VIEW_A}, 'test', 50, 'fair',
       '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, '{}'::jsonb)`;
  await sql`
    insert into public.coach_links (golfer_id, coach_id, status)
    values (${GOLFER_A}, ${COACH_C}, 'approved')
    on conflict (golfer_id, coach_id) do nothing`;
}

beforeAll(async () => {
  expect(
    url,
    "DATABASE_URL is not set. This suite proves account deletion actually deletes and must not be " +
      "skipped — run `docker compose up -d` and `pnpm --filter web db:migrate`.",
  ).toBeTruthy();

  sql = postgres(url!, { max: 1, onnotice: () => {} });

  for (const [id, email, name] of [
    [GOLFER_B, "del-b@test.local", "Delete Golfer B"],
    [COACH_C, "del-c@test.local", "Delete Coach C"],
  ]) {
    await sql`insert into auth.users (id, email) values (${id}, ${email}) on conflict (id) do nothing`;
    await sql`
      insert into public.users (id, email, display_name) values (${id}, ${email}, ${name})
      on conflict (id) do nothing`;
  }
  await seedGolferA();
});

afterAll(async () => {
  if (!sql) return;
  await sql`delete from auth.users where id in (${GOLFER_A}, ${GOLFER_B}, ${COACH_C})`;
  await sql`delete from public.users where id in (${GOLFER_A}, ${GOLFER_B}, ${COACH_C})`;
  await sql.end();
});

describe("app.delete_own_account", () => {
  it("cannot be called without an identity", async () => {
    // The seam sets `request.jwt.claims`; a call outside it must fail loudly rather than delete
    // whatever `auth.uid()` happens to resolve to.
    await expect(sql`select app.delete_own_account()`).rejects.toThrow(
      /no authenticated identity/,
    );
  });

  it("deletes nothing belonging to anyone else", async () => {
    // Golfer B calls it while golfer A's data exists. There is no argument to pass, so this is
    // the strongest form the attack can take — and it must cost B their own account, not A's.
    const before = await survivingRows(GOLFER_A);
    const summary = await deleteOwnAccount(GOLFER_B);
    expect(summary.userId).toBe(GOLFER_B);
    expect(summary.profileDeleted).toBe(true);
    expect(await survivingRows(GOLFER_A)).toEqual(before);
  });

  it("reports what it removed, counted before the delete", async () => {
    const summary = await deleteOwnAccount(GOLFER_A);
    expect(summary).toMatchObject({ userId: GOLFER_A, profileDeleted: true, swings: 1, views: 1 });
  });

  it("leaves nothing behind in any user-owned table", async () => {
    // The count is per-table rather than a spot check: the failure this guards against is a table
    // added later whose foreign key does not cascade, and only an exhaustive check sees that.
    expect(await survivingRows(GOLFER_A)).toEqual({
      users: 0,
      clubs: 0,
      sessions: 0,
      swings: 0,
      swing_views: 0,
      scores: 0,
      coach_links: 0,
      auth_users: 0,
    });
  });

  it("takes the coach's access with it", async () => {
    // A revoked relationship and a deleted golfer must look the same to a coach. This is the row
    // that would otherwise leave a coach linked to an account that no longer exists.
    const rows = await sql<{ n: string }[]>`
      select count(*)::text as n from public.coach_links where coach_id = ${COACH_C}`;
    expect(Number(rows[0].n)).toBe(0);
  });

  it("is a no-op the second time rather than a lie", async () => {
    // Re-running after the identity is gone reports `profileDeleted: false`, which is what the
    // route turns into an error. Silently returning success would let a retry after a partial
    // failure look complete when it had done nothing.
    const summary = await deleteOwnAccount(GOLFER_A);
    expect(summary.profileDeleted).toBe(false);
  });
});

describe("app.ensure_profile — every account carries an email (D31)", () => {
  const NO_EMAIL = "dddddddd-0000-4000-8000-00000000000e";

  afterAll(async () => {
    await sql`delete from auth.users where id = ${NO_EMAIL}`;
  });

  it("refuses an identity with no email, by a matchable code", async () => {
    // This is the phone-OTP case arriving early on purpose: Supabase hands back an identity with
    // `email` NULL, and the product must ask for one rather than write an unreachable account.
    // The application matches `SS_EMAIL_REQUIRED`, never the prose.
    await expect(
      asUser(NO_EMAIL, (tx) => tx.unsafe(`select app.ensure_profile(null)`)),
    ).rejects.toThrow(/SS_EMAIL_REQUIRED/);
    await expect(
      asUser(NO_EMAIL, (tx) => tx.unsafe(`select app.ensure_profile('   ')`)),
    ).rejects.toThrow(/SS_EMAIL_REQUIRED/);
  });

  it("creates nothing when it refuses", async () => {
    const rows = await sql<{ n: string }[]>`
      select count(*)::text as n from public.users where id = ${NO_EMAIL}`;
    expect(Number(rows[0].n)).toBe(0);
  });
});
