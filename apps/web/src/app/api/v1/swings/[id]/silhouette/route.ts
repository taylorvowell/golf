import { getSilhouette } from "@/lib/swings";
import { requireViewAccess, viewParam } from "@/lib/auth";

/**
 * GET /api/v1/swings/:id/silhouette — the golfer's per-frame outline (Stage 2b).
 *
 * Its own endpoint rather than a field on `/analysis` because it is 0.3–1.1 MB and most
 * viewings never switch the overlay on; the client fetches it once, on demand
 * (`lib/useSilhouette.ts`).
 *
 * 404 is a normal answer here, not an error: every swing analysed before Stage 2b existed, and
 * any run passed `--no-silhouette`, simply has no such file. `scripts/resegment.py` adds one
 * to an existing `out/` folder without re-running the pipeline.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const access = await requireViewAccess(id, viewParam(req));
  if ("error" in access) return access.error;
  const s = await getSilhouette(access.address);
  if (!s) return new Response("not found", { status: 404 });
  // Immutable for a day: the outline only changes when the swing is re-analysed, which mints
  // a fresh page load anyway. Costly to re-download on every toggle otherwise.
  return Response.json(s, { headers: { "Cache-Control": "private, max-age=86400" } });
}
