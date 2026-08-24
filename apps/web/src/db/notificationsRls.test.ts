import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The notification boundary, proved rather than asserted — `rls.test.ts`'s discipline applied
 * to migration 0013.
 *
 * Three properties carry the design and each gets exercised here:
 *
 *   1. **The inbox is personal.** Owner reads own rows; another golfer — and even an approved
 *      coach — reads nothing. (The coach case matters: every other golfer table grants coach
 *      read, so this table's NARROWER policy is exactly the kind of difference a copy-paste
 *      policy would erase.)
 *   2. **Emission crosses users but only through `app.notify()`.** A direct INSERT as
 *      `authenticated` fails even for one's own inbox; the function succeeds for someone
 *      else's.
 *   3. **Grouping folds while unread and only while unread.** Same open group_key → one row,
 *      count 2, newest title; ack the group → the next event opens a fresh row.
 *
 * Like every db suite, this FAILS rather than skips without a database:
 * `docker compose up -d` then `pnpm --filter web db:migrate`.
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

/** Emit as `caller`, targeting `target` — the §29 cross-user shape (coach acts, golfer hears). */
async function notifyAs(
  caller: string,
  target: string,
  kind: string,
  title: string,
  groupKey: string | null = null,
): Promise<string> {
  const rows = await asUser(caller, (tx) =>
    tx.unsafe<{ notify: string }[]>(
      `select app.notify($1::uuid, $2, $3, null, '{}'::jsonb, $4) as notify`,
      [target, kind, title, groupKey],
    ),
  );
  return rows[0].notify;
}

