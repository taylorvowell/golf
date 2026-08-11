import { eq, sql } from "drizzle-orm";
import { db } from "./client";
import { users } from "./schema";

/**
 * The local development user.
 *
 * Until step 04 wires real passwordless auth, every swing is owned by one row. What changed in
 * step 03 is that `users.id` is now a foreign key onto `auth.users` (D7 — one identity, no shadow
 * table), so this can no longer insert a user and let the database invent an id: that id would
 * exist nowhere in the auth system, and the row would look valid while being impossible to log
 * into.
 *
 * So the id is fixed and explicit, and the matching `auth.users` row is created alongside it.
 * Against local Postgres that row goes into the shim migration 0003 creates. Against a real
 * Supabase project it would be rejected — correctly, because there identities come from the auth
 * system and are created by signing up, not by seeding. That asymmetry is the point: local
 * development keeps working with no cloud credentials (D7), and nothing here can manufacture an
 * identity in an environment that has a real one.
 */
export const ADMIN_DISPLAY_NAME = "admin";

/**
 * Fixed rather than random so re-seeding is idempotent and so the id is quotable in tests and
 * fixtures. A v4-shaped UUID with an obvious body: it should be recognisable as a dev artifact if
 * it ever shows up somewhere it shouldn't.
 */
export const ADMIN_USER_ID = "00000000-0000-4000-8000-000000000001";

export async function ensureAdminUser() {
  const existing = await db.select().from(users).where(eq(users.displayName, ADMIN_DISPLAY_NAME));
  if (existing[0]) return existing[0];

  // The auth row must exist first — the FK points that way. `on conflict do nothing` keeps this
  // safe to re-run and safe against a row a previous seed already made.
  await db.execute(sql`
    insert into auth.users (id, email)
    values (${ADMIN_USER_ID}, 'admin@localhost')
    on conflict (id) do nothing
  `);

  const [row] = await db
    .insert(users)
    .values({ id: ADMIN_USER_ID, displayName: ADMIN_DISPLAY_NAME, email: "admin@localhost" })
    .returning();
  return row;
}

async function main() {
  const admin = await ensureAdminUser();
  console.log(`admin user: ${admin.id}`);
  process.exit(0);
}

// Only run when invoked directly (`pnpm db:seed`) — `ensureAdminUser` is also imported by
// backfill.ts and by API routes that need the admin id before real auth exists.
if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
