import { and, asc, desc, eq } from "drizzle-orm";
import type { DbTx } from "./session";
import { swings, swingViews, type ViewType } from "./schema";
import type { ViewAddress } from "@/lib/media/keys";

/**
 * Resolving a swing to the video the caller actually means.
 *
 * Since migration 0006 a swing is a shot and a **view** is one camera's recording of it, so every
 * artifact read ("give me this swing's analysis") and every frame-indexed write ("pin the top to
 * frame 120") has to name a view. Routes still take a swing id — that is what a golfer's URL
 * holds — plus an optional `?view=dtl|face_on`, and resolve it here.
 *
 * The resolution rule, in order: the requested view type if one was named, otherwise the primary
 * view, otherwise the oldest. The fallback matters — a swing whose `is_primary` flag was somehow
 * never set must still open in the player rather than 404 with its video sitting right there.
 */
export interface ResolvedView {
  swingId: string;
  userId: string;
  viewId: string;
  view: ViewType;
  /**
   * The analyzer's working-directory name (`out/<stem>/`) — NOT an address. Media is addressed by
   * `mediaAddress()` below, which derives a storage key from identity (D33).
   */
  mediaKey: string;
  /** Which analysis run's artifacts to address. See `swing_views.artifact_revision`. */
  revision: number;
}

/**
 * The storage address of this view's media.
 *
 * Deliberately a one-line projection rather than a field: `ViewAddress` is what `lib/media`
 * consumes and it must not import the database, while `ResolvedView` is what routes already hold.
 * Keeping the mapping explicit is what stops a storage key from being smuggled into a database row.
 */
export function mediaAddress(v: ResolvedView): ViewAddress {
  return { userId: v.userId, swingId: v.swingId, viewId: v.viewId, revision: v.revision };
}

/**
 * Ids come off a URL, and `swings.id` is a uuid column: handing Postgres `/swing/perfect` (a
 * bookmark from before 0006) would raise a cast error and answer 500 for what is really a 404.
 */
export function isUuid(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

export function isViewType(v: string): v is ViewType {
  return v === "dtl" || v === "face_on";
}

/** The view a swing id + optional view type names, or null if there is no such view. */
export async function resolveView(
  tx: DbTx,
  swingId: string,
  viewType?: ViewType | null,
): Promise<ResolvedView | null> {
  if (!isUuid(swingId)) return null;

  const rows = await tx
    .select({
      swingId: swings.id,
      userId: swings.userId,
      viewId: swingViews.id,
      view: swingViews.view,
      mediaKey: swingViews.mediaKey,
      revision: swingViews.artifactRevision,
    })
    .from(swings)
    .innerJoin(swingViews, eq(swingViews.swingId, swings.id))
    .where(
      viewType
        ? and(eq(swings.id, swingId), eq(swingViews.view, viewType))
        : eq(swings.id, swingId),
    )
    .orderBy(desc(swingViews.isPrimary), asc(swingViews.createdAt))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * The view holding a given storage key.
 *
 * The analyzer's world is folders — `burnin.py` writes `out/<stem>/` and has never heard of this
 * database (CLAUDE.md: `burnin.py` run from the CLI does not touch Postgres). So the backfill,
 * which walks that directory, needs exactly one lookup in the other direction. Nothing on a
 * request path uses it, which is the point: a storage key must not be an address.
 */
export async function viewByMediaKey(tx: DbTx, mediaKey: string): Promise<ResolvedView | null> {
  const rows = await tx
    .select({
      swingId: swings.id,
      userId: swings.userId,
      viewId: swingViews.id,
      view: swingViews.view,
      mediaKey: swingViews.mediaKey,
      revision: swingViews.artifactRevision,
    })
    .from(swingViews)
    .innerJoin(swings, eq(swings.id, swingViews.swingId))
    .where(eq(swingViews.mediaKey, mediaKey))
    .limit(1);

  return rows[0] ?? null;
}

/** The view with this id, with its owning swing — for anything already holding a view id. */
export async function viewById(tx: DbTx, viewId: string): Promise<ResolvedView | null> {
  if (!isUuid(viewId)) return null;
  const rows = await tx
    .select({
      swingId: swings.id,
      userId: swings.userId,
      viewId: swingViews.id,
      view: swingViews.view,
      mediaKey: swingViews.mediaKey,
      revision: swingViews.artifactRevision,
    })
    .from(swingViews)
    .innerJoin(swings, eq(swings.id, swingViews.swingId))
    .where(eq(swingViews.id, viewId))
    .limit(1);

  return rows[0] ?? null;
}
