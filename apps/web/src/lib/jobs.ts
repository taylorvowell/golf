import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { withUser, type DbTx } from "@/db/session";
import { jobs as jobsTable, swings as swingsTable, swingViews as viewsTable } from "@/db/schema";
import { envInt, queueAdmission, queueOrphanVerdict } from "@/lib/jobs/policy";
import { syncSwingScore } from "@/db/scores";
import { mediaAddress, type ResolvedView } from "@/db/views";
import { getAnalysis } from "@/lib/swings";
import { publishFromWorkingDir, workingDirFor } from "@/lib/media/publish";
import { markViewFailed, markViewReady } from "@/lib/jobs/complete";

/**
 * Re-analysis jobs, persisted in Postgres — replacing the
 * `Map<string, Job>` this used to be. Same the architecture spec protocol (POST starts, GET polls
 * stage/progress/message); only the storage changed, which was the whole point: a Next
 * hot-reload used to silently lose a running job's status while the Python process kept going
 * (this module's previous comment called that out by name). Now the DB row survives the
 * reload — polling after one just reads slightly-stale-but-correct state instead of "idle".
 *
 * While a job is running *in this process*, updates go through an in-memory mirror first (so a
 * DB round-trip never sits on the per-frame stdout hot path) and are persisted at stage
 * transitions plus a throttled periodic flush — not on every line, which would be a write per
 * video frame.
 */
export type JobStatus = "queued" | "running" | "done" | "failed";

export interface Job {
  id: string;
  /** The VIEW being analysed. One job runs the analyzer over one clip. */
  viewId: string;
  status: JobStatus;
  stage: string;
  progressPct: number;
  message: string;
  log: string[];
  startedAt: number;
  finishedAt: number | null;
  /** Queue jobs only: the worker's last event post — the orphan sweep's heartbeat. */
  lastEventAt: number | null;
  /** Which path runs it: a child process here (`spawn`) or the hosted worker (`queue`). */
  runner: "spawn" | "queue";
}

function toJob(row: typeof jobsTable.$inferSelect): Job {
  return {
    id: row.id,
    viewId: row.viewId,
    status: row.status as JobStatus,
    stage: row.stage,
    progressPct: row.progressPct,
    message: row.message,
    log: row.log,
    startedAt: row.startedAt.getTime(),
    finishedAt: row.finishedAt ? row.finishedAt.getTime() : null,
    lastEventAt: row.lastEventAt ? row.lastEventAt.getTime() : null,
    runner: row.runner,
  };
}

/**
 * Which job driver is in play. **Queue is opt-in, never inferred** — same rule as
 * `mediaDriverName()`, for the same reason: this environment can hold QStash configuration
 * while its analysis still runs locally, and inference would silently route every re-analysis
 * at a worker that may not be running.
 */
export function jobsDriverName(): "spawn" | "queue" {
  return process.env.JOBS_DRIVER === "queue" ? "queue" : "spawn";
}

/** In-process mirror of whatever job this process is actively running, keyed by view id. */
const live = new Map<string, Job>();
const flushTimers = new Map<string, ReturnType<typeof setInterval>>();

/** Repo root, from apps/web. */
const REPO_ROOT = path.resolve(process.cwd(), "..", "..");
const ANALYZER = path.join(REPO_ROOT, "services", "analyzer");
const PYTHON =
  process.env.SWINGSAGE_PYTHON ??
  path.join(ANALYZER, ".venv", process.platform === "win32" ? "Scripts" : "bin",
            process.platform === "win32" ? "python.exe" : "python");

/**
 * Stage weights for the progress bar, from measured wall-clock on the fixtures (~80-95s
 * total). Deliberately not evenly spaced: normalize and the two pose passes are most of the
 * run, and a bar that implies otherwise reads as a hang. Each entry is the percentage
 * *reached* when that stage's line appears in burnin's output.
 */
const STAGES: [RegExp, string, number][] = [
  [/^source /, "probe", 3],
  [/^normalized /, "normalize", 22],
  [/mediapipe\s+\d+ frames/, "pose (localiser)", 42],
  [/rtmpose\s+\d+ frames/, "pose", 66],
  [/^stage3 /, "pose-post", 72],
  [/^events /, "events", 76],
  [/^ *club /, "club", 88],
  [/^ *face /, "face", 90],
  [/^metrics /, "metrics", 93],
  [/^coach /, "coach", 97],
  [/^rendered /, "render", 99],
];

