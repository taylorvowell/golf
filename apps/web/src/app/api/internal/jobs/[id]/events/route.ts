import { eq } from "drizzle-orm";
import { withUser } from "@/db/session";
import { jobs as jobsTable, swingViews as viewsTable } from "@/db/schema";
import { mediaAddress } from "@/db/views";
import { isPublished } from "@/lib/media/publish";
import { markViewFailed, markViewReady } from "@/lib/jobs/complete";
import { noStore, requireJobAccess } from "@/lib/jobs/internal";
import { parseEvent, type WorkerEvent } from "@/lib/jobs/events";

/**
 * The worker reports progress and the terminal state. Job state lives in Postgres (D9) and is
 * written here under the enqueuing user's identity — the queue only ever carried dispatch.
 *
 * `done` is verified, not believed: the row flips only after `analysis.json` is confirmed
 * present in the store at the job's target revision. A worker that says "done" without having
 * uploaded the one artifact every successful run produces has failed, whatever it thinks.
 */

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const access = await requireJobAccess(req, id);
  if ("error" in access) return access.error;
  const { claims, job, view } = access;

  let event: WorkerEvent | null = null;
  try {
    event = parseEvent(await req.json());
  } catch { /* fall through to 400 */ }
  if (!event) {
    return Response.json({ error: "unrecognized event" }, { status: 400, headers: noStore });
  }

  // A QStash redelivery can legitimately re-run a job that already finished; its events must
  // land soft. The target revision is fixed, so the re-run overwrote the same artifacts with
  // the same content — nothing to reconcile, nothing to error.
  if (job.status === "done" || job.status === "failed") {
    return Response.json({ ok: true, alreadyTerminal: true }, { headers: noStore });
  }

  const actorId = claims.actorId;

  if (event.kind === "progress") {
    const log = job.log.slice();
    if (event.logLine) {
      log.push(event.logLine);
      while (log.length > 200) log.shift();
    }
    await withUser(actorId, (tx) => tx.update(jobsTable).set({
      status: "running",
      stage: event.stage ?? job.stage,
      progressPct: event.progressPct !== undefined
        ? Math.max(0, Math.min(100, Math.round(event.progressPct)))
        : job.progressPct,
      message: event.message ?? job.message,
      log,
      lastEventAt: new Date(),
    }).where(eq(jobsTable.id, job.id)));
    if (job.status === "queued") {
      await withUser(actorId, (tx) => tx.update(viewsTable)
        .set({ status: "analyzing" }).where(eq(viewsTable.id, view.viewId)));
    }
    return Response.json({ ok: true }, { headers: noStore });
  }

  // Telemetry rides along with whatever terminal state is being written, so a job can never
  // end up with an outcome recorded and its metrics lost to a second failed write.
  const metrics = event.stageMetrics;
  const finishRow = (
    status: "done" | "failed", stage: string, pct: number, message: string, log?: string[],
  ) =>
    withUser(actorId, (tx) => tx.update(jobsTable).set({
      status, stage, progressPct: pct, message, finishedAt: new Date(),
      lastEventAt: new Date(),
      ...(log ? { log } : {}),
      ...(metrics ? { jobMetrics: metrics } : {}),
    }).where(eq(jobsTable.id, job.id)));

  if (event.kind === "failed") {
    await finishRow("failed", job.stage, job.progressPct, event.reason);
    await markViewFailed(actorId, view.viewId, event.reason);
    return Response.json({ ok: true }, { headers: noStore });
  }

  // done — verify before believing.
  const targetRevision = claims.targetRevision;
  const address = { ...mediaAddress(view), revision: targetRevision };
  if (!(await isPublished(address))) {
    const reason = `worker reported done but analysis.json is missing at revision ${targetRevision}`;
    await finishRow("failed", job.stage, job.progressPct, reason);
    await markViewFailed(actorId, view.viewId, reason);
    return Response.json({ ok: false, error: reason }, { status: 409, headers: noStore });
  }
  // The true pipeline duration goes to the LOG — it is capacity-model telemetry (feeding the
  // analysis-latency SLO), not something a golfer acts on, so it never reaches a product screen.
  const doneLog = job.log.slice();
  if (event.elapsedS !== undefined) {
    doneLog.push(`pipeline elapsed ${event.elapsedS.toFixed(1)}s`);
    while (doneLog.length > 200) doneLog.shift();
  }
  await finishRow("done", "complete", 100, "analysis rewritten",
    event.elapsedS !== undefined ? doneLog : undefined);
  await markViewReady(actorId, view, targetRevision);
  return Response.json({ ok: true }, { headers: noStore });
}
