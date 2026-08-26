import { getAnalysis } from "@/lib/swings";
import { syncProfileOf } from "@/lib/syncProfile";
import { requireViewAccess, viewParam } from "@/lib/auth";

/**
 * GET /api/v1/swings/:id/sync-profile — the few facts needed to line this swing up against another.
 *
 * Separate from `/analysis` for the same reason `/report` is: different size, different lifetime,
 * different question. The artifact is megabytes of per-frame geometry and this is about two
 * kilobytes — the checkpoint table as published, the frame rate, the picture's shape and a box
 * around the golfer. A comparison needs all of that for a swing the golfer is not watching, and
 * paying 22 MB for it (`pro_3`) is what made picking a reference feel broken on a phone.
 *
 * `?view=dtl|face_on` selects the camera, like every other artifact route. Comparing two swings
 * filmed from different angles is a real thing to want and a meaningless thing to align, so the
 * client is given the view and decides — the server does not silently substitute one.
 *
 * 404 where `/analysis` 404s: no artifact means no positions to align on, which the client already
 * has a sentence for.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const access = await requireViewAccess(id, viewParam(req));
  if ("error" in access) return access.error;

  const analysis = await getAnalysis(access.address);
  if (!analysis) return new Response("not found", { status: 404 });

  // No-store, matching `/analysis`: a re-analysis rewrites the artifact in place under the same
  // revision, and a cached profile would keep lining swings up on the positions the old run found.
  return Response.json(syncProfileOf(access.swingId, access.view, analysis), {
    headers: { "Cache-Control": "no-store" },
  });
}
