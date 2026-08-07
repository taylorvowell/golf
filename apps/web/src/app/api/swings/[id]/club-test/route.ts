import { getClubTestJob, startClubTest } from "@/lib/jobs";
import { TRACKING_TEST_IDS, type TrackingTestId } from "@/lib/clubTests";

/**
 * Run one club-tracking test over a swing and merge its experiment block (D55).
 *
 * POST starts, GET polls — the re-analysis protocol. This is the one route that takes a
 * request body: a test id, validated against the fixed TS enum before it can reach spawn
 * (plan §29 — the browser never supplies command text, only a checked enum member; the
 * Python side re-validates with argparse choices as defense in depth). If the experiment is
 * already in the artifact the POST returns done without spawning (plan §28).
 */
const noStore = { "Cache-Control": "no-store" };

function parseTestId(v: unknown): TrackingTestId | null {
  return typeof v === "string" &&
    (TRACKING_TEST_IDS as readonly string[]).includes(v)
    ? (v as TrackingTestId) : null;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  const testId = parseTestId((body as { testId?: unknown } | null)?.testId);
  if (!testId) {
    return Response.json(
      { status: "failed", message: "unknown test id" },
      { status: 400, headers: noStore },
    );
  }
  try {
    const job = await startClubTest(id, testId);
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
  const job = await getClubTestJob(id);
  if (!job) return Response.json({ status: "idle" }, { headers: noStore });
  return Response.json(job, { headers: noStore });
}
