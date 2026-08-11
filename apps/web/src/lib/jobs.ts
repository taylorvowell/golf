import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { withUser, type DbTx } from "@/db/session";
import { jobs as jobsTable, swingViews as viewsTable } from "@/db/schema";
import { syncSwingScore } from "@/db/scores";
import { mediaAddress, type ResolvedView } from "@/db/views";
import { getAnalysis } from "@/lib/swings";
import { publishFromWorkingDir, workingDirFor } from "@/lib/media/publish";

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
  };
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
 * driving the analysis, and `jobs_write` only admits the owner. That is the point — a coach
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
  // an approved coach may legitimately read this job (`jobs_select` follows the swing), but
  // `jobs_write` admits the owner only, so a coach polling a stuck job settles nothing. Correct —
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
 * here — a coach may watch a golfer's swing, not spend GPU time on it.
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
  };
  live.set(view.viewId, job);

  await tx.insert(jobsTable).values({
    id: job.id, viewId: view.viewId, type: "reanalyze",
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
    "--view", analysis.video.view,
    "--handedness", analysis.video.handedness,
  ];

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
       * `r<n+1>`. Only the row update below makes the new revision current, so a golfer mid-scrub
       * finishes their session on the artifacts they started it with rather than having the video
       * swapped underneath them — step 09's "does not orphan or overwrite artifacts another
       * session is reading", made true by an ordering rather than by a lock.
       *
       * If publishing fails the row is left alone: `r<n>` is still complete and still current, so
       * a failed publish costs the re-analysis, not the swing.
       */
      const revision = view.revision + 1;
      const address = { ...mediaAddress(view), revision };
      let publishError: string | null = null;
      try {
        await publishFromWorkingDir(address, workingDirFor(view.mediaKey));
      } catch (err) {
        publishError = err instanceof Error ? err.message : String(err);
      }

      if (publishError) {
        await withUser(actorId, (t) => t.update(viewsTable).set({
          status: "failed",
          failureReason: `analysis succeeded but publishing failed: ${publishError}`,
        }).where(eq(viewsTable.id, view.viewId))).catch(() => {});
      } else {
        // Read back through the store rather than off disk: it is the published copy the player
        // will get, so anything wrong with the publish shows up here rather than at playback.
        const fresh = await getAnalysis(address).catch(() => null);
        await withUser(actorId, (t) => t.update(viewsTable).set({
          status: "ready",
          analyzedAt: new Date(),
          artifactRevision: revision,
          fps: fresh?.video.fps,
          frameCount: fresh?.video.frame_count,
          width: fresh?.video.width,
          height: fresh?.video.height,
        }).where(eq(viewsTable.id, view.viewId))).catch(() => {});
        await withUser(actorId, (t) => syncSwingScore(t, { ...view, revision })).catch(() => {});
      }
    } else {
      await withUser(actorId, (t) => t.update(viewsTable)
        .set({ status: "failed", failureReason: message })
        .where(eq(viewsTable.id, view.viewId))).catch(() => {});
    }
  };

  child.on("error", (err) => {
    finish("failed", job.stage, job.progressPct, `could not start ${PYTHON}: ${err.message}`);
  });

  child.on("close", (code) => {
    if (job.status === "failed") return; // child.on("error") already finished it
    if (code === 0) finish("done", "complete", 100, "analysis rewritten");
    else finish("failed", job.stage, job.progressPct, `analyzer exited ${code} — see log`);
  });

  return job;
}

