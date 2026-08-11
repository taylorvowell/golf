import { getJob, startReanalysis } from "@/lib/jobs";
import { requireViewAccess, viewParam } from "@/lib/auth";

/**
 * Re-run the analyzer over a swing's original clip.
 *
 * POST starts, GET polls — the architecture spec's job protocol, against an in-memory record until the
 * SQLite job table exists. The response shape is the job row the UI renders, so swapping
 * the storage later does not touch the client.
 *
 * Re-analysis is the point of storing `analysis.json` as an artifact (the architecture spec): improved
 * models can be re-run over historic swings without the golfer re-filming anything.
 */
const noStore = { "Cache-Control": "no-store" };

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const access = await requireViewAccess(id, viewParam(req));
  if ("error" in access) return access.error;
  try {
    // One view at a time: re-analysis re-runs the analyzer over ONE clip, so a swing with two
    // cameras is two jobs, not one job that quietly does half the work.
    const job = await startReanalysis(access);
    return Response.json(job, { headers: noStore });
  } catch (err) {
    return Response.json(
      { status: "failed", message: err instanceof Error ? err.message : String(err) },
      { status: 400, headers: noStore },
    );
  }
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const access = await requireViewAccess(id, viewParam(req));
  if ("error" in access) return access.error;
  const job = await getJob(access);
  if (!job) return Response.json({ status: "idle" }, { headers: noStore });
  return Response.json(job, { headers: noStore });
}