/**
 * Persist a job's state.
 *
 * `actorId` rather than the swing's owner: a job row is written under the identity of whoever is
 * driving the analysis, and `jobs_write` only admits the owner. That is the point — an instructor
 * polling a golfer's swing must not be silently promoted to the golfer in order to write a row.
 *
 * Called from `setInterval` and from the child process's `close` handler, both of which run long
 * after the request that started them has ended. `withUser` opens its own transaction each time,
 * so it works identically on and off a request — there is no ambient context to lose.
 */
async function persist(actorId: string, job: Job) {
  await withUser(actorId, (tx) => tx.update(jobsTable).set({
    status: job.status,
    stage: job.stage,
    progressPct: job.progressPct,
    message: job.message,
    log: job.log,
    finishedAt: job.finishedAt ? new Date(job.finishedAt) : null,
  }).where(eq(jobsTable.id, job.id)));
}

/**
 * Settle a job whose owner is gone, from what the analyzer left on disk.
 *
 * `live` and the child's stdout listeners are per-process. A job started in one worker and
 * polled from another finds no `live` entry, and if the owning worker never runs `finish()` the
 * row stays "running" forever — so the UI polls a completed analysis indefinitely and never
 * reloads. Observed exactly that: the artifact was rewritten, and the row sat at
 * "normalize 22%" until it was deleted by hand.
 *
 * The analyzer holds `.analysis.lock` for the whole run and clears it on exit (`OutputLock`,
 * atexit), so its absence means the process is gone — no guessing from elapsed time. Whether it
 * *succeeded* is then a fact about the artifact: `analysis.json` newer than the job started.
 * Both are read rather than inferred, which is why this cannot mark a running job dead.
 */
async function reconcile(actorId: string, job: Job, view: ResolvedView): Promise<Job> {
  if (job.status !== "running" && job.status !== "queued") return job;
  // A queue job's working directory is on the worker's machine — the lock and artifact the
  // spawn probe below reads do not exist here. Its liveness evidence is the heartbeat
  // instead: the events route stamps `last_event_at` on every post the worker makes, so a
  // `running` row whose heartbeat went stale, or a `queued` row that outlived the delivery
  // window (QStash's whole retry schedule), is settled `failed` on the next poll. The
  // failure callback usually gets there first for undelivered messages; this sweep is the
  // backstop for a worker host that died mid-run — which posts nothing, ever again.
  if (job.runner !== "spawn") return reconcileQueue(actorId, job);
  const dir = workingDirFor(view.mediaKey);
  try {
    await fs.access(path.join(dir, ".analysis.lock"));
    return job;                        // lock still held — genuinely running elsewhere
  } catch { /* no lock: the analyzer process is gone */ }

  let wroteArtifact = false;
  try {
    const st = await fs.stat(path.join(dir, "analysis.json"));
    wroteArtifact = st.mtimeMs > job.startedAt;
  } catch { /* no artifact at all */ }

  job.finishedAt = Date.now();
  // Every write here is best-effort and always was. What changed with D42 is *why* one can fail:
  // an approved instructor may legitimately read this job (`jobs_select` follows the swing), but
  // `jobs_write` admits the owner only, so an instructor polling a stuck job settles nothing. Correct —
  // the golfer's next poll does it — and the alternative, running these as the owner, would put an
  // elevated write on a request path.
  if (wroteArtifact) {
    job.status = "done";
    job.stage = "complete";
    job.progressPct = 100;
    job.message = "analysis rewritten";
    await withUser(actorId, (tx) => tx.update(viewsTable)
      .set({ status: "ready", analyzedAt: new Date() })
      .where(eq(viewsTable.id, job.viewId))).catch(() => {});
    await withUser(actorId, (tx) => syncSwingScore(tx, view)).catch(() => {});
  } else {
    job.status = "failed";
    job.message = "the analyzer stopped without writing an analysis — see log";
    await withUser(actorId, (tx) => tx.update(viewsTable)
      .set({ status: "failed", failureReason: job.message })
      .where(eq(viewsTable.id, job.viewId))).catch(() => {});
  }
  await persist(actorId, job).catch(() => {});
  return job;
}

