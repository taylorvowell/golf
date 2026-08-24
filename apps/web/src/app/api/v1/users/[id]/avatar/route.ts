import { eq } from "drizzle-orm";

import { users } from "@/db/schema";
import { withUser } from "@/db/session";
import { requireUserIdOrNull } from "@/lib/auth";
import { ARTIFACT_BUCKET, avatarKey } from "@/lib/media/keys";
import { getMediaStore } from "@/lib/media/store";

/**
 * `GET /api/v1/users/:id/avatar?r=<rev>` — an uploaded profile photo, as bytes.
 *
 * An id in the path, unlike every `/profile` route, because an avatar is the one piece of a
 * profile someone ELSE legitimately renders: a coach's roster shows their golfers' faces. Who may
 * see it is not decided here — the `users_select_self` RLS policy (self, or an approved coach via
 * `has_coach_access`) answers it, exactly as it does for the roster query itself. A caller the
 * policy excludes reads "not found", never "forbidden": a 403 would confirm the account exists.
 *
 * Revision-addressed (`?r=`), so the URL is immutable — a changed photo is a NEW URL from the
 * profile body, which is what lets clients cache this hard without a staleness rule.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const callerId = await requireUserIdOrNull();
  if (!callerId) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const rev = new URL(req.url).searchParams.get("r") ?? "";

  // avatarKey validates both segments (uuid, 12-hex rev); a malformed id is a 404, not a 500.
  let key: string;
  try {
    key = avatarKey(id, rev);
  } catch {
    return new Response("not found", { status: 404 });
  }

  const visible = await withUser(callerId, async (tx) => {
    const [row] = await tx.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1);
    return Boolean(row);
  });
  if (!visible) return new Response("not found", { status: 404 });

  const store = await getMediaStore();
  const bytes = await store.getBytes(ARTIFACT_BUCKET, key);
  if (!bytes) return new Response("not found", { status: 404 });

  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(bytes.byteLength),
      // Immutable by construction (revision in the URL) — but private: it is a person's face.
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
