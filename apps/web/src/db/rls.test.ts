import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The authorization boundary, proved rather than asserted.
 *
 * D7 makes row-level security *the* access control for this product — not a `where` clause, not a
 * UI check. That decision is only worth anything if the policies are exercised, so this file
 * exists to make "a golfer can read another golfer's swing" a failing test rather than an
 * incident.
 *
 * **Coach cases are tested here even though the coach feature is five phases away**
 * (`coach-relationships`). That is deliberate, and it is the cheapest insurance available against
 * the one bug in this product that would be genuinely unrecoverable: showing one golfer another
 * golfer's video of themselves. The gap between designing a policy and first exercising it is
 * exactly where a wrong shape survives unnoticed.
 *
 * **This test requires a database and will FAIL, not skip, without one.** A security test that
 * silently skips is worse than no test, because the suite still reports green. Start Postgres
 * with `docker compose up -d` and apply migrations with `pnpm --filter web db:migrate`.
 *
 * It runs against local Postgres, not the hosted project, because migration 0003 creates the
 * `auth` shim and the `anon`/`authenticated`/`service_role` roles locally. That is what lets the
 * boundary be verified in CI with no cloud credentials.
 */

const GOLFER_A = "aaaaaaaa-0000-4000-8000-000000000001";
const GOLFER_B = "aaaaaaaa-0000-4000-8000-000000000002";
const COACH_C = "aaaaaaaa-0000-4000-8000-000000000003";
const SWING_A = "rls-spec-swing-a";

const url = process.env.DATABASE_URL;
let sql: postgres.Sql;

/**
 * Run a query as a real request would: the `authenticated` role, with a JWT `sub` claim.
 *
 * `set local` inside a transaction is what makes this safe to interleave — the role and the claim
 * are both reverted when the transaction ends, so one case cannot leak identity into the next.
 */
async function asUser<T>(userId: string, fn: (tx: postgres.TransactionSql) => Promise<T>) {
  return sql.begin(async (tx) => {
    await tx.unsafe(`select set_config('request.jwt.claims', '{"sub":"${userId}"}', true)`);
    await tx.unsafe("set local role authenticated");
    return fn(tx);
  });
}

async function countVisibleSwings(userId: string): Promise<number> {
  const rows = await asUser(userId, (tx) =>
    tx.unsafe<{ n: string }[]>(`select count(*)::text as n from public.swings where id = $1`, [
      SWING_A,
    ]),
  );
  return Number(rows[0].n);
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
    "DATABASE_URL is not set. This is the authorization-boundary suite and it must not be skipped — run `docker compose up -d` and `pnpm --filter web db:migrate`.",
  ).toBeTruthy();

  sql = postgres(url!, { max: 1, onnotice: () => {} });

  // Setup runs as the connection's own (owning) role, which bypasses nothing but owns the rows.
  await sql`
    insert into auth.users (id, email) values
      (${GOLFER_A}, 'rls-a@test.local'),
      (${GOLFER_B}, 'rls-b@test.local'),
      (${COACH_C},  'rls-c@test.local')
    on conflict (id) do nothing
  `;
  await sql`
    insert into public.users (id, email, display_name) values
      (${GOLFER_A}, 'rls-a@test.local', 'RLS Golfer A'),
      (${GOLFER_B}, 'rls-b@test.local', 'RLS Golfer B'),
      (${COACH_C},  'rls-c@test.local', 'RLS Coach C')
    on conflict (id) do nothing
  `;
  await sql`
    insert into public.swings (id, user_id, view, handedness, media_path)
    values (${SWING_A}, ${GOLFER_A}, 'dtl', 'right', 'out/rls-spec')
    on conflict (id) do nothing
  `;
});

afterAll(async () => {
  if (!sql) return;
  // auth.users cascades to public.users, which cascades to swings and coach_links.
  await sql`delete from auth.users where id in (${GOLFER_A}, ${GOLFER_B}, ${COACH_C})`;
  await sql.end();
});

