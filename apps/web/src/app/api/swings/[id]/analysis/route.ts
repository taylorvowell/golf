import { getAnalysis } from "@/lib/swings";
import { requireViewAccess, viewParam } from "@/lib/auth";

/**
 * the architecture spec API surface: GET /api/swings/:id/analysis.json
 *
 * `?view=dtl|face_on` picks which camera's artifact, defaulting to the swing's primary view.
 * Every artifact route below takes the same parameter — one `analysis.json` per view is the
 * whole point of §7.1, and the contract itself is unchanged: still one artifact per video.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const access = await requireViewAccess(id, viewParam(req));
  if ("error" in access) return access.error;
  const a = await getAnalysis(access.mediaKey);
  if (!a) return new Response("not found", { status: 404 });
  return Response.json(a, { headers: { "Cache-Control": "no-store" } });
}
