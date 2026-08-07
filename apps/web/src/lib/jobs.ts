import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { jobs as jobsTable, swings as swingsTable } from "@/db/schema";
import { syncSwingScore } from "@/db/scores";
import { MEDIA_ROOT, getAnalysis } from "@/lib/swings";
import { IMPLEMENTED_TESTS, type TrackingTestId } from "@/lib/clubTests";

/**
 * Re-analysis jobs, persisted in Postgres (docs/DECISIONS.md D38) — replacing the
 * `Map<string, Job>` this used to be. Same doc 02 protocol (POST starts, GET polls
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
  swingId: string;
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
    swingId: row.swingId,
    status: row.status as JobStatus,
    stage: row.stage,
    progressPct: row.progressPct,
    message: row.message,
    log: row.log,
    startedAt: row.startedAt.getTime(),
    finishedAt: row.finishedAt ? row.finishedAt.getTime() : null,
  };
}

/** In-process mirror of whatever job this process is actively running, keyed by swing id. */
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

async function persist(job: Job) {
  await db.update(jobsTable).set({
    status: job.status,
    stage: job.stage,
    progressPct: job.progressPct,
    message: job.message,
    log: job.log,
    finishedAt: job.finishedAt ? new Date(job.finishedAt) : null,
  }).where(eq(jobsTable.id, job.id));
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
async function reconcile(job: Job): Promise<Job> {
  if (job.status !== "running" && job.status !== "queued") return job;
  const dir = path.join(MEDIA_ROOT, job.swingId);
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
  if (wroteArtifact) {
    job.status = "done";
    job.stage = "complete";
    job.progressPct = 100;
    job.message = "analysis rewritten";
    await db.update(swingsTable).set({ status: "ready", analyzedAt: new Date() })
      .where(eq(swingsTable.id, job.swingId)).catch(() => {});
    await syncSwingScore(job.swingId).catch(() => {});
  } else {
    job.status = "failed";
    job.message = "the analyzer stopped without writing an analysis — see log";
    await db.update(swingsTable).set({ status: "failed", failureReason: job.message })
      .where(eq(swingsTable.id, job.swingId)).catch(() => {});
  }
  await persist(job).catch(() => {});
  return job;
}

export async function getJob(swingId: string): Promise<Job | null> {
  const inMemory = live.get(swingId);
  if (inMemory) return inMemory;

  // Filter to full-analysis job types: a club-test job on the same swing (below) must not
  // hijack the re-analyze poll, and vice versa.
  const rows = await db.select().from(jobsTable)
    .where(and(eq(jobsTable.swingId, swingId),
               inArray(jobsTable.type, ["analyze", "reanalyze"])))
    .orderBy(desc(jobsTable.startedAt))
    .limit(1);
  return rows[0] ? await reconcile(toJob(rows[0])) : null;
}

export async function startReanalysis(swingId: string): Promise<Job> {
  const existing = await getJob(swingId);
  if (existing && (existing.status === "running" || existing.status === "queued")) {
    return existing;
  }

  // Every input comes from the swing's own stored artifact, never from the request body —
  // this route spawns a process, so the only path it will ever pass to it is one the
  // analyzer itself wrote.
  const analysis = await getAnalysis(swingId);
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
    swingId,
    status: "running",
    stage: "queued",
    progressPct: 0,
    message: "starting analyzer",
    log: [],
    startedAt: Date.now(),
    finishedAt: null,
  };
  live.set(swingId, job);

  await db.insert(jobsTable).values({
    id: job.id, swingId, type: "reanalyze",
    status: job.status, stage: job.stage, progressPct: job.progressPct, message: job.message,
    log: job.log,
  });
  await db.update(swingsTable).set({ status: "analyzing" }).where(eq(swingsTable.id, swingId));

  // Throttled durability: the fast path (below) mutates `job` in memory on every stdout line;
  // this flush is what makes that survive a hot-reload without a DB write per line.
  const timer = setInterval(() => { persist(job).catch(() => {}); }, 2000);
  flushTimers.set(swingId, timer);

  const args = [
    path.join("scripts", "burnin.py"), src,
    "--out", path.join(MEDIA_ROOT, swingId),
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
          persist(job).catch(() => {}); // stage transitions are rare; persist immediately
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

    clearInterval(flushTimers.get(swingId));
    flushTimers.delete(swingId);
    live.delete(swingId);

    await persist(job).catch(() => {});
    if (status === "done") {
      // Stage 8 writes coach_report.json alongside analysis.json — the web app re-reads
      // whatever the analyzer just produced, same pattern as everywhere else in this codebase
      // (analysis.json is the artifact of record, not a value passed around).
      const fresh = await getAnalysis(swingId).catch(() => null);
      await db.update(swingsTable).set({
        status: "ready",
        analyzedAt: new Date(),
        fps: fresh?.video.fps,
        frameCount: fresh?.video.frame_count,
        width: fresh?.video.width,
        height: fresh?.video.height,
      }).where(eq(swingsTable.id, swingId)).catch(() => {});
      await syncSwingScore(swingId).catch(() => {});
    } else {
      await db.update(swingsTable).set({ status: "failed", failureReason: message })
        .where(eq(swingsTable.id, swingId)).catch(() => {});
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

/* ------------------------------------------------------------------------------------------
 * Club-tracking experiment jobs (12-test plan, D55).
 *
 * Same protocol and storage as re-analysis, deliberately lighter: `scripts/club_test.py`
 * runs one registered tracker over the stored artifact and merges a `club_tracking`
 * experiment block — seconds for the deterministic tests, minutes for the model-based ones
 * later. Separate `live` map and a type-filtered lookup so a club test and a re-analysis on
 * the same swing never collide on "the latest job". The job row stores the test id in
 * `stage`, which is what reconciliation reads back to check the artifact.
 */
const liveClub = new Map<string, Job>();

async function reconcileClubTest(job: Job): Promise<Job> {
  if (job.status !== "running" && job.status !== "queued") return job;
  const dir = path.join(MEDIA_ROOT, job.swingId);
  try {
    await fs.access(path.join(dir, ".experiment.lock"));
    return job;                        // merge in progress elsewhere
  } catch { /* no lock: the runner is gone — settle from the artifact */ }

  const analysis = await getAnalysis(job.swingId).catch(() => null);
  const merged = Boolean(
    analysis?.club_tracking?.experiments?.[job.stage as TrackingTestId]);
  job.finishedAt = Date.now();
  if (merged) {
    job.status = "done";
    job.progressPct = 100;
    job.message = "experiment merged";
  } else {
    job.status = "failed";
    job.message = "the test runner stopped without merging a result — see log";
  }
  await persist(job).catch(() => {});
  return job;
}

export async function getClubTestJob(swingId: string): Promise<Job | null> {
  const inMemory = liveClub.get(swingId);
  if (inMemory) return inMemory;

  const rows = await db.select().from(jobsTable)
    .where(and(eq(jobsTable.swingId, swingId), eq(jobsTable.type, "club_test")))
    .orderBy(desc(jobsTable.startedAt))
    .limit(1);
  return rows[0] ? await reconcileClubTest(toJob(rows[0])) : null;
}

export async function startClubTest(swingId: string, testId: TrackingTestId): Promise<Job> {
  if (!(IMPLEMENTED_TESTS as readonly string[]).includes(testId)) {
    throw new Error(`${testId} is not implemented in the analyzer yet`);
  }

  const existing = await getClubTestJob(swingId);
  if (existing && (existing.status === "running" || existing.status === "queued")) {
    return existing;
  }

  const analysis = await getAnalysis(swingId);
  if (!analysis) throw new Error("no analysis.json for this swing");
  // Already merged -> done, no spawn. Cached experiments are only recomputed by an
  // explicit re-run elsewhere, never by selecting them (plan §28).
  if (analysis.club_tracking?.experiments?.[testId]) {
    return {
      id: "cached", swingId, status: "done", stage: testId, progressPct: 100,
      message: "experiment already computed", log: [],
      startedAt: Date.now(), finishedAt: Date.now(),
    };
  }

  const job: Job = {
    id: randomUUID(),
    swingId,
    status: "running",
    stage: testId,
    progressPct: 10,
    message: "running tracker",
    log: [],
    startedAt: Date.now(),
    finishedAt: null,
  };
  liveClub.set(swingId, job);

  await db.insert(jobsTable).values({
    id: job.id, swingId, type: "club_test",
    status: job.status, stage: job.stage, progressPct: job.progressPct,
    message: job.message, log: job.log,
  });

  const args = [
    path.join("scripts", "club_test.py"),
    path.join(MEDIA_ROOT, swingId),
    "--test", testId,
  ];
  const child: ChildProcess = spawn(PYTHON, args, { cwd: ANALYZER, windowsHide: true });

  const absorb = (buf: Buffer) => {
    for (const raw of buf.toString().split(/\r?\n/)) {
      const line = raw.trimEnd();
      if (!line) continue;
      job.log.push(line);
      if (job.log.length > 200) job.log.shift();
      job.message = line.trim();
    }
  };
  child.stdout?.on("data", absorb);
  child.stderr?.on("data", absorb);

  const finish = async (status: JobStatus, message: string) => {
    job.status = status;
    job.progressPct = status === "done" ? 100 : job.progressPct;
    job.message = message;
    job.finishedAt = Date.now();
    liveClub.delete(swingId);
    await persist(job).catch(() => {});
  };

  child.on("error", (err) => {
    finish("failed", `could not start ${PYTHON}: ${err.message}`);
  });
  child.on("close", (code) => {
    if (job.status === "failed") return;
    if (code === 0) finish("done", "experiment merged");
    else finish("failed", `test runner exited ${code} — ${job.log.at(-1) ?? "see log"}`);
  });

  return job;
}