async function inboxOf(userId: string) {
  return asUser(userId, (tx) =>
    tx.unsafe<{ id: string; kind: string; title: string; count: number; read_at: string | null }[]>(
      `select id, kind, title, count, read_at from public.notifications
       where user_id = $1 order by created_at desc`,
      [userId],
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
      (${GOLFER_A}, 'notif-a@test.local'),
      (${GOLFER_B}, 'notif-b@test.local'),
      (${COACH_C},  'notif-c@test.local')
    on conflict (id) do nothing
  `;
  await sql`
    insert into public.users (id, email, display_name) values
      (${GOLFER_A}, 'notif-a@test.local', 'Notif Golfer A'),
      (${GOLFER_B}, 'notif-b@test.local', 'Notif Golfer B'),
      (${COACH_C},  'notif-c@test.local', 'Notif Coach C')
    on conflict (id) do nothing
  `;
  // An APPROVED coach link, so the "even an approved coach reads nothing" case is real.
  await sql`
    insert into public.coach_links (golfer_id, coach_id, status)
    values (${GOLFER_A}, ${COACH_C}, 'approved')
    on conflict (golfer_id, coach_id) do update set status = 'approved'
  `;
});

afterAll(async () => {
  if (!sql) return;
  await sql`delete from auth.users where id in (${GOLFER_A}, ${GOLFER_B}, ${COACH_C})`;
  await sql.end();
});

describe("notifications — emission", () => {
  it("app.notify inserts for a DIFFERENT user under a plain authenticated role", async () => {
    // The whole reason the function exists: the coach acts, the golfer's inbox hears.
    await notifyAs(COACH_C, GOLFER_A, "coach_comment", "New comment on your swing");
    const inbox = await inboxOf(GOLFER_A);
    expect(inbox.length).toBe(1);
    expect(inbox[0].kind).toBe("coach_comment");
  });

  it("refuses a direct INSERT as authenticated, even into one's OWN inbox", async () => {
    // No insert policy is the design, not an omission — emission has exactly one door.
    await expect(
      asUser(GOLFER_A, (tx) =>
        tx.unsafe(
          `insert into public.notifications (user_id, kind, title)
           values ($1, 'coach_message', 'forged')`,
          [GOLFER_A],
        ),
      ),
    ).rejects.toThrow();
  });

  it("refuses an unknown kind", async () => {
    await expect(
      notifyAs(COACH_C, GOLFER_A, "not_a_kind", "nope"),
    ).rejects.toThrow();
  });
});

describe("notifications — the inbox is personal", () => {
  it("hides A's inbox from another golfer AND from A's approved coach", async () => {
    expect((await inboxOf(GOLFER_A)).length).toBeGreaterThan(0);
    const asB = await asUser(GOLFER_B, (tx) =>
      tx.unsafe(`select 1 from public.notifications where user_id = $1`, [GOLFER_A]),
    );
    const asCoach = await asUser(COACH_C, (tx) =>
      tx.unsafe(`select 1 from public.notifications where user_id = $1`, [GOLFER_A]),
    );
    expect(asB.length).toBe(0);
    // Narrower than every other golfer table: §24's grant is swing data, not the inbox.
    expect(asCoach.length).toBe(0);
  });

  it("lets only the owner ack, and only read_at", async () => {
    const inbox = await inboxOf(GOLFER_A);
    const target = inbox[0].id;

    const byOther = await asUser(GOLFER_B, (tx) =>
      tx.unsafe(
        `update public.notifications set read_at = now() where id = $1 returning id`,
        [target],
      ),
    );
    expect(byOther.length).toBe(0);

    // The column grant stops at read_at — retitling history is not expressible.
    await expect(
      asUser(GOLFER_A, (tx) =>
        tx.unsafe(`update public.notifications set title = 'rewritten' where id = $1`, [target]),
      ),
    ).rejects.toThrow();

    const byOwner = await asUser(GOLFER_A, (tx) =>
      tx.unsafe(
        `update public.notifications set read_at = now() where id = $1 returning id`,
        [target],
      ),
    );
    expect(byOwner.length).toBe(1);
  });
});

describe("notifications — dismissing (0018)", () => {
  it("lets the owner delete their own row, and nobody else delete it", async () => {
    const id = await notifyAs(COACH_C, GOLFER_A, "coach_comment", "Dismiss me");

    // Another golfer's DELETE matches no row — 0 rows, not an error, and nothing removed.
    const byOther = await asUser(GOLFER_B, (tx) =>
      tx.unsafe(`delete from public.notifications where id = $1 returning id`, [id]),
    );
    expect(byOther.length).toBe(0);
    expect((await inboxOf(GOLFER_A)).some((n) => n.id === id)).toBe(true);

    const byOwner = await asUser(GOLFER_A, (tx) =>
      tx.unsafe(`delete from public.notifications where id = $1 returning id`, [id]),
    );
    expect(byOwner.length).toBe(1);
    expect((await inboxOf(GOLFER_A)).some((n) => n.id === id)).toBe(false);
  });

  it("still refuses every write that is not the ack or the dismiss", async () => {
    // 0018 opens DELETE and nothing else — the surface it widened must not have widened twice.
    const id = await notifyAs(COACH_C, GOLFER_A, "coach_comment", "Untouchable");
    await expect(
      asUser(GOLFER_A, (tx) =>
        tx.unsafe(`update public.notifications set title = 'rewritten' where id = $1`, [id]),
      ),
    ).rejects.toThrow();
    await asUser(GOLFER_A, (tx) =>
      tx.unsafe(`delete from public.notifications where id = $1`, [id]),
    );
  });
});

describe("notifications — grouped delivery (D60)", () => {
  const GROUP = "conversation:test-thread";

  it("folds a second event into the open group instead of adding a row", async () => {
    const first = await notifyAs(COACH_C, GOLFER_B, "conversation_reply", "Coach replied", GROUP);
    const second = await notifyAs(
      COACH_C, GOLFER_B, "conversation_reply", "2 new replies", GROUP,
    );
    expect(second).toBe(first);

    const inbox = await inboxOf(GOLFER_B);
    expect(inbox.length).toBe(1);
    expect(inbox[0].count).toBe(2);
    // The folded row wears the NEWEST event's face.
    expect(inbox[0].title).toBe("2 new replies");
  });

  it("acking the group closes it — the next event opens a fresh row", async () => {
    await asUser(GOLFER_B, (tx) =>
      tx.unsafe(`update public.notifications set read_at = now() where user_id = $1`, [GOLFER_B]),
    );
    await notifyAs(COACH_C, GOLFER_B, "conversation_reply", "Another reply", GROUP);

    const inbox = await inboxOf(GOLFER_B);
    expect(inbox.length).toBe(2);
    const open = inbox.filter((n) => n.read_at === null);
    expect(open.length).toBe(1);
    expect(open[0].count).toBe(1);
  });

  it("never groups events with a null group_key", async () => {
    await notifyAs(COACH_C, GOLFER_B, "swing_reviewed", "Reviewed 1", null);
    await notifyAs(COACH_C, GOLFER_B, "swing_reviewed", "Reviewed 2", null);
    const inbox = await inboxOf(GOLFER_B);
    const reviews = inbox.filter((n) => n.kind === "swing_reviewed");
    expect(reviews.length).toBe(2);
  });
});
