import fs from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "./client";
import { swings } from "./schema";
import { ensureAdminUser } from "./seed";
import { syncSwingScore } from "./scores";
import { MEDIA_ROOT } from "../lib/swings";
import type { Analysis } from "../lib/swings";

/**
 * Backfill + score-sync for whatever's on disk under `out/`: the two fixture swings existed
 * there from before the DB layer existed (`burnin.py` writes `out/<id>/analysis.json` directly,
 * and until now `listSwings()` just scanned that directory), so this inserts a `swings` row per
 * folder that doesn't have one yet, owned by the seeded admin user. It ALSO re-syncs
 * `coach_report.json` into the `scores` table for every folder found — including ones that
 * already have a `swings` row — because burnin.py has no idea the DB exists and never writes to
 * it; re-running Stage 8 (or the whole pipeline) only ever updates the on-disk artifact. Safe
 * to re-run: insert is skip-if-exists, score sync is upsert-on-swing-id.
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
  for (const id of entries) {
    const analysisPath = path.join(MEDIA_ROOT, id, "analysis.json");
    let analysis: Analysis;
    try {
      analysis = JSON.parse(await fs.readFile(analysisPath, "utf8"));
    } catch {
      skipped++;
      continue; // mid-analysis or failed folder, no readable analysis.json
    }

    const existing = await db.select({ id: swings.id }).from(swings).where(eq(swings.id, id));
    if (!existing.length) {
      await db.insert(swings).values({
        id,
        userId: admin.id,
        view: analysis.video.view,
        handedness: analysis.video.handedness,
        mediaPath: path.join(MEDIA_ROOT, id),
        fps: analysis.video.fps,
        frameCount: analysis.video.frame_count,
        width: analysis.video.width,
        height: analysis.video.height,
        status: "ready",
        analyzedAt: new Date(),
      });
      inserted++;
      console.log(`backfilled ${id}`);
    } else {
      skipped++;
    }

    if (await syncSwingScore(id)) {
      scored++;
      console.log(`synced score for ${id}`);
    }
  }

  console.log(`done: ${inserted} inserted, ${skipped} already present, ${scored} scores synced`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
