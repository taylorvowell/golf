import { getClubOnly } from "@/lib/swings";
import { requireViewAccess, viewParam } from "@/lib/auth";

/**
 * GET /api/swings/:id/club-only — the subtractive isolation rings (attached motion minus
 * the golfer's body): just the club, by elimination. Same lazy-fetch contract as
 * /silhouette and /isolation; 404 means `scripts/isolate.py` has not run for this swing.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const access = await requireViewAccess(id, viewParam(req));
  if ("error" in access) return access.error;
  const s = await getClubOnly(access.mediaKey);
  if (!s) return new Response("not found", { status: 404 });
  return Response.json(s, { headers: { "Cache-Control": "private, max-age=86400" } });
}
