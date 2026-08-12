import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * The only way the running application reaches Postgres.
 *
 * There is deliberately **no ambient `db` export** any more. D26 found that the app connected as
 * `swingsage` — a superuser — so every policy written in migration 0003 was inert: superusers
 * bypass row-level security, `FORCE ROW LEVEL SECURITY` does not apply to them, and `auth.uid()`
 * was NULL because nothing ever set the request claims. The RLS suite passed throughout, because
 * it impersonates `authenticated` by hand. That is the most dangerous shape a security bug takes:
 * it looks more secure than what it replaced and the tests agree with you.
 *
 * So the connection is private to this module and the only exported way to run a query is
 * `withUser`, which opens a transaction, declares who is asking, and drops back to a role with no
 * privileges at all when it commits. A query written outside this seam has nothing to run on.
 *
 * The privileged counterpart lives in `./admin.ts` and throws if it is ever loaded inside Next.
 */

const APP_DATABASE_URL = process.env.APP_DATABASE_URL;
if (!APP_DATABASE_URL) {
  throw new Error(
    "APP_DATABASE_URL is not set. This is the NON-SUPERUSER connection the app serves requests " +
      "on, and it is required — falling back to DATABASE_URL would silently restore the " +
      "superuser connection that made row-level security inert (docs/decisions/ARCHIVE-numbered.md D26).\n" +
      "Local setup: `docker compose up -d` then `pnpm --filter web db:migrate` (which runs " +
      "db:app-role), then add to apps/web/.env:\n" +
      "  APP_DATABASE_URL=postgres://swingsage_app:swingsage_app@127.0.0.1:5433/swingsage",
  );
}

declare global {
  // Next.js hot-reloads this module in dev; without the cache every reload opens a fresh pool and
  // the old ones leak until the server restarts.
  var __swingsageAppPool: ReturnType<typeof postgres> | undefined;
  var __swingsageAppChecked: Promise<void> | undefined;
}

const pool = globalThis.__swingsageAppPool ?? postgres(APP_DATABASE_URL, { max: 10 });
if (process.env.NODE_ENV !== "production") globalThis.__swingsageAppPool = pool;

const appDb = drizzle(pool, { schema });

/**
 * A transaction with a request identity attached. Every query in the product runs on one of these.
 *
 * Typed off drizzle's own transaction type so the table helpers keep working unchanged — the
 * modules under `db/` and `lib/` take this as their first argument instead of reaching for a
 * module-level client.
 */
export type DbTx = Parameters<Parameters<PostgresJsDatabase<typeof schema>["transaction"]>[0]>[0];

/**
 * Refuse to serve if the connection can bypass the policies.
 *
 * This is the part that makes a misconfiguration loud instead of invisible. Pointing
 * `APP_DATABASE_URL` at the owner account would restore exactly the D26 defect — everything would
 * work, every test would pass, and the boundary would be gone — so the four properties the seam
 * depends on are asserted against the live connection rather than assumed from an env var:
 *
 *   * not a superuser         — superusers ignore RLS entirely
 *   * not BYPASSRLS           — Supabase's `postgres` role has it even though it is not a superuser
 *   * member of `authenticated` — otherwise `set local role` below fails on every request
 *   * NOT a member of `service_role` — that role carries BYPASSRLS, so being able to reach it from
 *     a request handler would void every policy in one statement (step 03's item 4b)
 *
 * Run once per process, cached as a promise so concurrent first requests do not each pay for it.
 */
async function assertNotPrivileged(): Promise<void> {
  const rows = await appDb.execute<{
    role_name: string;
    is_superuser: boolean;
    bypassrls: boolean;
    is_authenticated: boolean;
    is_service_role: boolean;
  }>(sql`
    select current_user::text                            as role_name,
           coalesce(r.rolsuper, false)                   as is_superuser,
           coalesce(r.rolbypassrls, false)               as bypassrls,
           pg_has_role(current_user, 'authenticated', 'MEMBER') as is_authenticated,
           exists (select 1 from pg_roles where rolname = 'service_role')
             and pg_has_role(current_user, 'service_role', 'MEMBER')     as is_service_role
      from pg_roles r
     where r.rolname = current_user
  `);

  const row = rows[0];
  if (!row) throw new Error("could not read the connection's own role from pg_roles");

  const faults: string[] = [];
  if (row.is_superuser) faults.push("it is a SUPERUSER, which ignores row-level security");
  if (row.bypassrls) faults.push("it has BYPASSRLS, which ignores row-level security");
  if (!row.is_authenticated) {
    faults.push("it is not a member of `authenticated`, so no request can set its role");
  }
  if (row.is_service_role) {
    faults.push("it can reach `service_role`, which bypasses every policy (step 03 item 4b)");
  }

  if (faults.length) {
    throw new Error(
      `APP_DATABASE_URL connects as "${row.role_name}" and that role cannot serve requests: ` +
        `${faults.join("; ")}. Point it at swingsage_app (migration 0008) — see ` +
        "docs/decisions/ARCHIVE-numbered.md D26 and D42.",
    );
  }
}

function checked(): Promise<void> {
  const cached = globalThis.__swingsageAppChecked ?? assertNotPrivileged();
  globalThis.__swingsageAppChecked = cached;
  return cached;
}

/**
 * Run `fn` as `userId`, inside one transaction, with row-level security actually applied.
 *
 * `set local` for both the claim and the role: both revert when the transaction ends, so a pooled
 * connection cannot carry one request's identity into the next. That property is the reason this
 * is a transaction rather than a `set` on a checked-out connection.
 *
 * The claim is written with `set_config(..., true)` rather than interpolated into a `SET` — the
 * value is a JSON document built from a user id, and `SET` takes no parameters.
 *
 * After this returns, the connection is back to `swingsage_app`, which by design holds no
 * privileges on any table at all.
 */
export async function withUser<T>(userId: string, fn: (tx: DbTx) => Promise<T>): Promise<T> {
  if (!userId) throw new Error("withUser: no user id — refusing to run a query with no identity");
  await checked();
  return appDb.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId })}, true)`,
    );
    await tx.execute(sql`set local role authenticated`);
    return fn(tx);
  });
}

/** Close the pool. For scripts and tests; a server process holds it for its lifetime. */
export async function endAppPool(): Promise<void> {
  await pool.end();
  globalThis.__swingsageAppPool = undefined;
  globalThis.__swingsageAppChecked = undefined;
}