describe("row-level security — golfer isolation", () => {
  it("lets a golfer read their own swing", async () => {
    expect(await countVisibleSwings(GOLFER_A)).toBe(1);
  });

  it("does not let another golfer read it", async () => {
    // The whole product rests on this one assertion.
    expect(await countVisibleSwings(GOLFER_B)).toBe(0);
  });

  it("does not let another golfer write it", async () => {
    const rows = await asUser(GOLFER_B, (tx) =>
      tx.unsafe(`update public.swings set notes = 'B was here' where id = $1 returning id`, [
        SWING_A,
      ]),
    );
    expect(rows.length).toBe(0);
  });

  it("hides child rows when the parent swing is not visible", async () => {
    // Child tables derive visibility from the swing rather than carrying their own user_id, so
    // this proves the derivation rather than a second copy of the same rule.
    await sql`
      insert into public.swing_stages (swing_id, stage, frame)
      values (${SWING_A}, 'top', 120)
      on conflict (swing_id, stage) do update set frame = 120
    `;
    const forOwner = await asUser(GOLFER_A, (tx) =>
      tx.unsafe(`select 1 from public.swing_stages where swing_id = $1`, [SWING_A]),
    );
    const forOther = await asUser(GOLFER_B, (tx) =>
      tx.unsafe(`select 1 from public.swing_stages where swing_id = $1`, [SWING_A]),
    );
    expect(forOwner.length).toBe(1);
    expect(forOther.length).toBe(0);
  });
});

describe("row-level security — coach access, before the coach feature exists", () => {
  it("denies a coach with no relationship at all", async () => {
    await sql`delete from public.coach_links where golfer_id = ${GOLFER_A}`;
    expect(await countVisibleSwings(COACH_C)).toBe(0);
  });

  it("denies a coach whose request is still pending", async () => {
    // An unapproved request must grant nothing. The golfer has not said yes yet.
    await setLink("pending");
    expect(await countVisibleSwings(COACH_C)).toBe(0);
  });

  it("allows an approved coach to read the linked golfer's swing", async () => {
    await setLink("approved");
    expect(await countVisibleSwings(COACH_C)).toBe(1);
  });

  it("ends access the moment the relationship is revoked", async () => {
    await setLink("approved");
    expect(await countVisibleSwings(COACH_C)).toBe(1);
    await setLink("revoked");
    // Immediately, with no cache to expire and no session to end — §24.4's requirement that the
    // golfer can end access is enforced by the same query that grants it.
    expect(await countVisibleSwings(COACH_C)).toBe(0);
  });

  it("never lets even an approved coach write the golfer's swing", async () => {
    await setLink("approved");
    const rows = await asUser(COACH_C, (tx) =>
      tx.unsafe(`update public.swings set notes = 'coach edit' where id = $1 returning id`, [
        SWING_A,
      ]),
    );
    expect(rows.length).toBe(0);
  });

  it("does not leak a different golfer's swing to an approved coach", async () => {
    // Approved for A must not mean approved for everyone. This is the mistake a policy written
    // as "is this user a coach" instead of "is this user THIS golfer's coach" would make.
    await setLink("approved");
    await sql`
      insert into public.swings (id, user_id, view, handedness, media_path)
      values ('rls-spec-swing-b', ${GOLFER_B}, 'dtl', 'right', 'out/rls-spec-b')
      on conflict (id) do nothing
    `;
    const rows = await asUser(COACH_C, (tx) =>
      tx.unsafe(`select 1 from public.swings where id = 'rls-spec-swing-b'`),
    );
    expect(rows.length).toBe(0);
  });

  it("only lets the golfer change the relationship, never the coach", async () => {
    await setLink("approved");
    const byCoach = await asUser(COACH_C, (tx) =>
      tx.unsafe(
        `update public.coach_links set status = 'approved'
         where golfer_id = $1 and coach_id = $2 returning id`,
        [GOLFER_A, COACH_C],
      ),
    );
    expect(byCoach.length).toBe(0);

    const byGolfer = await asUser(GOLFER_A, (tx) =>
      tx.unsafe(
        `update public.coach_links set status = 'revoked'
         where golfer_id = $1 and coach_id = $2 returning id`,
        [GOLFER_A, COACH_C],
      ),
    );
    expect(byGolfer.length).toBe(1);
  });
});
