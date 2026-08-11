import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import type { DbTx } from "./session";

/**
 * The privileged connection — schema owner, row-level security bypassed — for command-line work
 * only: seeding, the backfill, the one-shot fixture claim, and the app-role setup.
 *
 * **This module must never be reachable from request handling.** That is step 03's item 4b and
 * D26's rule, and it is enforced three ways rather than by convention:
 *
 *   1. it throws at import time inside Next.js (below), so a route that imports it fails to build
 *      rather than quietly gaining a way around every policy
 *   2. `src/db/service-role.test.ts` fails the suite on any import of it from `src/app/`,
 *      `src/components/` or `src/lib/`
 *   3. the app's own login role is not a member of `service_role` at all, asserted at startup by
 *      `session.ts` — so even a leaked import has nothing privileged to connect as
 *
 * Guard 1 is the one that matters, because it is the only one that is true at runtime. `Next.js`
 * sets `NEXT_RUNTIME` in every server runtime it owns; the CLI scripts run under plain
 * `node --import tsx` and never see it.
 */
if (process.env.NEXT_RUNTIME) {
  throw new Error(
    "src/db/admin.ts was imported inside Next.js. This is the schema-owner connection and it " +
      "bypasses row-level security — nothing on a request path may hold it. Use `withUser` from " +
      "src/db/session.ts instead (docs/DECISIONS.md D26).",
  );
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set. This is the OWNER connection used by migrations and the CLI " +
      "scripts — the app itself serves requests on APP_DATABASE_URL. Copy apps/web/.env.example " +
      "to apps/web/.env and start Postgres with `docker compose up -d` from the repo root.",
  );
}

const pool = postgres(DATABASE_URL, { max: 4 });
const ownerDb = drizzle(pool, { schema });

/**
 * Run `fn` with owner privileges.
 *
 * `reason` is required and unused at runtime on purpose: it forces every call site to say, in
 * source, why it is allowed to skip the authorization boundary. There are four of them, and a
 * fifth should be argued for rather than added.
 */
export async function withOwner<T>(
  reason: string,
  fn: (tx: DbTx) => Promise<T>,
): Promise<T> {
  void reason;
  return ownerDb.transaction((tx) => fn(tx as DbTx));
}

/** Close the pool — every CLI script that opens it must, or node will not exit. */
export async function endOwnerPool(): Promise<void> {
  await pool.end();
}
