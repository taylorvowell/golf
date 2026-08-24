import type { DismissalListResponse, DismissalSaveResponse } from "@swingsage/schema/contract";

import type { DbTx } from "@/db/session";

/**
 * The generic per-user dismissal store, server side — the backbone behind dismissable
 * surfaces (spotlight cards first). Three verbs and nothing surface-specific: this layer
 * must not know what a "spotlight" is, or the next one-time banner grows its own table.
 *
 * Everything takes a `DbTx` and therefore runs inside `withUser`, so RLS scopes every read
 * and write to the caller no matter what the JS says.
 */

/** Every key the caller has ever dismissed. The client filters its registry against this. */
export async function listDismissals(tx: DbTx, userId: string): Promise<DismissalListResponse> {
  const { userDismissals } = await import("../db/schema");
  const { eq } = await import("drizzle-orm");

  const rows = await tx
    .select({ key: userDismissals.key })
    .from(userDismissals)
    .where(eq(userDismissals.userId, userId));

  return { keys: rows.map((r) => r.key) };
}

/**
 * Record a dismissal. Idempotent by construction (`onConflictDoNothing` against the PK):
 * the same key arrives from two devices, or from the client's offline replay queue, and
 * the second arrival must be a no-op — never an error, and never a moved timestamp, because
 * `dismissed_at` records when the fact became true, not when it was last repeated.
 */
export async function saveDismissal(
  tx: DbTx,
  userId: string,
  key: string,
): Promise<DismissalSaveResponse> {
  const { userDismissals } = await import("../db/schema");

  await tx.insert(userDismissals).values({ userId, key }).onConflictDoNothing();
  return { ok: true };
}

/**
 * The debug-menu reset: forget everything. Dev tooling only — the route refuses this in
 * production, and the product itself never un-dismisses (a reworked card is a NEW key).
 */
export async function clearDismissals(tx: DbTx, userId: string): Promise<DismissalSaveResponse> {
  const { userDismissals } = await import("../db/schema");
  const { eq } = await import("drizzle-orm");

  await tx.delete(userDismissals).where(eq(userDismissals.userId, userId));
  return { ok: true };
}
