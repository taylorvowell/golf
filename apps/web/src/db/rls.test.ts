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
 * **Instructor cases are tested here even though the instructor feature is five phases away**
 * (`instructor-relationships`). That is deliberate, and it is the cheapest insurance available against
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
const INSTRUCTOR_C = "aaaaaaaa-0000-4000-8000-000000000003";
// Fixed uuids rather than generated ones: the suite has to name the same rows across cases, and
// `swings.id` is a uuid since migration 0006 (it used to be the analyzer's folder name).
const SWING_A = "bbbbbbbb-0000-4000-8000-000000000001";
const SWING_B = "bbbbbbbb-0000-4000-8000-000000000002";
const VIEW_A = "cccccccc-0000-4000-8000-000000000001";

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

/**
 * The same question one level down: can this user see the swing's VIEW?
 *
 * Migration 0006 put a table between a swing and everything frame-indexed about it, so the child
 * policies now derive visibility through two hops instead of one. A policy that got the extra hop
 * wrong would leak the video row itself — which is the row that holds the storage key.
 */
async function countVisibleViews(userId: string): Promise<number> {
  const rows = await asUser(userId, (tx) =>
    tx.unsafe<{ n: string }[]>(`select count(*)::text as n from public.swing_views where id = $1`, [
      VIEW_A,
    ]),
  );
  return Number(rows[0].n);
}

async function setLink(status: "pending" | "approved" | "revoked") {
  await sql`
    insert into public.instructor_links (golfer_id, instructor_id, status)
    values (${GOLFER_A}, ${INSTRUCTOR_C}, ${status})
    on conflict (golfer_id, instructor_id) do update set status = ${status}
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
      (${INSTRUCTOR_C},  'rls-c@test.local')
    on conflict (id) do nothing
  `;
  await sql`
    insert into public.users (id, email, display_name) values
      (${GOLFER_A}, 'rls-a@test.local', 'RLS Golfer A'),
      (${GOLFER_B}, 'rls-b@test.local', 'RLS Golfer B'),
      (${INSTRUCTOR_C},  'rls-c@test.local', 'RLS Instructor C')
    on conflict (id) do nothing
  `;
  await sql`
    insert into public.swings (id, user_id, handedness)
    values (${SWING_A}, ${GOLFER_A}, 'right')
    on conflict (id) do nothing
  `;
  await sql`
    insert into public.swing_views (id, swing_id, view, media_key, is_primary)
    values (${VIEW_A}, ${SWING_A}, 'dtl', 'rls-spec', true)
    on conflict (id) do nothing
  `;
});

afterAll(async () => {
  if (!sql) return;
  // auth.users cascades to public.users, which cascades to swings and instructor_links.
  await sql`delete from auth.users where id in (${GOLFER_A}, ${GOLFER_B}, ${INSTRUCTOR_C})`;
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

  it("lets a golfer read their own swing's view, and hides it from another", async () => {
    // The view row holds the storage key, so leaking it is leaking where the video lives.
    expect(await countVisibleViews(GOLFER_A)).toBe(1);
    expect(await countVisibleViews(GOLFER_B)).toBe(0);
  });

  it("does not let another golfer write the view", async () => {
    const rows = await asUser(GOLFER_B, (tx) =>
      tx.unsafe(`update public.swing_views set media_key = 'stolen' where id = $1 returning id`, [
        VIEW_A,
      ]),
    );
    expect(rows.length).toBe(0);
  });

  it("hides child rows when the parent swing is not visible", async () => {
    // Child tables derive visibility through the VIEW rather than carrying their own user_id, so
    // this proves the derivation — now two hops, child → view → swing — rather than a second copy
    // of the same rule.
    await sql`
      insert into public.swing_stages (view_id, stage, frame)
      values (${VIEW_A}, 'top', 120)
      on conflict (view_id, stage) do update set frame = 120
    `;
    const forOwner = await asUser(GOLFER_A, (tx) =>
      tx.unsafe(`select 1 from public.swing_stages where view_id = $1`, [VIEW_A]),
    );
    const forOther = await asUser(GOLFER_B, (tx) =>
      tx.unsafe(`select 1 from public.swing_stages where view_id = $1`, [VIEW_A]),
    );
    expect(forOwner.length).toBe(1);
    expect(forOther.length).toBe(0);
  });

  it("hides a scorecard through the same two hops", async () => {
    // scores moved from the swing to the view in 0006 — a scorecard is computed from exactly one
    // analysis.json. Its policy is the one most worth re-proving, because it carries the findings.
    await sql`
      insert into public.scores (view_id, scoring_model_version, overall, band,
                                 categories, checkpoints, findings, priorities, primary_fix, drill)
      values (${VIEW_A}, 'v2', 70, 'Solid', '{}', '{}', '[]', '[]', '{}', '{}')
      on conflict (view_id) do update set overall = 70
    `;
    const forOwner = await asUser(GOLFER_A, (tx) =>
      tx.unsafe(`select 1 from public.scores where view_id = $1`, [VIEW_A]),
    );
    const forOther = await asUser(GOLFER_B, (tx) =>
      tx.unsafe(`select 1 from public.scores where view_id = $1`, [VIEW_A]),
    );
    expect(forOwner.length).toBe(1);
    expect(forOther.length).toBe(0);
  });
});

