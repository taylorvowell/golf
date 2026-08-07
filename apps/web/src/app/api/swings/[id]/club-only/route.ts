import { getClubOnly } from "@/lib/swings";

/**
 * GET /api/swings/:id/club-only — the subtractive isolation rings (attached motion minus
 * the golfer's body): just the club, by elimination. Same lazy-fetch contract as
 * /silhouette and /isolation; 404 means `scripts/isolate.py` has not run for this swing.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const s = await getClubOnly(id);
  if (!s) return new Response("not found", { status: 404 });
  return Response.json(s, { headers: { "Cache-Control": "private, max-age=86400" } });
}
