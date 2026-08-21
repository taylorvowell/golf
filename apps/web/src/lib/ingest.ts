import { eq } from "drizzle-orm";
import type { DbTx } from "@/db/session";
import { swings, swingViews, type ViewType } from "@/db/schema";
import type { ResolvedView } from "@/db/views";
import { SOURCE_BUCKET, sourceKey } from "@/lib/media/keys";
import { getMediaStore, type UploadTarget } from "@/lib/media/store";
import { enqueueCapture } from "@/lib/jobs/dispatch";
import type { Job } from "@/lib/jobs";

/**
 * Ingest — a captured or imported clip becoming a swing.
 *
 * **Two phases, and the split is the whole design.** `createCapture` mints the rows and hands back
 * a target; the client sends the bytes to that target itself; `completeCapture` verifies they
 * landed and enqueues the analysis. The obvious one-shot alternative — POST the file to this
 * server, which forwards it to storage — cannot work in production at all: a phone clip is tens to
 * hundreds of megabytes and a serverless function will not accept a body that size, let alone hold
 * the connection for the minutes an upload takes over mobile data.
 *
 * It is also the only shape resumable upload can be added behind. `media-pipeline` replaces *how*
 * the bytes travel (chunked, resumable, surviving backgrounding, queued while offline) without
 * touching either phase, because neither phase has an opinion about the transport.
 *
 * **The client never branches on the storage driver.** It asks for a target and sends the file
 * exactly as described. With Supabase Storage that target is a signed URL and the bytes never
 * touch this server; with the local driver it is a route on this server, which is what lets the
 * whole capture loop run with no cloud account. Same client code either way.
 */

/** D29 — the untrimmed original outlives the analysis by 30 days, then it is dropped. */
const RAW_RETENTION_DAYS = 30;

export interface CaptureInput {
  /** Which angle, from the capture screen's own toggle — never inferred from the pixels. */
  view: ViewType;
  /**
   * The golfer's handedness, from their profile.
   *
   * Carried on the swing rather than looked up at analysis time because it is the fact every
   * lead/trail metric is resolved against, and a profile edited after the fact must not silently
   * re-interpret a swing that was already measured.
   */
  handedness: "right" | "left";
  sessionId?: string | null;
  club?: string | null;
  /**
   * What the client will send. Decides the stored extension and the target's `content-type`; it
   * never becomes part of the key, so it cannot influence where the object lands.
   */
  contentType: string;
}

export interface CreatedCapture {
  swingId: string;
  viewId: string;
  upload: UploadTarget;
}

/** The container formats the analyzer's ffmpeg normalize step accepts from a phone. */
const ACCEPTED: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
};

export function isAcceptedContentType(contentType: string): boolean {
  return contentType.toLowerCase().split(";")[0].trim() in ACCEPTED;
}

/**
 * The stored name of a view's original upload.
 *
 * **Derived, never remembered.** The completion half re-computes this from the view row alone, so
 * there is no pending-upload state to persist and nothing to go stale if a client abandons a
 * capture halfway. It also means no client-supplied string reaches a storage key — the extension
 * comes from a closed set, so a filename cannot steer where bytes land.
 */
function rawName(contentType: string): string {
  const ext = ACCEPTED[contentType.toLowerCase().split(";")[0].trim()];
  if (!ext) throw new Error(`unsupported upload content type: ${contentType}`);
  return `original.${ext}`;
}

/**
 * Phase one: create the swing and its view, and hand back where to send the bytes.
 *
 * Nothing is enqueued here and `rawMediaKey` stays null — the row says "uploaded" as its status
 * only once something actually was. A capture abandoned between the two phases leaves a swing with
 * no media, which is a visible, deletable row rather than a job waiting on bytes that never come.
 */
export async function createCapture(
  tx: DbTx,
  userId: string,
  input: CaptureInput,
): Promise<CreatedCapture> {
  if (!isAcceptedContentType(input.contentType)) {
    throw new Error(`unsupported upload content type: ${input.contentType}`);
  }

  const [swing] = await tx.insert(swings).values({
    userId,
    sessionId: input.sessionId ?? null,
    club: input.club ?? null,
    handedness: input.handedness,
  }).returning({ id: swings.id });

  const [view] = await tx.insert(swingViews).values({
    swingId: swing.id,
    view: input.view,
    // The analyzer's working-directory stem. A new view uses its own id (D33) — only the ten
    // fixtures keep human-readable ones.
    mediaKey: crypto.randomUUID(),
    // First camera on a new swing is the one the player opens. A second view added later is not.
    isPrimary: true,
  }).returning({ id: swingViews.id, mediaKey: swingViews.mediaKey, revision: swingViews.artifactRevision });

  // Written back so the stem IS the view id, which is what makes an artifact prefix readable next
  // to the row that owns it. Done as an update rather than a pre-generated uuid so the database
  // stays the only minter of ids.
  await tx.update(swingViews).set({ mediaKey: view.id }).where(eq(swingViews.id, view.id));

  const key = sourceKey(
    { userId, swingId: swing.id, viewId: view.id, revision: view.revision },
    rawName(input.contentType),
  );

  const store = await getMediaStore();
  const signed = await store.signedUploadUrl(SOURCE_BUCKET, key, input.contentType);

  return {
    swingId: swing.id,
    viewId: view.id,
    // A driver that cannot sign is not a failure — it is the signal to hand back this server's own
    // upload route instead. The client cannot tell the difference and must not try.
    upload: signed ?? {
      url: `/api/v1/swings/${swing.id}/source?view=${input.view}`,
      method: "PUT",
      headers: { "content-type": input.contentType },
      expiresIn: 60 * 60,
    },
  };
}

/** Where phase one told the client to put this view's original. */
export function rawKeyFor(view: ResolvedView, contentType: string): string {
  return sourceKey(
    { userId: view.userId, swingId: view.swingId, viewId: view.viewId, revision: view.revision },
    rawName(contentType),
  );
}

/**
 * Phase two: confirm the bytes are really there, then enqueue the analysis.
 *
 * **The object is verified, not believed.** A client saying "uploaded" is a claim about work it did
 * against a different host entirely, and a job dispatched on that claim fails minutes later inside
 * the worker with an error no golfer can act on. One `exists` here turns that into an immediate,
 * readable refusal — the same "done is verified" rule the worker's own completion callback follows.
 */
export async function completeCapture(
  tx: DbTx,
  userId: string,
  view: ResolvedView,
  contentType: string,
): Promise<Job> {
  const key = rawKeyFor(view, contentType);
  const store = await getMediaStore();
  if (!(await store.exists(SOURCE_BUCKET, key))) {
    throw new Error("no uploaded video found at this swing's upload target");
  }

  const expires = new Date(Date.now() + RAW_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  await tx.update(swingViews)
    .set({ rawMediaKey: key, rawExpiresAt: expires, status: "uploaded" })
    .where(eq(swingViews.id, view.viewId));

  const [row] = await tx.select({ handedness: swings.handedness })
    .from(swings).where(eq(swings.id, view.swingId)).limit(1);
  if (!row) throw new Error("the swing this view belongs to has gone");

  return enqueueCapture(tx, userId, view, row.handedness);
}
