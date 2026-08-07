import { getRawModels } from "@/lib/swings";

/**
 * GET /api/swings/:id/raw-models — every candidate detector's raw output
 * (scripts/rawmodels.py). Lazy like the other sidecars; 404 = not generated yet.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const s = await getRawModels(id);
  if (!s) return new Response("not found", { status: 404 });
  return Response.json(s, { headers: { "Cache-Control": "private, max-age=3600" } });
}
