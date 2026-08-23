import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { Client } from "@upstash/qstash";
import type { DbTx } from "@/db/session";
import { jobs as jobsTable, swingViews as viewsTable } from "@/db/schema";
import { mediaAddress, type ResolvedView } from "@/db/views";
import { getAnalysis } from "@/lib/swings";
import { SOURCE_BUCKET } from "@/lib/media/keys";
import { getMediaStore } from "@/lib/media/store";
import { signJobToken } from "@/lib/jobs/token";
import { clubVariants, envInt, queuePublishOptions } from "@/lib/jobs/policy";
import type { Job } from "@/lib/jobs";

/**
 * Enqueue side of the queue driver: create the job row (Postgres is the truth — D9), mint the
 * per-job token, and hand QStash a spec that names only URLs. The worker never sees a bucket,
 * a storage key, or a credential; the web app stays the single owner of media addressing.
 */

/** How long the worker's token stays valid. Covers queue wait + retries + a long analysis. */
const TOKEN_TTL_SECONDS = 6 * 60 * 60;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is unset — required when JOBS_DRIVER=queue`);
  return v;
}

/**
 * The job spec (schema 2) QStash carries to the worker. `analysis` is the step-03 schema-1
 * field set minus `video`/`out_dir`, which the worker derives from its own scratch space.
 */
export interface QueueJobSpec {
  schema: 2;
  job: {
    id: string;
    token: string;
    source_url: string;
    artifact_base_url: string;
    events_url: string;
  };
  analysis: {
    view: string;
    handedness: string;
    club_detector: string | null;
    /** Stated explicitly on every spec — see policy.clubVariants (JOBS_CLUB_VARIANTS). */
    club_variants: boolean;
  };
}

export async function enqueueReanalysis(
  tx: DbTx,
  actorId: string,
  view: ResolvedView,
): Promise<Job> {
  // The queue path's source is the STORE's copy, never a local path — a remote worker has no
  // access to this machine's fixtures directory. `raw_media_key` (D29) is where an uploaded
  // original lives; a swing without one cannot be queue-analysed yet.
  const rows = await tx.select({ rawMediaKey: viewsTable.rawMediaKey })
    .from(viewsTable).where(eq(viewsTable.id, view.viewId)).limit(1);
  const rawMediaKey = rows[0]?.rawMediaKey;
  if (!rawMediaKey) {
    throw new Error(
      "no stored source for this swing — queue analysis needs the original in the media store",
    );
  }
  const store = await getMediaStore();
  if (!(await store.exists(SOURCE_BUCKET, rawMediaKey))) {
    throw new Error(`stored source is missing from the store: ${rawMediaKey}`);
  }

  // View + handedness come from the stored artifact, exactly as the spawn path reads them —
  // never from a request body.
  const analysis = await getAnalysis(mediaAddress(view));
  if (!analysis) throw new Error("no analysis.json for this swing");

  // Never defaulted, never silent (the standing club-detector trap): the operator states the
  // detector path the WORKER should use, or states "none" to choose the classical path.
  const detector = requireEnv("WORKER_CLUB_DETECTOR");
  const clubDetector = detector === "none" ? null : detector;

  return publishJob(tx, {
    actorId,
    view,
    // Re-analysis writes the NEXT revision alongside the one a player may be mid-scrub on;
    // object storage has no rename-into-place, so overwriting is a real failure, not a theory.
    targetRevision: view.revision + 1,
    type: "reanalyze",
    analysis: {
      view: analysis.video.view,
      handedness: analysis.video.handedness,
      club_detector: clubDetector,
      club_variants: clubVariants(),
    },
  });
}

/**
 * Enqueue the FIRST analysis of a freshly captured clip.
 *
 * The sibling of `enqueueReanalysis`, and the difference is entirely in where the two facts the
 * worker needs come from. Re-analysis reads `view` and `handedness` back out of the stored
 * artifact, which is right there precisely because a previous run wrote it. A capture has no
 * artifact yet, so they come from the rows the ingest just created — the capture screen's view
 * toggle and the golfer's profile handedness, both stated rather than inferred. Nothing here
 * guesses: `handedness` is `NOT NULL` on the swing and `view` is `NOT NULL` on the view row.
 *
 * `targetRevision` is the view's CURRENT revision, not the next one. A fresh view is revision 1
 * with nothing published under it, so the first run fills that revision rather than skipping to 2
 * and leaving an empty prefix behind forever.
 */
export async function enqueueCapture(
  tx: DbTx,
  actorId: string,
  view: ResolvedView,
  handedness: "right" | "left",
): Promise<Job> {
  const rows = await tx.select({ rawMediaKey: viewsTable.rawMediaKey })
    .from(viewsTable).where(eq(viewsTable.id, view.viewId)).limit(1);
  const rawMediaKey = rows[0]?.rawMediaKey;
  if (!rawMediaKey) {
    throw new Error("this view has no uploaded source yet — complete the upload first");
  }
  const store = await getMediaStore();
  if (!(await store.exists(SOURCE_BUCKET, rawMediaKey))) {
    throw new Error(`stored source is missing from the store: ${rawMediaKey}`);
  }

  const detector = requireEnv("WORKER_CLUB_DETECTOR");
  return publishJob(tx, {
    actorId,
    view,
    targetRevision: view.revision,
    type: "analyze",
    analysis: {
      view: view.view,
      handedness,
      club_detector: detector === "none" ? null : detector,
      club_variants: clubVariants(),
    },
  });
}

/**
 * The half both enqueue paths share: mint the job row and its token, then hand QStash a spec that
 * names only URLs.
 *
 * Extracted rather than duplicated because the properties that make the queue path safe all live
 * in here — the row is written before dispatch, the worker receives no credential, and flow
 * control plus the failure callback are attached to every publish. A second copy is a second place
 * for one of those to be quietly omitted.
 */
async function publishJob(
  tx: DbTx,
  opts: {
    actorId: string;
    view: ResolvedView;
    targetRevision: number;
    type: "analyze" | "reanalyze";
    analysis: QueueJobSpec["analysis"];
  },
): Promise<Job> {
  const { actorId, view, targetRevision, type } = opts;
  const jobId = randomUUID();
  const token = signJobToken({
    jobId,
    viewId: view.viewId,
    actorId,
    targetRevision,
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
  });

  const base = requireEnv("APP_INTERNAL_BASE_URL").replace(/\/$/, "");
  const spec: QueueJobSpec = {
    schema: 2,
    job: {
      id: jobId,
      token,
      source_url: `${base}/api/internal/jobs/${jobId}/source`,
      artifact_base_url: `${base}/api/internal/jobs/${jobId}/artifacts`,
      events_url: `${base}/api/internal/jobs/${jobId}/events`,
    },
    analysis: opts.analysis,
  };

  const job: Job = {
    id: jobId,
    viewId: view.viewId,
    status: "queued",
    stage: "queued",
    progressPct: 0,
    message: "queued for the analysis worker",
    log: [],
    startedAt: Date.now(),
    finishedAt: null,
    lastEventAt: null,
    runner: "queue",
  };

  await tx.insert(jobsTable).values({
    id: jobId, viewId: view.viewId, type,
    status: "queued", stage: "queued", progressPct: 0, message: job.message, log: [],
    runner: "queue", targetRevision,
  });
  await tx.update(viewsTable).set({ status: "queued" }).where(eq(viewsTable.id, view.viewId));

  // Dispatch AFTER the row exists: a delivered job whose row is missing is a bug, a row whose
  // dispatch failed is just a failed enqueue the caller sees as a thrown error.
  const client = new Client({
    baseUrl: requireEnv("QSTASH_URL"),
    token: requireEnv("QSTASH_TOKEN"),
  });
  // Flow control keyed by the enqueuing user (fairness: a burst queues behind itself, not in
  // front of everyone else); the failure callback is how retry exhaustion becomes a failed row
  // instead of a message silently parked in the DLQ.
  await client.publishJSON({
    ...queuePublishOptions({
      workerUrl: requireEnv("WORKER_URL"),
      actorId,
      failureCallbackUrl: `${base}/api/internal/jobs/${jobId}/failure`,
      parallelism: envInt("JOBS_FLOW_PARALLELISM", 1),
    }),
    body: spec,
  });

  return job;
}
