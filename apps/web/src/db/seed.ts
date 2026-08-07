import { eq } from "drizzle-orm";
import { db } from "./client";
import { users } from "./schema";

/**
 * Inserts the single "admin" user every swing is owned by until real auth exists (CLAUDE.md's
 * infra principle: a real `users` row + foreign key, never a hardcoded "admin" string). Safe
 * to re-run — it's a lookup-or-insert on `display_name`, not a blind insert.
 */
export const ADMIN_DISPLAY_NAME = "admin";

export async function ensureAdminUser() {
  const existing = await db.select().from(users).where(eq(users.displayName, ADMIN_DISPLAY_NAME));
  if (existing[0]) return existing[0];

  const [row] = await db.insert(users).values({ displayName: ADMIN_DISPLAY_NAME }).returning();
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
