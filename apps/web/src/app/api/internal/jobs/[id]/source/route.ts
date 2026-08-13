import { SOURCE_BUCKET } from "@/lib/media/keys";
import { getMediaStore } from "@/lib/media/store";
import { noStore, rawMediaKeyFor, requireJobAccess } from "@/lib/jobs/internal";

/**
 * The worker fetches the clip it is about to analyse. Redirects to a signed URL when the
 * driver can mint one (Supabase), streams the bytes itself otherwise (local) — the same
 * split the player's video route uses. The worker never learns a bucket or key either way.
 */

/** Long enough for the worker to start the download even after a slow queue wait. */
const SOURCE_URL_TTL_SECONDS = 60 * 60;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const access = await requireJobAccess(req, id);
  if ("error" in access) return access.error;

  const key = await rawMediaKeyFor(access.claims.actorId, access.claims.viewId);
  if (!key) {
    return Response.json({ error: "no stored source for this view" }, { status: 404, headers: noStore });
  }

  const store = await getMediaStore();
  if (store.canRedirect) {
    const url = await store.signedUrl(SOURCE_BUCKET, key, SOURCE_URL_TTL_SECONDS);
    if (url) return Response.redirect(url, 307);
  }

  const opened = await store.open(SOURCE_BUCKET, key, null);
  if (!opened) {
    return Response.json({ error: "stored source is missing" }, { status: 404, headers: noStore });
  }
  return new Response(opened.body, {
    headers: {
      "Content-Type": opened.contentType,
      "Content-Length": String(opened.size),
      ...noStore,
    },
  });
}
