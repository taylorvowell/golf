import { getIsolation } from "@/lib/swings";
import { requireViewAccess, viewParam } from "@/lib/auth";

/**
 * GET /api/swings/:id/isolation — golfer+club rings (body silhouette UNION attached
 * motion), same lazy-fetch reasoning as /silhouette. 404 means `scripts/isolate.py` has
 * not been run for this swing — a normal state, not an error.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const access = await requireViewAccess(id, viewParam(req));
  if ("error" in access) return access.error;
  const s = await getIsolation(access.mediaKey);
  if (!s) return new Response("not found", { status: 404 });
  return Response.json(s, { headers: { "Cache-Control": "private, max-age=86400" } });
}