/**
 * Settle a queue job the remote side will never finish. Same best-effort write semantics as
 * the spawn branch: `jobs_write` admits the owner only, so an instructor's poll settles nothing and
 * the golfer's next poll does it.
 */
async function reconcileQueue(actorId: string, job: Job): Promise<Job> {
  const verdict = queueOrphanVerdict(job, Date.now(), {
    heartbeatTimeoutMs: envInt("JOBS_QUEUE_HEARTBEAT_TIMEOUT_S", 900) * 1000,
    pendingTimeoutMs: envInt("JOBS_QUEUE_PENDING_TIMEOUT_S", 3600) * 1000,
  });
  if (verdict === "alive") return job;

  const reason = verdict === "silent-worker"
    ? "the worker went silent mid-analysis — no progress within the heartbeat window"
    : "the analysis was never delivered to a worker";
  job.status = "failed";
  job.message = reason;
  job.finishedAt = Date.now();
  await withUser(actorId, (tx) => tx.update(jobsTable).set({
    status: "failed", message: reason, error: reason, finishedAt: new Date(),
  }).where(eq(jobsTable.id, job.id))).catch(() => {});
  await withUser(actorId, (tx) => tx.update(viewsTable)
    .set({ status: "failed", failureReason: reason })
    .where(eq(viewsTable.id, job.viewId))).catch(() => {});
  return job;
}

export async function getJob(tx: DbTx, actorId: string, view: ResolvedView): Promise<Job | null> {
  const inMemory = live.get(view.viewId);
  if (inMemory) return inMemory;

  const rows = await tx.select().from(jobsTable)
    .where(eq(jobsTable.viewId, view.viewId))
    .orderBy(desc(jobsTable.startedAt))
    .limit(1);
  // `reconcile` opens its own transactions rather than using `tx`: it writes, and a policy
  // violation inside the caller's transaction would abort the whole read.
  return rows[0] ? await reconcile(actorId, toJob(rows[0]), view) : null;
}

/**
 * `actorId` is the caller, and the reanalyze route rejects anyone but the owner before reaching
 * here — an instructor may watch a golfer's swing, not spend GPU time on it.
 */
export async function startReanalysis(
  tx: DbTx,
  actorId: string,
  view: ResolvedView,
): Promise<Job> {
  const existing = await getJob(tx, actorId, view);
  if (existing && (existing.status === "running" || existing.status === "queued")) {
    return existing;
  }

  if (jobsDriverName() === "queue") {
    await refuseOverActorCap(tx, actorId);

    // Dynamic import so the spawn path never loads the QStash client or its configuration.
    const { enqueueReanalysis } = await import("@/lib/jobs/dispatch");
    return enqueueReanalysis(tx, actorId, view);
  }

  // Every input comes from the swing's own stored artifact, never from the request body —
  // this route spawns a process, so the only path it will ever pass to it is one the
  // analyzer itself wrote.
  const analysis = await getAnalysis(mediaAddress(view));
  if (!analysis) throw new Error("no analysis.json for this swing");
  const src = analysis.video.source.path;
  if (!src) throw new Error("this analysis predates source-path recording; re-run by hand");
  try {
    await fs.access(src);
  } catch {
    throw new Error(`source clip is gone: ${src}`);
  }

  return spawnAnalysis(tx, actorId, view, {
    type: "reanalyze",
    sourcePath: src,
    viewType: analysis.video.view,
    handedness: analysis.video.handedness,
  });
}

/**
 * Backpressure at the door: one user piles work behind their own cap, never behind everyone
 * else's. The per-view "one active job" checks still apply; this bounds the actor ACROSS
 * views. The count joins to swing ownership rather than trusting RLS visibility, which also
 * admits instructor-readable rows. Shared by both enqueue doors — re-analysis and first
 * capture — because the capture path ran with no admission at all until 2026-08-26.
 */
async function refuseOverActorCap(tx: DbTx, actorId: string): Promise<void> {
  const cap = envInt("JOBS_MAX_ACTIVE_PER_USER", 3);
  const active = await tx.select({ id: jobsTable.id })
    .from(jobsTable)
    .innerJoin(viewsTable, eq(jobsTable.viewId, viewsTable.id))
    .innerJoin(swingsTable, eq(viewsTable.swingId, swingsTable.id))
    .where(and(
      eq(swingsTable.userId, actorId),
      eq(jobsTable.runner, "queue"),
      inArray(jobsTable.status, ["queued", "running"]),
    ));
  const refusal = queueAdmission(active.length, cap);
  if (refusal) throw new Error(refusal);
}

