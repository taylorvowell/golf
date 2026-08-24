import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The dismissal boundary, proved rather than asserted — `rls.test.ts`'s discipline applied
 * to migration 0020.
 *
 * Three properties carry the design and each gets exercised here:
 *
 *   1. **Dismissals are personal in every direction.** Owner reads own keys; another golfer
 *      reads nothing, inserts nothing into someone else's store, deletes nothing from it.
 *   2. **A dismissal is a fact, not state.** Recording the same key twice is a no-op (the
 *      idempotent upsert the offline replay queue depends on), and UPDATE is not
 *      expressible at all — no policy, no grant.
 *   3. **The reset is own-rows-only.** The debug menu's clear-everything deletes the
 *      caller's rows and cannot reach anybody else's.
 *
 * Like every db suite, this FAILS rather than skips without a database:
 * `docker compose up -d` then `pnpm --filter web db:migrate`.
 */

const GOLFER_A = "eeeeeeee-0000-4000-8000-000000000001";
const GOLFER_B = "eeeeeeee-0000-4000-8000-000000000002";

const url = process.env.DATABASE_URL;
let sql: postgres.Sql;

async function asUser<T>(userId: string, fn: (tx: postgres.TransactionSql) => Promise<T>) {
  return sql.begin(async (tx) => {
    await tx.unsafe(`select set_config('request.jwt.claims', '{"sub":"${userId}"}', true)`);
    await tx.unsafe("set local role authenticated");
    return fn(tx);
  });
}

async function keysOf(userId: string): Promise<string[]> {
  const rows = await asUser(userId, (tx) =>
    tx.unsafe<{ key: string }[]>(
      `select key from public.user_dismissals where user_id = $1 order by key`,
      [userId],
    ),
  );
  return rows.map((r) => r.key);
}

async function dismissAs(userId: string, key: string) {
  return asUser(userId, (tx) =>
    tx.unsafe(
      `insert into public.user_dismissals (user_id, key) values ($1, $2)
       on conflict do nothing`,
      [userId, key],
    ),
  );
}

beforeAll(async () => {
  expect(
    url,
    "DATABASE_URL is not set. This is an authorization-boundary suite and it must not be skipped — run `docker compose up -d` and `pnpm --filter web db:migrate`.",
  ).toBeTruthy();

  sql = postgres(url!, { max: 1, onnotice: () => {} });

  await sql`
    insert into auth.users (id, email) values
      (${GOLFER_A}, 'dismiss-a@test.local'),
      (${GOLFER_B}, 'dismiss-b@test.local')
    on conflict (id) do nothing
  `;
  await sql`
    insert into public.users (id, email, display_name) values
      (${GOLFER_A}, 'dismiss-a@test.local', 'Dismiss Golfer A'),
      (${GOLFER_B}, 'dismiss-b@test.local', 'Dismiss Golfer B')
    on conflict (id) do nothing
  `;
});

afterAll(async () => {
  if (!sql) return;
  await sql`delete from auth.users where id in (${GOLFER_A}, ${GOLFER_B})`;
  await sql.end();
});

describe("user_dismissals — personal in every direction", () => {
  it("owner records and reads a key; another golfer sees nothing", async () => {
    await dismissAs(GOLFER_A, "spotlight.multiview.v1");
    expect(await keysOf(GOLFER_A)).toContain("spotlight.multiview.v1");

    const asB = await asUser(GOLFER_B, (tx) =>
      tx.unsafe(`select key from public.user_dismissals where user_id = $1`, [GOLFER_A]),
    );
    expect(asB.length).toBe(0);
  });

  it("refuses an insert into somebody else's store", async () => {
    // The WITH CHECK is the whole boundary on the write side — without it any account
    // could pre-dismiss every card for every user.
    await expect(
      asUser(GOLFER_B, (tx) =>
        tx.unsafe(
          `insert into public.user_dismissals (user_id, key) values ($1, 'spotlight.forged.v1')`,
          [GOLFER_A],
        ),
      ),
    ).rejects.toThrow();
  });

  it("another golfer's delete matches no row and removes nothing", async () => {
    const byOther = await asUser(GOLFER_B, (tx) =>
      tx.unsafe(
        `delete from public.user_dismissals where user_id = $1 returning key`,
        [GOLFER_A],
      ),
    );
    expect(byOther.length).toBe(0);
    expect(await keysOf(GOLFER_A)).toContain("spotlight.multiview.v1");
  });
});

describe("user_dismissals — a fact, not state", () => {
  it("recording the same key twice is a no-op, never an error", async () => {
    // The offline replay queue re-sends keys it cannot know arrived; the second landing
    // must change nothing — including the timestamp, which records when the fact became true.
    const before = await asUser(GOLFER_A, (tx) =>
      tx.unsafe<{ dismissed_at: string }[]>(
        `select dismissed_at from public.user_dismissals where user_id = $1 and key = $2`,
        [GOLFER_A, "spotlight.multiview.v1"],
      ),
    );
    await dismissAs(GOLFER_A, "spotlight.multiview.v1");
    const after = await asUser(GOLFER_A, (tx) =>
      tx.unsafe<{ dismissed_at: string }[]>(
        `select dismissed_at from public.user_dismissals where user_id = $1 and key = $2`,
        [GOLFER_A, "spotlight.multiview.v1"],
      ),
    );
    expect(after.length).toBe(1);
    expect(after[0].dismissed_at).toStrictEqual(before[0].dismissed_at);
  });

  it("UPDATE is not expressible, even by the owner", async () => {
    // No policy AND no grant — migration 0020 states the immutability in both layers.
    await expect(
      asUser(GOLFER_A, (tx) =>
        tx.unsafe(
          `update public.user_dismissals set key = 'spotlight.rewritten.v1'
           where user_id = $1 and key = 'spotlight.multiview.v1'`,
          [GOLFER_A],
        ),
      ),
    ).rejects.toThrow();
  });

  it("refuses an oversized key", async () => {
    await expect(dismissAs(GOLFER_A, "x".repeat(201))).rejects.toThrow();
  });
});

describe("user_dismissals — the reset is own-rows-only", () => {
  it("clear-everything deletes the caller's rows and only theirs", async () => {
    await dismissAs(GOLFER_B, "spotlight.pro.v1");

    await asUser(GOLFER_B, (tx) =>
      tx.unsafe(`delete from public.user_dismissals where user_id = $1`, [GOLFER_B]),
    );

    expect(await keysOf(GOLFER_B)).toEqual([]);
    // A's store is untouched by B's reset.
    expect(await keysOf(GOLFER_A)).toContain("spotlight.multiview.v1");
  });
});
