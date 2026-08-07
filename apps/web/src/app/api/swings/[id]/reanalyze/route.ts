import { getJob, startReanalysis } from "@/lib/jobs";

/**
 * Re-run the analyzer over a swing's original clip.
 *
 * POST starts, GET polls — doc 02's job protocol, against an in-memory record until the
 * SQLite job table exists. The response shape is the job row the UI renders, so swapping
 * the storage later does not touch the client.
 *
 * Re-analysis is the point of storing `analysis.json` as an artifact (doc 02): improved
 * models can be re-run over historic swings without the golfer re-filming anything.
 */
const noStore = { "Cache-Control": "no-store" };

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const job = await startReanalysis(id);
    return Response.json(job, { headers: noStore });
  } catch (err) {
    return Response.json(
      { status: "failed", message: err instanceof Error ? err.message : String(err) },
      { status: 400, headers: noStore },
    );
  }
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const job = await getJob(id);
  if (!job) return Response.json({ status: "idle" }, { headers: noStore });
  return Response.json(job, { headers: noStore });
}
