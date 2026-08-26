import { sql } from "drizzle-orm";
import { withUser } from "@/db/session";
import type { UserRole } from "@/db/schema";

/**
 * §3's roles, on the server side of the boundary.
 *
 * Two rules this module exists to keep, both of which a UI check would appear to satisfy:
 *
 * **Role checks are server-side.** §3.4 and §31 gate real capability on role, and a client that
 * decides its own role decides its own access. Every read here goes through `withUser`, so the
 * `user_roles_select_self` policy filters it — a caller cannot even observe somebody else's roles,
 * let alone act on them.
 *
 * **Holding a role is not being listed** (D32). `instructor` is free and instant and unlocks the
 * instructor workspace with an empty roster; appearing in the directory is a reviewed application
 * belonging to `instructor-relationships`. Nothing in this file grants visibility to anyone — it
 * answers "what may this account do", never "who should see this account".
 */

/** Roles a person may grant themselves. `admin` is deliberately absent, and so is any argument. */
export const CLAIMABLE_ROLES: readonly UserRole[] = ["golfer", "instructor"] as const;

export function isClaimableRole(value: string): value is UserRole {
  return (CLAIMABLE_ROLES as readonly string[]).includes(value);
}

/**
 * Every role this account holds.
 *
 * Empty is a real answer rather than an error — an identity resolved before `ensure_profile` ran
 * has none — and callers treat it as "no capability", which is the safe direction.
 */
export async function rolesOf(userId: string): Promise<UserRole[]> {
  const rows = await withUser(userId, (tx) =>
    tx.execute<{ role: UserRole }>(
      sql`select role from public.user_roles where user_id = ${userId} order by role`,
    ),
  );
  return rows.map((r) => r.role);
}

export async function hasRole(userId: string, role: UserRole): Promise<boolean> {
  return (await rolesOf(userId)).includes(role);
}

/**
 * Grant the caller a role they are allowed to claim.
 *
 * The user is NOT a parameter. `app.claim_role` reads `auth.uid()` internally and whitelists the
 * role, so "grant somebody else a role" and "grant myself admin" are both inexpressible rather
 * than merely rejected — the same shape as `ensure_profile` and `delete_own_account` (D26).
 * Idempotent, because a golfer tapping "I'm an instructor" twice is not an error.
 */
export async function claimRole(userId: string, role: UserRole): Promise<void> {
  await withUser(userId, (tx) => tx.execute(sql`select app.claim_role(${role})`));
}

/**
 * The guard an instructor-only route calls: the caller's id, or a 403 Response.
 *
 * Returns the Response rather than throwing so a route reads as a straight line, matching
 * `requireViewAccess`. 403 and not 404 — unlike a swing, the existence of an instructor endpoint
 * is not a disclosure about any person, so there is nothing to hide by lying about it, and a
 * golfer who has not claimed the role needs to be told to claim it rather than shown a dead end.
 */
export async function requireRole(
  userId: string | null,
  role: UserRole,
): Promise<{ userId: string } | { error: Response }> {
  if (!userId) {
    return { error: Response.json({ error: "unauthorized" }, { status: 401 }) };
  }
  if (!(await hasRole(userId, role))) {
    return {
      error: Response.json(
        {
          error: "role_required",
          message: `This requires the ${role} role.`,
        },
        { status: 403 },
      ),
    };
  }
  return { userId };
}