describe("row-level security — instructor access, before the instructor feature exists", () => {
  it("denies an instructor with no relationship at all", async () => {
    await sql`delete from public.instructor_links where golfer_id = ${GOLFER_A}`;
    expect(await countVisibleSwings(INSTRUCTOR_C)).toBe(0);
  });

  it("denies an instructor whose request is still pending", async () => {
    // An unapproved request must grant nothing. The golfer has not said yes yet.
    await setLink("pending");
    expect(await countVisibleSwings(INSTRUCTOR_C)).toBe(0);
  });

  it("allows an approved instructor to read the linked golfer's swing", async () => {
    await setLink("approved");
    expect(await countVisibleSwings(INSTRUCTOR_C)).toBe(1);
  });

  it("ends access the moment the relationship is revoked", async () => {
    await setLink("approved");
    expect(await countVisibleSwings(INSTRUCTOR_C)).toBe(1);
    await setLink("revoked");
    // Immediately, with no cache to expire and no session to end — §24.4's requirement that the
    // golfer can end access is enforced by the same query that grants it.
    expect(await countVisibleSwings(INSTRUCTOR_C)).toBe(0);
  });

  it("never lets even an approved instructor write the golfer's swing", async () => {
    await setLink("approved");
    const rows = await asUser(INSTRUCTOR_C, (tx) =>
      tx.unsafe(`update public.swings set notes = 'instructor edit' where id = $1 returning id`, [
        SWING_A,
      ]),
    );
    expect(rows.length).toBe(0);
  });

  it("does not leak a different golfer's swing to an approved instructor", async () => {
    // Approved for A must not mean approved for everyone. This is the mistake a policy written
    // as "is this user an instructor" instead of "is this user THIS golfer's instructor" would make.
    await setLink("approved");
    await sql`
      insert into public.swings (id, user_id, handedness)
      values (${SWING_B}, ${GOLFER_B}, 'right')
      on conflict (id) do nothing
    `;
    const rows = await asUser(INSTRUCTOR_C, (tx) =>
      tx.unsafe(`select 1 from public.swings where id = $1`, [SWING_B]),
    );
    expect(rows.length).toBe(0);
  });

  it("only lets the golfer change the relationship, never the instructor", async () => {
    await setLink("approved");
    const byInstructor = await asUser(INSTRUCTOR_C, (tx) =>
      tx.unsafe(
        `update public.instructor_links set status = 'approved'
         where golfer_id = $1 and instructor_id = $2 returning id`,
        [GOLFER_A, INSTRUCTOR_C],
      ),
    );
    expect(byInstructor.length).toBe(0);

    const byGolfer = await asUser(GOLFER_A, (tx) =>
      tx.unsafe(
        `update public.instructor_links set status = 'revoked'
         where golfer_id = $1 and instructor_id = $2 returning id`,
        [GOLFER_A, INSTRUCTOR_C],
      ),
    );
    expect(byGolfer.length).toBe(1);
  });
});
