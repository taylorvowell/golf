import { getIsolation } from "@/lib/swings";

/**
 * GET /api/swings/:id/isolation — golfer+club rings (body silhouette UNION attached
 * motion), same lazy-fetch reasoning as /silhouette. 404 means `scripts/isolate.py` has
 * not been run for this swing — a normal state, not an error.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const s = await getIsolation(id);
  if (!s) return new Response("not found", { status: 404 });
  return Response.json(s, { headers: { "Cache-Control": "private, max-age=86400" } });
}
