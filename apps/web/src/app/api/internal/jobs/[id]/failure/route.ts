import { eq } from "drizzle-orm";
import { withUser } from "@/db/session";
import { jobs as jobsTable } from "@/db/schema";
import { markViewFailed } from "@/lib/jobs/complete";
import { jobContextForClaims, noStore } from "@/lib/jobs/internal";
import { parseFailureCallback } from "@/lib/jobs/policy";
import { verifyJobToken } from "@/lib/jobs/token";

/**
 * QStash's failure callback: fired once a message has exhausted its retries and moved to the
 * DLQ. Without this route, retry exhaustion is invisible — the row would sit `queued` until
 * the orphan sweep's pending window settles it, and nothing would record WHERE the dead
 * message went.
 *
 * Authority: the callback payload carries the ORIGINAL message (`sourceBody`, base64) — our
 * own job spec, which holds the signed per-job token. That token is the credential, exactly
 * as on the other internal routes; the transport differs, the verification does not. The
 * `body` field (the destination's last response) is never trusted for identity. Writes run
 * as the enqueuing user under normal RLS (D26).
 */

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return Response.json({ error: "unrecognized payload" }, { status: 400, headers: noStore });
  }
  const info = parseFailureCallback(payload);
  if (!info) {
    return Response.json({ error: "unrecognized payload" }, { status: 400, headers: noStore });
  }

  const claims = info.specToken ? verifyJobToken(info.specToken) : null;
  const access = await jobContextForClaims(claims, id);
  if ("error" in access) return access.error;
  const { claims: verified, job, view } = access;

  // The sweep (or a late worker post) may have settled the row first — land soft, same rule
  // as the events route's redelivery short-circuit.
  if (job.status === "done" || job.status === "failed") {
    return Response.json({ ok: true, alreadyTerminal: true }, { headers: noStore });
  }

  const attempts = info.retried !== null && info.maxRetries !== null
    ? ` after ${info.retried + 1} of ${info.maxRetries + 1} deliveries`
    : "";
  const lastStatus = info.responseStatus !== null
    ? ` (last response ${info.responseStatus})`
    : "";
  const reason = `analysis delivery failed${attempts}${lastStatus} — the worker never completed it`;

  const log = job.log.slice();
  if (info.dlqId) {
    log.push(`dead-lettered: dlqId ${info.dlqId}`);
    while (log.length > 200) log.shift();
  }

  await withUser(verified.actorId, (tx) => tx.update(jobsTable).set({
    status: "failed",
    message: reason,
    error: reason,
    log,
    finishedAt: new Date(),
    lastEventAt: new Date(),
  }).where(eq(jobsTable.id, job.id)));
  await markViewFailed(verified.actorId, view.viewId, reason);

  return Response.json({ ok: true }, { headers: noStore });
}
