import { sql } from "drizzle-orm";
import { withUser } from "@/db/session";
import { ARTIFACT_BUCKET, SOURCE_BUCKET, userPrefix } from "@/lib/media/keys";
import { getMediaStore } from "@/lib/media/store";
import { canDeleteAuthIdentity, deleteAuthIdentity } from "./identity";

/**
 * §4.3 account deletion, end to end.
 *
 * What deletion actually removes, stated once here because the golfer is told the same list on the
 * confirmation screen and the two must not drift:
 *
 *   * every uploaded video and every artifact derived from it, in both buckets
 *   * every swing, view, score, stage, marker and analysis job
 *   * the equipment bag, practice sessions and goals
 *   * every coach link, from both sides — a coach loses access the moment the account goes
 *   * the sign-in identity itself, so the address is no longer known to the auth provider
 *
 * **The order is the design.** Each step is chosen so that a failure leaves a state a person can
 * recover from, because a partial deletion is the normal failure — three systems are involved and
 * there is no transaction spanning them.
 *
 *   1. **Media first.** If this fails, nothing has been lost: the rows still point at the objects
 *      and the golfer retries. Doing it after the rows were gone would orphan bytes that nothing
 *      references and nobody can enumerate — unrecoverable, and the expensive kind.
 *   2. **Database rows second.** One `delete` cascading from `public.users`, run through
 *      `app.delete_own_account()` so no elevated connection exists on the request path (D42) and
 *      so another account cannot be named as the target.
 *   3. **Auth identity last.** If this fails the golfer can still sign in, lands on an empty
 *      account, and can ask again. Doing it first would invalidate the credential mid-way and
 *      strand the rest of their data with no owner and no way to reach it.
 */

export interface AccountDeletion {
  userId: string;
  /** Objects removed from `swing-source` and `swing-artifacts`. */
  mediaObjects: number;
  swings: number;
  views: number;
  /**
   * False only where Supabase is not configured — the local development split (D7). The row data
   * is gone either way; the caller must say so rather than claim a full deletion.
   */
  authIdentityDeleted: boolean;
}

interface CascadeSummary {
  userId: string;
  profileDeleted: boolean;
  swings: number;
  views: number;
  authShimDeleted: boolean;
}

export async function deleteAccount(userId: string): Promise<AccountDeletion> {
  const store = await getMediaStore();
  const prefix = userPrefix(userId);

  // Both buckets, because D29 gave them different lifecycles and therefore different contents:
  // the untrimmed original lives in one and everything the analyzer derived lives in the other.
  // Sweeping only the artifacts would leave the actual video of the golfer behind.
  let mediaObjects = 0;
  for (const bucket of [SOURCE_BUCKET, ARTIFACT_BUCKET]) {
    mediaObjects += await store.removePrefix(bucket, prefix);
  }

  const rows = await withUser(userId, (tx) =>
    tx.execute<{ summary: CascadeSummary }>(sql`select app.delete_own_account() as summary`),
  );
  const summary = rows[0]?.summary;
  if (!summary?.profileDeleted) {
    // The function raises rather than returning quietly on a missing identity, so this only fires
    // when the profile row was already gone. Reported rather than swallowed: it means the
    // cascade did not run, and any swing still on disk would have been missed by step 1's sweep
    // as well.
    throw new Error(`account deletion removed no profile row for ${userId}`);
  }

  const authIdentityDeleted = canDeleteAuthIdentity();
  if (authIdentityDeleted) await deleteAuthIdentity(userId);

  return {
    userId,
    mediaObjects,
    swings: summary.swings,
    views: summary.views,
    authIdentityDeleted,
  };
}
