import { eq } from "drizzle-orm";
import { endOwnerPool, withOwner } from "./admin";
import { withUser } from "./session";
import { jobs as jobsTable, swings, swingViews } from "./schema";
import { mediaAddress, type ResolvedView } from "./views";
import { getAnalysis } from "../lib/swings";
import { SOURCE_BUCKET, sourceKey } from "../lib/media/keys";
import { getMediaStore } from "../lib/media/store";
import { isPublished } from "../lib/media/publish";
import { enqueueReanalysis } from "../lib/jobs/dispatch";

/**
 * The queue loop, end to end, against the REAL local stack — analyzer-service step 04's
 * load-bearing verification. Requires three processes up:
 *
 *   npx @upstash/qstash-cli dev            (QStash local dev server, :8080)
 *   python -m service.server               (the worker, from services/analyzer, venv)
 *   pnpm dev                               (this app — serves /api/internal/*)
 *
 * and the queue env block in apps/web/.env. Then:  pnpm --filter web queue:e2e
 *
 * What it does: picks the smallest ready swing, makes sure its original clip exists in the
 * source bucket (uploading it from the analyzer's recorded source path if not — a one-time
 * provisioning that swing-ingest will eventually own), enqueues through the real dispatcher,
 * and polls the job row until terminal. Pass = job done + view ready + artifactRevision
 * bumped + analysis.json present in the store at the new revision.
 */

const POLL_MS = 2000;
const TIMEOUT_MS = 12 * 60 * 1000;

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

async function pickView(): Promise<ResolvedView & { rawMediaKey: string | null }> {
  const rows = await withOwner("queue e2e: pick a ready fixture swing", (tx) =>
    tx.select({
      swingId: swings.id,
      userId: swings.userId,
      viewId: swingViews.id,
      view: swingViews.view,
      mediaKey: swingViews.mediaKey,
      revision: swingViews.artifactRevision,
      rawMediaKey: swingViews.rawMediaKey,
      frameCount: swingViews.frameCount,
    })
      .from(swingViews)
      .innerJoin(swings, eq(swings.id, swingViews.swingId))
      .where(eq(swingViews.status, "ready"))
      .orderBy(swingViews.frameCount)
      .limit(1),
  );
  if (!rows[0]) fail("no ready swing to re-analyse — run pnpm db:backfill first");
  const { swingId, userId, viewId, view, mediaKey, revision, rawMediaKey } = rows[0];
  return { swingId, userId, viewId, view, mediaKey, revision, rawMediaKey };
}

/** One-time source provisioning: local source path -> the source bucket + rawMediaKey. */
async function ensureStoredSource(view: ResolvedView & { rawMediaKey: string | null }): Promise<void> {
  const store = await getMediaStore();
  if (view.rawMediaKey && (await store.exists(SOURCE_BUCKET, view.rawMediaKey))) return;

  const analysis = await getAnalysis(mediaAddress(view));
  if (!analysis) fail("picked view has no analysis.json in the store");
  const src = analysis.video.source.path;
  if (!src) fail("analysis predates source-path recording; pick another swing");

  const filename = src.replace(/\\/g, "/").split("/").pop() ?? "source.mp4";
  const key = sourceKey(mediaAddress(view), filename);
  console.log(`provisioning source into store: ${key}`);
  await store.putFile(SOURCE_BUCKET, key, src, "video/mp4");
  await withUser(view.userId, (tx) =>
    tx.update(swingViews).set({ rawMediaKey: key }).where(eq(swingViews.id, view.viewId)));
  view.rawMediaKey = key;
}

async function main() {
  const view = await pickView();
  console.log(`view ${view.viewId} (${view.mediaKey}), revision ${view.revision}`);

  await ensureStoredSource(view);

  const job = await withUser(view.userId, (tx) => enqueueReanalysis(tx, view.userId, view));
  console.log(`enqueued job ${job.id} -> target revision ${view.revision + 1}`);

  const started = Date.now();
  let lastLine = "";
  for (;;) {
    if (Date.now() - started > TIMEOUT_MS) fail("timed out waiting for the job");
    await new Promise((r) => setTimeout(r, POLL_MS));
    const rows = await withUser(view.userId, (tx) =>
      tx.select().from(jobsTable).where(eq(jobsTable.id, job.id)).limit(1));
    const row = rows[0];
    if (!row) fail("job row disappeared");
    const line = `${row.status}  ${row.stage} ${row.progressPct}%  ${row.message}`;
    if (line !== lastLine) {
      console.log(`  ${line}`);
      lastLine = line;
    }
    if (row.status === "failed") fail(`job failed: ${row.message}`);
    if (row.status === "done") break;
  }

  const after = await withUser(view.userId, (tx) =>
    tx.select({
      status: swingViews.status,
      revision: swingViews.artifactRevision,
      fps: swingViews.fps,
    }).from(swingViews).where(eq(swingViews.id, view.viewId)).limit(1));
  const v = after[0];
  if (!v) fail("view row disappeared");
  if (v.status !== "ready") fail(`view status is ${v.status}, expected ready`);
  if (v.revision !== view.revision + 1) {
    fail(`artifactRevision is ${v.revision}, expected ${view.revision + 1}`);
  }
  if (!(await isPublished({ ...mediaAddress(view), revision: v.revision }))) {
    fail(`analysis.json missing from the store at revision ${v.revision}`);
  }

  console.log(`PASS: job done, view ready at revision ${v.revision} (fps ${v.fps})`);
}

main()
  .catch((err) => fail(err instanceof Error ? (err.stack ?? err.message) : String(err)))
  .finally(() => endOwnerPool());
