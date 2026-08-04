import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { MEDIA_ROOT, getAnalysis } from "@/lib/swings";

/**
 * Re-analysis jobs.
 *
 * doc 02 specifies job orchestration as shared DB rows + polling. SQLite is not built yet,
 * so the row lives in this module's memory instead — the *protocol* is the documented one
 * (POST starts, GET polls stage/progress/message), only the storage is provisional. When
 * the real job table lands, the routes keep their shape and this map is what gets replaced.
 *
 * Consequence worth knowing in dev: a Next hot-reload can re-evaluate this module and lose
 * a running job's record while the Python process keeps going. The analyzer writes its
 * output atomically enough that this is a lost *status*, not a corrupt swing — reload the
 * page once the run finishes.
 */
export type JobStatus = "queued" | "running" | "done" | "failed";

export interface Job {
  id: string;
  status: JobStatus;
  stage: string;
  progressPct: number;
  message: string;
  log: string[];
  startedAt: number;
  finishedAt: number | null;
}

const jobs = new Map<string, Job>();

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
  [/^rendered /, "render", 99],
];

export function getJob(id: string): Job | null {
  return jobs.get(id) ?? null;
}

export async function startReanalysis(id: string): Promise<Job> {
  const existing = jobs.get(id);
  if (existing && (existing.status === "running" || existing.status === "queued")) {
    return existing;
  }

  // Every input comes from the swing's own stored artifact, never from the request body —
  // this route spawns a process, so the only path it will ever pass to it is one the
  // analyzer itself wrote.
  const analysis = await getAnalysis(id);
  if (!analysis) throw new Error("no analysis.json for this swing");
  const src = analysis.video.source.path;
  if (!src) throw new Error("this analysis predates source-path recording; re-run by hand");
  try {
    await fs.access(src);
  } catch {
    throw new Error(`source clip is gone: ${src}`);
  }

  const job: Job = {
    id,
    status: "running",
    stage: "queued",
    progressPct: 0,
    message: "starting analyzer",
    log: [],
    startedAt: Date.now(),
    finishedAt: null,
  };
  jobs.set(id, job);

  const args = [
    path.join("scripts", "burnin.py"), src,
    "--out", path.join(MEDIA_ROOT, id),
    "--view", analysis.video.view,
    "--handedness", analysis.video.handedness,
  ];

  const child = spawn(PYTHON, args, { cwd: ANALYZER, windowsHide: true });

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
          break;
        }
      }
    }
  };

  child.stdout.on("data", absorb);
  child.stderr.on("data", absorb);

  child.on("error", (err) => {
    job.status = "failed";
    job.message = `could not start ${PYTHON}: ${err.message}`;
    job.finishedAt = Date.now();
  });

  child.on("close", (code) => {
    if (job.status === "failed") return;
    job.status = code === 0 ? "done" : "failed";
    job.stage = code === 0 ? "complete" : job.stage;
    job.progressPct = code === 0 ? 100 : job.progressPct;
    job.message = code === 0
      ? "analysis rewritten"
      : `analyzer exited ${code} — see log`;
    job.finishedAt = Date.now();
  });

  return job;
}
