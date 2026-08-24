import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { eq } from "drizzle-orm";

import { users } from "@/db/schema";
import { withUser } from "@/db/session";
import { readProfile } from "@/lib/account/profile";
import { requireUserIdOrNull } from "@/lib/auth";
import { ARTIFACT_BUCKET, avatarKey, avatarPrefix } from "@/lib/media/keys";
import { getMediaStore } from "@/lib/media/store";

/**
 * `POST /api/v1/profile/avatar` — the caller's profile photo, raw image bytes as the body.
 * `DELETE /api/v1/profile/avatar` — remove it. Both answer the whole profile, so the client
 * reconciles against what the server confirmed exactly as a PATCH does.
 *
 * The bytes come THROUGH this route rather than via the two-phase signed-upload flow the swing
 * source uses, deliberately: the client crops before sending, so the body is a sub-megabyte
 * square — far inside what a function accepts — and the re-encode below has to happen server-side
 * anyway. A second ingest design for that would be complexity with no beneficiary.
 *
 * The image is always re-encoded, never stored as received. That is three properties in one
 * pass: EXIF is applied then stripped (a phone photo's orientation lives in metadata, and its
 * GPS tags must not survive into a served object), the stored object is guaranteed square at a
 * known size, and whatever the client claimed the content type was becomes irrelevant — sharp
 * either decodes real image bytes or the request is refused.
 */

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

/** 512px covers the largest render (56pt at 3x is 168px) three times over — retina-safe, tiny. */
const AVATAR_SIZE = 512;

/**
 * The value stored in `users.avatar_url`: an APP-RELATIVE path (`users/<id>/avatar?r=<rev>`),
 * against which clients apply their API base and bearer token — the same rule every media URL in
 * the product follows. Absolute `https://` values keep meaning a provider photo (Google), so a
 * client can tell the two apart by shape alone.
 */
function avatarPath(userId: string, rev: string): string {
  return `users/${userId}/avatar?r=${rev}`;
}

/** The revision inside a stored avatar path of OURS, or null for provider URLs and null. */
function revOf(url: string | null, userId: string): string | null {
  if (!url) return null;
  const match = /\?r=([0-9a-f]{12})$/.exec(url);
  return url.startsWith(`users/${userId}/avatar?`) && match ? match[1] : null;
}

export async function POST(req: Request) {
  const userId = await requireUserIdOrNull();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

  const raw = await req.arrayBuffer();
  if (raw.byteLength === 0) return Response.json({ error: "empty_body" }, { status: 400 });
  if (raw.byteLength > MAX_UPLOAD_BYTES) {
    return Response.json({ error: "too_large" }, { status: 413 });
  }

  let jpeg: Buffer;
  try {
    jpeg = await sharp(Buffer.from(raw))
      .rotate()
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "cover" })
      .jpeg({ quality: 85 })
      .toBuffer();
  } catch {
    return Response.json({ error: "unsupported_image" }, { status: 415 });
  }

  const rev = randomBytes(6).toString("hex");
  const store = await getMediaStore();
  // Object first, pointer second: a crash between the two leaves an unreferenced object (cleaned
  // by the next upload or the deletion sweep), never a profile pointing at bytes that don't exist.
  await store.put(ARTIFACT_BUCKET, avatarKey(userId, rev), new Uint8Array(jpeg), "image/jpeg");

  const previousRev = await withUser(userId, async (tx) => {
    const [row] = await tx
      .select({ avatarUrl: users.avatarUrl })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    await tx
      .update(users)
      .set({ avatarUrl: avatarPath(userId, rev) })
      .where(eq(users.id, userId));
    return revOf(row?.avatarUrl ?? null, userId);
  });

  if (previousRev && previousRev !== rev) {
    // Best-effort: an orphaned old object costs kilobytes; failing the upload over it costs trust.
    await store.removePrefix(ARTIFACT_BUCKET, avatarKey(userId, previousRev)).catch(() => 0);
  }

  return Response.json(await readProfile(userId), { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE() {
  const userId = await requireUserIdOrNull();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

  // Pointer first, objects second — the mirror of POST's ordering, for the same reason: the
  // recoverable failure is stray bytes in the bucket, never a profile URL with nothing behind it.
  await withUser(userId, (tx) =>
    tx.update(users).set({ avatarUrl: null }).where(eq(users.id, userId)),
  );
  const store = await getMediaStore();
  await store.removePrefix(ARTIFACT_BUCKET, avatarPrefix(userId)).catch(() => 0);

  return Response.json(await readProfile(userId), { headers: { "Cache-Control": "no-store" } });
}