/**
 * The FIRST analysis of a freshly uploaded capture, run as a child process of this server.
 *
 * The queue path (`enqueueCapture`) hands a hosted worker a set of URLs and is what production
 * uses. This is its local twin, and it exists because without it the capture loop cannot be run
 * end to end on one machine at all: `startReanalysis`'s spawn path re-runs from an EXISTING
 * `analysis.json`, and a swing that has just been recorded does not have one yet.
 *
 * It needs the source as a file a Python process can open, which is why it asks the store for a
 * `localPath` and refuses rather than guessing when there is none — a cloud-backed deployment
 * has no such path, and that is exactly the deployment that should be on the queue driver.
 */
export async function startCaptureAnalysis(
  tx: DbTx,
  actorId: string,
  view: ResolvedView,
  handedness: "right" | "left",
): Promise<Job> {
  if (jobsDriverName() === "queue") {
    // Same guard order as `startReanalysis`, closed 2026-08-26: the capture door had neither
    // check, so a double `source/complete` (a client retry, a dropped response) minted two
    // QStash jobs for one view. A live job is returned as-is — the route's advertised
    // re-enqueue-as-retry applies to failed/absent jobs only.
    const existing = await getJob(tx, actorId, view);
    if (existing && (existing.status === "running" || existing.status === "queued")) {
      return existing;
    }
    await refuseOverActorCap(tx, actorId);
    const { enqueueCapture } = await import("@/lib/jobs/dispatch");
    return enqueueCapture(tx, actorId, view, handedness);
  }

  const existing = await getJob(tx, actorId, view);
  if (existing && (existing.status === "running" || existing.status === "queued")) {
    return existing;
  }

  const rows = await tx.select({ rawMediaKey: viewsTable.rawMediaKey })
    .from(viewsTable).where(eq(viewsTable.id, view.viewId)).limit(1);
  const rawMediaKey = rows[0]?.rawMediaKey;
  if (!rawMediaKey) {
    throw new Error("this view has no uploaded source yet — complete the upload first");
  }

  const { SOURCE_BUCKET } = await import("@/lib/media/keys");
  const { getMediaStore } = await import("@/lib/media/store");
  const store = await getMediaStore();
  const src = await store.localPath(SOURCE_BUCKET, rawMediaKey);
  if (!src) {
    throw new Error(
      "the uploaded clip is not a file on this machine, so it cannot be analysed by a local " +
        "process — set JOBS_DRIVER=queue for a hosted media store",
    );
  }

  return spawnAnalysis(tx, actorId, view, {
    type: "analyze",
    sourcePath: src,
    viewType: view.view,
    handedness,
  });
}

/**
 * Run `burnin.py` over one clip as a child of this process, streaming its output into the job row.
 *
 * Shared by the first analysis of a capture and by a re-analysis, because everything after
 * "which file, which angle, which hand" is identical — and the parts that make it safe (the
 * throttled persistence, publishing to the NEXT revision before the row moves, marking the view
 * failed rather than leaving it analysing) are exactly the parts a second copy would drift on.
 */
