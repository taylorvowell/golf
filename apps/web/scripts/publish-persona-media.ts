/**
 * Publish the persona swings' artifacts into the media store.
 *
 * Reads `persona-manifest.json` (minted by `gen-persona-seed.mjs` — the same ids the DB rows
 * carry) and copies each source fixture's analysis run (`services/analyzer/out/<src>/`) to the
 * persona view's own derived address. Media addresses lead with the OWNER's user id, so a
 * seeded swing without this step is a log full of cards with no thumbnail, no video and no
 * error anywhere — the claim-fixtures lesson.
 *
 * Idempotent: a view whose `analysis.json` is already in the store at r1 is skipped.
 *
 * Run against the PRODUCTION store (the phone talks to the deployed API):
 *   MEDIA_DRIVER=r2 R2_ACCOUNT_ID=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… \
 *     node --env-file=.env --import tsx scripts/publish-persona-media.ts
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { isPublished, publishFromWorkingDir, workingDirFor } from "../src/lib/media/publish";
import type { ViewAddress } from "../src/lib/media/keys";

const HERE = dirname(fileURLToPath(new URL(import.meta.url)));
const manifest = JSON.parse(readFileSync(join(HERE, "persona-manifest.json"), "utf8")) as {
  users: Record<string, { id: string }>;
  personas: Record<
    string,
    {
      sessions: Array<{ swings: Array<{ swingId: string; viewId: string; src: string }> }>;
      reference: { swingId: string; viewId: string; src: string };
    }
  >;
};

async function main() {
  if (process.env.MEDIA_DRIVER !== "r2") {
    throw new Error("Refusing to run without MEDIA_DRIVER=r2 — the personas live in production.");
  }

  const jobs: Array<{ address: ViewAddress; src: string; label: string }> = [];
  for (const [persona, data] of Object.entries(manifest.personas)) {
    const userId = manifest.users[persona].id;
    const all = [...data.sessions.flatMap((s) => s.swings), data.reference];
    for (const swing of all) {
      jobs.push({
        address: { userId, swingId: swing.swingId, viewId: swing.viewId, revision: 1 },
        src: swing.src,
        label: `${persona}/${swing.src}`,
      });
    }
  }

  let done = 0;
  for (const job of jobs) {
    if (await isPublished(job.address)) {
      console.log(`SKIP ${job.label} (already published)`);
      done += 1;
      continue;
    }
    const result = await publishFromWorkingDir(job.address, workingDirFor(job.src));
    done += 1;
    console.log(
      `OK   ${job.label} — ${result.published.length} artifacts` +
        (result.absent.length ? ` (absent: ${result.absent.join(", ")})` : "") +
        `  [${done}/${jobs.length}]`,
    );
  }
  console.log(`DONE ${done}/${jobs.length}`);
}

main().catch((err) => {
  console.error("FAILED", err);
  process.exit(1);
});
