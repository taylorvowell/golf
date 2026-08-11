import fs from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "./client";
import { swings, swingViews } from "./schema";
import { ensureAdminUser } from "./seed";
import { syncSwingScore } from "./scores";
import { viewByMediaKey } from "./views";
import { MEDIA_ROOT } from "../lib/swings";
import { proSwingByKey } from "../lib/proSwings";
import type { Analysis } from "../lib/swings";

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
 */
async function main() {
  const admin = await ensureAdminUser();

  let entries: string[];
  try {
    entries = await fs.readdir(MEDIA_ROOT);
  } catch {
    console.log(`no ${MEDIA_ROOT} — nothing to backfill`);
    process.exit(0);
  }

  let inserted = 0, skipped = 0, scored = 0;
  for (const mediaKey of entries) {
    const analysisPath = path.join(MEDIA_ROOT, mediaKey, "analysis.json");
    let analysis: Analysis;
    try {
      analysis = JSON.parse(await fs.readFile(analysisPath, "utf8"));
    } catch {
      skipped++;
      continue; // mid-analysis or failed folder, no readable analysis.json
    }

    let view = await viewByMediaKey(mediaKey);
    if (!view) {
      // The bundled model swings are marked by the CATALOGUE, keyed on the folder name — the one
      // place a storage key legitimately decides something, because it is how a human names the
      // clip they dropped in `fixtures/`. Everything downstream reads the column, not the key.
      const reference = proSwingByKey(mediaKey);
      const [swing] = await db.insert(swings).values({
        userId: admin.id,
        handedness: analysis.video.handedness,
        referenceLabel: reference?.label ?? null,
      }).returning({ id: swings.id });

      const [row] = await db.insert(swingViews).values({
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

      view = {
        swingId: swing.id, userId: admin.id,
        viewId: row.id, view: analysis.video.view, mediaKey,
      };
      inserted++;
      console.log(`backfilled ${mediaKey} -> swing ${swing.id}`);
    } else {
      skipped++;
      // The artifact is the record: a re-analysis can change fps or frame count, and a row that
      // disagrees with the clip it points at is what makes an overlay land on the wrong frame.
      await db.update(swingViews).set({
        view: analysis.video.view,
        fps: analysis.video.fps,
        frameCount: analysis.video.frame_count,
        width: analysis.video.width,
        height: analysis.video.height,
      }).where(eq(swingViews.id, view.viewId));
    }

    if (await syncSwingScore(view)) {
      scored++;
      console.log(`synced score for ${mediaKey}`);
    }
  }

  console.log(`done: ${inserted} inserted, ${skipped} already present, ${scored} scores synced`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
