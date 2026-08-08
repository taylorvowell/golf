import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { ADMIN_DISPLAY_NAME } from "@/db/seed";

/**
 * Stand-in for a real session lookup — there is no auth system yet (out of scope for the
 * swing-scoring work; see the plan's "Explicitly out of scope"). Every place that needs "the
 * current user" goes through this one function, so wiring up real auth later means changing
 * this function's body, not every call site: the `userId` it returns already flows into real
 * foreign keys everywhere (CLAUDE.md's infra principle).
 */
let cachedAdminId: string | null = null;

export async function getCurrentUserId(): Promise<string> {
  if (cachedAdminId) return cachedAdminId;
  const rows = await db.select({ id: users.id }).from(users)
    .where(eq(users.displayName, ADMIN_DISPLAY_NAME));
  if (!rows[0]) {
    throw new Error(
      "no admin user seeded — run `pnpm db:seed` from apps/web ()"
    );
  }
  cachedAdminId = rows[0].id;
  return cachedAdminId;
}
