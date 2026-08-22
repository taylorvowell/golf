import { readFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";

import { endOwnerPool, withOwner } from "./admin";
import { endAppPool, withUser } from "./session";
import { swingViews, users } from "./schema";
import { resolveView } from "./views";
import { completeCapture, createCapture } from "../lib/ingest";
import { getJob } from "../lib/jobs";
import { getMediaStore } from "../lib/media/store";
import { SOURCE_BUCKET } from "../lib/media/keys";
import { isPublished } from "../lib/media/publish";

/**
 * **The capture loop, end to end, on this machine** — session-mode step 06's load-bearing check.
 *
 * It runs exactly what the phone runs, in the same order and through the same functions: phase
 * one mints the swing and hands back a target, the bytes go to that target, phase two verifies
 * them and starts the analysis, and the job is polled until the view is ready and its artifact is
 * actually fetchable. Nothing here is a stand-in for a step the app takes.
 *
 * That matters because the phone half is the part that cannot be tested from a terminal — a
 * failure there and a failure here look identical from the app (a swing that analyses forever),
 * and this is what says which side to look at.
 *
 * Requires Postgres up and the analyzer venv present:
 *
 *     docker compose up -d
 *     pnpm --filter web db:migrate
 *     pnpm --filter web capture:e2e [path/to/clip.mp4]
 *
 * With no argument it uses the smallest fixture clip it can find. Pass = job done, view ready,
 * `analysis.json` present in the store at the published revision.
 */

const POLL_MS = 2_000;
const TIMEOUT_MS = 15 * 60 * 1000;

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

/** The account the dev loop signs in as, so the swing lands where the app will look for it. */
async function pickUser(): Promise<string> {
  const email = process.env.DEV_USER_EMAIL;
  const rows = await withOwner("capture e2e: resolve the dev user", (tx) =>
    email
      ? tx.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1)
      : tx.select({ id: users.id }).from(users).limit(1),
  );
  if (!rows[0]) fail("no users in the database — run pnpm --filter web db:seed");
  return rows[0].id;
}

async function pickClip(): Promise<string> {
  const given = process.argv[2];
  if (given) return path.resolve(given);
  // The fixtures are gitignored but present on the dev machine; the smallest is the fastest
  // honest end-to-end. No synthetic clip: a generated video would exercise the plumbing and
  // prove nothing about whether a real phone recording analyses.
  const { readdir, stat } = await import("node:fs/promises");
  const dir = path.resolve(process.cwd(), "..", "..", "fixtures");
  let names: string[];
  try {
    names = (await readdir(dir)).filter((f) => f.toLowerCase().endsWith(".mp4"));
  } catch {
    fail(`no fixtures directory at ${dir} — pass a clip path as an argument`);
  }
  if (!names.length) fail(`no .mp4 in ${dir} — pass a clip path as an argument`);
  const sized = await Promise.all(
    names.map(async (n) => ({ n, size: (await stat(path.join(dir, n))).size })),
  );
  sized.sort((a, b) => a.size - b.size);
  return path.join(dir, sized[0].n);
}

async function main(): Promise<void> {
  const userId = await pickUser();
  const clip = await pickClip();
  const bytes = new Uint8Array(await readFile(clip));
  console.log(`capture e2e: ${path.basename(clip)} (${(bytes.byteLength / 1e6).toFixed(1)} MB)`);

  // ---- phase one -------------------------------------------------------------------------
  const created = await withUser(userId, (tx) =>
    createCapture(tx, userId, {
      view: "dtl",
      handedness: "right",
      contentType: "video/mp4",
      sessionId: null,
    }));
  console.log(`  swing ${created.swingId} view ${created.viewId}`);
  console.log(`  upload target: ${created.upload.method} ${created.upload.url}`);

  // ---- the bytes -------------------------------------------------------------------------
  // Written through the STORE rather than by POSTing the route, because the route is a thin
  // wrapper over exactly this call and a terminal has no bearer token. What is being checked
  // here is that phase two finds what phase one described — not Next's request handling.
  const view = await withUser(userId, (tx) => resolveView(tx, created.swingId, "dtl"));
  if (!view) fail("the view created a moment ago cannot be resolved");
  const { rawKeyFor } = await import("../lib/ingest");
  const key = rawKeyFor(view, "video/mp4");
  const store = await getMediaStore();
  await store.put(SOURCE_BUCKET, key, bytes, "video/mp4");
  console.log(`  stored at ${key}`);

  // ---- phase two -------------------------------------------------------------------------
  const job = await withUser(userId, (tx) =>
    completeCapture(tx, userId, view, "video/mp4"));
  if (!job) fail("phase two returned no job — analysis was skipped");
  console.log(`  job ${job.id} (${job.runner})`);

  // ---- poll ------------------------------------------------------------------------------
  const startedAt = Date.now();
  let lastStage = "";
  for (;;) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    const polled = await withUser(userId, (tx) => getJob(tx, userId, view));
    if (!polled) fail("the job row vanished");
    if (polled.stage !== lastStage) {
      lastStage = polled.stage;
      console.log(`  ${polled.status} — ${polled.stage} ${polled.progressPct}% ${polled.message}`);
    }
    if (polled.status === "done") break;
    if (polled.status === "failed") fail(`analysis failed: ${polled.message}`);
    if (Date.now() - startedAt > TIMEOUT_MS) fail("timed out waiting for the analysis");
  }

  // ---- what the app will actually read ----------------------------------------------------
  const after = await withOwner("capture e2e: read the finished view", (tx) =>
    tx.select({
      status: swingViews.status,
      revision: swingViews.artifactRevision,
      score: swingViews.overallScore,
      fps: swingViews.fps,
      frames: swingViews.frameCount,
    }).from(swingViews).where(eq(swingViews.id, created.viewId)).limit(1),
  );
  const row = after[0];
  if (!row) fail("the view row vanished");
  if (row.status !== "ready") fail(`view status is ${row.status}, expected ready`);

  const published = await isPublished({
    userId,
    swingId: created.swingId,
    viewId: created.viewId,
    revision: row.revision,
  });
  if (!published) fail(`no analysis.json in the store at revision ${row.revision}`);

  console.log(
    `PASS: view ready at r${row.revision} — ${row.frames} frames @ ${row.fps}fps, score ${row.score ?? "not scored"}`,
  );
  console.log(`      swing ${created.swingId} is now in the log.`);
}

main()
  .catch((err: unknown) => fail(err instanceof Error ? (err.stack ?? err.message) : String(err)))
  .finally(async () => {
    await endAppPool().catch(() => {});
    await endOwnerPool().catch(() => {});
  });
