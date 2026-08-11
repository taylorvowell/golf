import fs from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { endOwnerPool, withOwner } from "./admin";
import { swings, swingViews } from "./schema";
import { ensureAdminUser } from "./seed";
import { syncSwingScore } from "./scores";
import { mediaAddress, viewByMediaKey } from "./views";
import { ANALYZER_OUT_ROOT, publishFromWorkingDir, workingDirFor } from "../lib/media/publish";
import { proSwingByKey } from "../lib/proSwings";
import type { Analysis } from "@swingsage/schema/contract";

/**
 * Backfill + score-sync for whatever's on disk under `out/`.
 *
 * `burnin.py` writes `out/<key>/analysis.json` directly and has no idea this database exists
 * (CLAUDE.md: a CLI run does not touch Postgres), so this is the only bridge in that direction:
 * it inserts a swing + one view per folder that doesn't have one yet, owned by the seeded admin
 * user, and re-syncs `coach_report.json` into `scores` for every folder found — including ones
 * that already have rows, because re-running Stage 8 only ever updates the on-disk artifact.
 *
 * Since migration 0006 a folder maps to a **view**, not to a swing: the folder name is the view's
 * `mediaKey`, and the swing that owns it gets a database-minted uuid. One folder still produces
 * one swing here — a backfill has no way to know that two folders are two cameras on the same
 * shot, and guessing (by timestamp, say) would silently merge two swings that only look alike.
 * Dual-view swings are created by the capture and upload paths, which know.
 *
 * Safe to re-run: insert is skip-if-the-view-exists, score sync is upsert-on-view-id.
 *
 * Since step 09 it also **publishes** each folder into the media store, which is what makes a
 * CLI-analysed fixture visible to the app at all — the routes no longer read `out/` directly.
 * Publishing here writes the view's CURRENT revision rather than minting a new one: unlike the
 * re-analyze route, a backfill is a developer bridge run from a terminal, so there is no session
 * mid-scrub to protect and bumping the revision on every run would leave a trail of dead copies.
 */
/**
 * Owner-privileged by nature, and that is why it is a script rather than a route.
 *
 * A backfill mints swings on behalf of a user it is not authenticated as, writing rows no policy
 * would admit — the same shape of work the analyzer worker will need (step 03 item 4b). It runs
 * under `withOwner` from a terminal; `src/db/admin.ts` throws if it is ever loaded inside Next,
 * so this cannot drift onto a request path (D42).
 */
async function main() {
  let entries: string[];
  try {
    entries = await fs.readdir(ANALYZER_OUT_ROOT);
  } catch {
    console.log(`no ${ANALYZER_OUT_ROOT} — nothing to backfill`);
    process.exit(0);
  }

  let inserted = 0, skipped = 0, scored = 0, published = 0;
  const admin = await withOwner("local backfill of CLI-analysed folders", ensureAdminUser);

  for (const mediaKey of entries) {
    const analysisPath = path.join(ANALYZER_OUT_ROOT, mediaKey, "analysis.json");
    let analysis: Analysis;
    try {
      analysis = JSON.parse(await fs.readFile(analysisPath, "utf8"));
    } catch {
      skipped++;
      continue; // mid-analysis or failed folder, no readable analysis.json
    }

    let view = await withOwner("backfill: locate the view for a working directory",
      (tx) => viewByMediaKey(tx, mediaKey));
    if (!view) {
      // The bundled model swings are marked by the CATALOGUE, keyed on the folder name — the one
      // place a storage key legitimately decides something, because it is how a human names the
      // clip they dropped in `fixtures/`. Everything downstream reads the column, not the key.
      const reference = proSwingByKey(mediaKey);
      const { swing, row } = await withOwner("backfill: create a swing for a working directory",
        async (tx) => {
          const [swing] = await tx.insert(swings).values({
            userId: admin.id,
            handedness: analysis.video.handedness,
            referenceLabel: reference?.label ?? null,
          }).returning({ id: swings.id });

          const [row] = await tx.insert(swingViews).values({
            swingId: swing.id,
            view: analysis.video.view,
            mediaKey,
            fps: analysis.video.fps,
            frameCount: analysis.video.frame_count,
            width: analysis.video.width,
            height: analysis.video.height,
            status: "ready",
            isPrimary: true,
            analyzedAt: new Date(),
          }).returning({ id: swingViews.id });

          return { swing, row };
        });

      view = {
        swingId: swing.id, userId: admin.id,
        viewId: row.id, view: analysis.video.view, mediaKey,
        revision: 1,
      };
      inserted++;
      console.log(`backfilled ${mediaKey} -> swing ${swing.id}`);
    } else {
      skipped++;
      // The artifact is the record: a re-analysis can change fps or frame count, and a row that
      // disagrees with the clip it points at is what makes an overlay land on the wrong frame.
      await withOwner("backfill: re-sync a view row with its artifact", (tx) =>
        tx.update(swingViews).set({
          view: analysis.video.view,
          fps: analysis.video.fps,
          frameCount: analysis.video.frame_count,
          width: analysis.video.width,
          height: analysis.video.height,
        }).where(eq(swingViews.id, view!.viewId)));
    }

    const result = await publishFromWorkingDir(mediaAddress(view), workingDirFor(mediaKey));
    published += result.published.length;

    if (await withOwner("backfill: sync a scorecard from disk", (tx) => syncSwingScore(tx, view!))) {
      scored++;
      console.log(`synced score for ${mediaKey}`);
    }
  }

  console.log(
    `done: ${inserted} inserted, ${skipped} already present, ${scored} scores synced, ` +
    `${published} artifacts published`,
  );
  await endOwnerPool();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