async function spawnAnalysis(
  tx: DbTx,
  actorId: string,
  view: ResolvedView,
  input: {
    type: "analyze" | "reanalyze";
    sourcePath: string;
    viewType: string;
    handedness: string;
  },
): Promise<Job> {
  const src = input.sourcePath;

  const job: Job = {
    id: randomUUID(),
    viewId: view.viewId,
    status: "running",
    stage: "queued",
    progressPct: 0,
    message: "starting analyzer",
    log: [],
    startedAt: Date.now(),
    finishedAt: null,
    lastEventAt: null,
    runner: "spawn",
  };
  live.set(view.viewId, job);

  await tx.insert(jobsTable).values({
    id: job.id, viewId: view.viewId, type: input.type,
    status: job.status, stage: job.stage, progressPct: job.progressPct, message: job.message,
    log: job.log,
  });
  await tx.update(viewsTable).set({ status: "analyzing" }).where(eq(viewsTable.id, view.viewId));

  // Throttled durability: the fast path (below) mutates `job` in memory on every stdout line;
  // this flush is what makes that survive a hot-reload without a DB write per line.
  const timer = setInterval(() => { persist(actorId, job).catch(() => {}); }, 2000);
  flushTimers.set(view.viewId, timer);

  const args = [
    path.join("scripts", "burnin.py"), src,
    "--out", workingDirFor(view.mediaKey),
    "--view", input.viewType,
    "--handedness", input.handedness,
  ];
  // The trained detector, when this machine has one configured. Omitting it silently falls back
  // to the weaker classical trace — the standing trap in root `CLAUDE.md`, which had until now
  // applied to the CLI only because the spawn path never passed it either.
  const detector = process.env.WORKER_CLUB_DETECTOR;
  if (detector && detector !== "none") args.push("--club-detector", detector);

  const child: ChildProcess = spawn(PYTHON, args, { cwd: ANALYZER, windowsHide: true });

  const absorb = (buf: Buffer) => {
    for (const raw of buf.toString().split(/\r?\n/)) {
      const line = raw.trimEnd();
      if (!line) continue;
      // ONNX runtime and MediaPipe write a wall of initialiser warnings to stderr on every
      // run. They are not errors and they would bury the real output.
      if (/onnxruntime|Removing initializer|InitGoogle|inference_feedback|XNNPACK|landmark_projection/.test(line)) continue;

      // Per-frame progress overwrites one line with \r; keep it as a message, not a log entry.
      const perFrame = /pose (\d+)\/(\d+)/.exec(line);
      if (perFrame) {
        job.message = `frame ${perFrame[1]} of ${perFrame[2]}`;
        continue;
      }

      job.log.push(line);
      if (job.log.length > 200) job.log.shift();
      for (const [re, stage, pct] of STAGES) {
        if (re.test(line)) {
          job.stage = stage;
          job.progressPct = pct;
          job.message = line.trim();
          persist(actorId, job).catch(() => {}); // stage transitions are rare; persist immediately
          break;
        }
      }
    }
  };

  child.stdout?.on("data", absorb);
  child.stderr?.on("data", absorb);

  const finish = async (status: JobStatus, stage: string, progressPct: number, message: string) => {
    job.status = status;
    job.stage = stage;
    job.progressPct = progressPct;
    job.message = message;
    job.finishedAt = Date.now();

    clearInterval(flushTimers.get(view.viewId));
    flushTimers.delete(view.viewId);
    live.delete(view.viewId);

    await persist(actorId, job).catch(() => {});
    if (status === "done") {
      /**
       * Publish before the row moves, and publish to the NEXT revision.
       *
       * The analyzer has just rewritten its working directory in place; nothing the player is
       * currently reading has changed yet, because the player addresses `r<n>` and this writes
       * `r<n+1>`. Only the `markViewReady` update makes the new revision current, so a golfer
       * mid-scrub finishes their session on the artifacts they started it with rather than
       * having the video swapped underneath them — step 09's "does not orphan or overwrite
       * artifacts another session is reading", made true by an ordering rather than by a lock.
       *
       * If publishing fails the row is left alone: `r<n>` is still complete and still current,
       * so a failed publish costs the re-analysis, not the swing.
       */
      const revision = view.revision + 1;
      let publishError: string | null = null;
      try {
        await publishFromWorkingDir({ ...mediaAddress(view), revision }, workingDirFor(view.mediaKey));
      } catch (err) {
        publishError = err instanceof Error ? err.message : String(err);
      }

      if (publishError) {
        await markViewFailed(actorId, view.viewId,
          `analysis succeeded but publishing failed: ${publishError}`);
      } else {
        await markViewReady(actorId, view, revision);
      }
    } else {
      await markViewFailed(actorId, view.viewId, message);
    }
  };

  child.on("error", (err) => {
    finish("failed", job.stage, job.progressPct, `could not start ${PYTHON}: ${err.message}`);
  });

  child.on("close", (code) => {
    if (job.status === "failed") return; // child.on("error") already finished it
    if (code === 0) {
      finish("done", "complete", 100,
        input.type === "analyze" ? "analysis complete" : "analysis rewritten");
    }
    else finish("failed", job.stage, job.progressPct, `analyzer exited ${code} — see log`);
  });

  return job;
}

