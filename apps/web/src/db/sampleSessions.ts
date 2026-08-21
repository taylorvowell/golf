import { eq } from "drizzle-orm";
import { endOwnerPool, withOwner } from "./admin";
import { swings, swingViews } from "./schema";
import { syncSwingScore } from "./scores";
import { mediaAddress, viewByMediaKey, type ResolvedView } from "./views";
import { publishFromWorkingDir, workingDirFor } from "../lib/media/publish";

/**
 * Seed SAMPLE practice sessions into the swing log — dev formatting data, nothing more.
 *
 * `pnpm --filter web db:sample-sessions`
 *
 * The mobile log groups swings into sessions by `created_at` gaps (2h — `sessionize()` on the
 * phone; real session rows are session-mode step 05), so "a past session with N swings" is N
 * swing rows stamped minutes apart on a past day. Each sample DUPLICATES an existing fixture
 * swing: new swing + view rows under a new `media_key` (the column is unique), with the
 * artifacts published from the SOURCE fixture's working directory — media is addressed by
 * identity (D33), not by the key, so the copies play and analyse like the originals.
 *
 * Idempotent: a sample whose `media_key` already exists is skipped, so re-running never
 * duplicates a session. Remove the samples with:
 *   delete from swings where id in (select swing_id from swing_views where media_key like '%-smp%');
 */

interface SampleSession {
  /** Days back from now — the whole session lands on this day. */
  daysAgo: number;
  /** Extra hour shift so the sessions don't all sit at the same time of day. */
  hourShift: number;
  /** Source fixture media keys to duplicate, in tee order. */
  sources: string[];
}

// "Random" = arbitrary but stated, so a re-run stays idempotent and the data is explainable.
const SESSIONS: SampleSession[] = [
  { daysAgo: 2, hourShift: 5, sources: ["pro_3"] },
  { daysAgo: 5, hourShift: 3, sources: ["6iron2", "swing2", "7wood-1"] },
  {
    daysAgo: 12,
    hourShift: 8,
    sources: ["6iron-1", "6iron3", "7wood-2", "perfect", "pro_2", "swing1"],
  },
];

/** Minutes between swings within a session — varied a little so the log doesn't look metronomic. */
const GAP_MINUTES = [0, 4, 9, 13, 20, 26];

async function main() {
  let created = 0, skipped = 0;

  for (const [si, session] of SESSIONS.entries()) {
    const base =
      Date.now() - session.daysAgo * 86_400_000 - session.hourShift * 3_600_000;

    for (const [i, src] of session.sources.entries()) {
      const sampleKey = `${src}-smp${si + 1}`;
      const exists = await withOwner("sample sessions: idempotency check", (tx) =>
        viewByMediaKey(tx, sampleKey));
      if (exists) { skipped++; continue; }

      const srcView = await withOwner("sample sessions: locate the source view", (tx) =>
        viewByMediaKey(tx, src));
      if (!srcView) {
        console.warn(`source ${src} has no view row — run db:backfill first; skipping`);
        skipped++;
        continue;
      }

      const view = await withOwner("sample sessions: duplicate a fixture swing", async (tx) => {
        const [srcSwing] = await tx.select({ handedness: swings.handedness })
          .from(swings).where(eq(swings.id, srcView.swingId));
        const [srcViewRow] = await tx.select({
          view: swingViews.view,
          fps: swingViews.fps,
          frameCount: swingViews.frameCount,
          width: swingViews.width,
          height: swingViews.height,
        }).from(swingViews).where(eq(swingViews.id, srcView.viewId));

        const createdAt = new Date(base + GAP_MINUTES[i]! * 60_000);
        const [swing] = await tx.insert(swings).values({
          userId: srcView.userId,
          handedness: srcSwing!.handedness,
          createdAt,
        }).returning({ id: swings.id });

        const [row] = await tx.insert(swingViews).values({
          swingId: swing!.id,
          view: srcViewRow!.view,
          mediaKey: sampleKey,
          fps: srcViewRow!.fps,
          frameCount: srcViewRow!.frameCount,
          width: srcViewRow!.width,
          height: srcViewRow!.height,
          status: "ready",
          isPrimary: true,
          analyzedAt: createdAt,
        }).returning({ id: swingViews.id });

        const resolved: ResolvedView = {
          swingId: swing!.id, userId: srcView.userId,
          viewId: row!.id, view: srcViewRow!.view, mediaKey: sampleKey,
          revision: 1,
        };
        return resolved;
      });

      // Publish the SOURCE fixture's artifacts to the sample view's own address, then score it
      // off that published copy — the same order backfill uses.
      await publishFromWorkingDir(mediaAddress(view), workingDirFor(src));
      await withOwner("sample sessions: sync the scorecard", (tx) => syncSwingScore(tx, view));

      created++;
      console.log(`sample ${sampleKey} -> swing ${view.swingId} (${session.daysAgo}d ago)`);
    }
  }

  console.log(`done: ${created} sample swings created, ${skipped} skipped`);
  await endOwnerPool();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
