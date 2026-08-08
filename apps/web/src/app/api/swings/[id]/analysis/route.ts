import { getAnalysis } from "@/lib/swings";

/** the architecture spec API surface: GET /api/swings/:id/analysis.json */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const a = await getAnalysis(id);
  if (!a) return new Response("not found", { status: 404 });
  return Response.json(a, { headers: { "Cache-Control": "no-store" } });
}
