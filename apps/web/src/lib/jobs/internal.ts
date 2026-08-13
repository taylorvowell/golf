import { eq } from "drizzle-orm";
import { withUser } from "@/db/session";
import { jobs as jobsTable, swingViews as viewsTable } from "@/db/schema";
import { viewById, type ResolvedView } from "@/db/views";
import { bearerToken, verifyJobToken, type JobTokenClaims } from "@/lib/jobs/token";

/**
 * Shared plumbing for the `/api/internal/jobs/*` routes — the worker-facing surface.
 *
 * These routes have no user session; authority comes entirely from the signed per-job token
 * (see `token.ts`). Everything DB-side then runs as `claims.actorId` under normal RLS — the
 * same identity that enqueued the job. No route here may widen that: a token authorizes ONE
 * job's reads and writes, nothing else.
 */

export const noStore = { "Cache-Control": "no-store" };

export interface JobContext {
  claims: JobTokenClaims;
  job: typeof jobsTable.$inferSelect;
  view: ResolvedView;
}

/** Token → claims → the job row and its view, or an error Response ready to return. */
export async function requireJobAccess(
  req: Request,
  jobId: string,
): Promise<JobContext | { error: Response }> {
  const token = bearerToken(req);
  const claims = token ? verifyJobToken(token) : null;
  if (!claims || claims.jobId !== jobId) {
    return { error: Response.json({ error: "unauthorized" }, { status: 401, headers: noStore }) };
  }

  const found = await withUser(claims.actorId, async (tx) => {
    const rows = await tx.select().from(jobsTable).where(eq(jobsTable.id, jobId)).limit(1);
    const job = rows[0];
    if (!job || job.viewId !== claims.viewId || job.runner !== "queue") return null;
    const view = await viewById(tx, job.viewId);
    return view ? { job, view } : null;
  });
  if (!found) {
    return { error: Response.json({ error: "no such job" }, { status: 404, headers: noStore }) };
  }
  return { claims, ...found };
}

/** The stored original's key for a view, or null when no source was ever stored (D29). */
export async function rawMediaKeyFor(actorId: string, viewId: string): Promise<string | null> {
  return withUser(actorId, async (tx) => {
    const rows = await tx.select({ rawMediaKey: viewsTable.rawMediaKey })
      .from(viewsTable).where(eq(viewsTable.id, viewId)).limit(1);
    return rows[0]?.rawMediaKey ?? null;
  });
}
