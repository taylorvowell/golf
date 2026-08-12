import { getCoachReport } from "@/lib/swings";
import { requireViewAccess, viewParam } from "@/lib/auth";

/**
 * GET /api/v1/swings/:id/report — Stage 8's scorecard.
 *
 * Separate from `/analysis` because the two have different lifetimes and very different sizes: the
 * artifact is megabytes of per-frame geometry, this is a few kilobytes of scores, cues and the one
 * thing to work on first. A client that only wants to *explain* a swing should not have to download
 * every keypoint to do it — and "analysis must be explainable" is a product non-negotiable, not a
 * screen.
 *
 * 404 is a real and permanent state: a swing analysed with `--no-scoring` has no report, and the
 * honest client behaviour is to say it has not been scored rather than to show a zero.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const access = await requireViewAccess(id, viewParam(req));
  if ("error" in access) return access.error;
  const report = await getCoachReport(access.address);
  if (!report) return new Response("not found", { status: 404 });
  // No-store, like `/analysis`: a re-score rewrites this in place under the same revision, so a
  // cached copy would keep showing the numbers the old config produced.
  return Response.json(report, { headers: { "Cache-Control": "no-store" } });
}
