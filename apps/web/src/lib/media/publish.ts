import { access } from "node:fs/promises";
import path from "node:path";
import {
  ARTIFACT_BUCKET,
  ARTIFACT_NAMES,
  artifactKey,
  contentTypeFor,
  type ArtifactName,
  type ViewAddress,
} from "./keys";
import { getMediaStore } from "./store";

/**
 * Publishing: the analyzer's working directory → the store.
 *
 * This is the whole of step 09's "change where artifacts land, not what the analyzer produces".
 * `burnin.py` keeps writing `out/<stem>/` exactly as it always has — the pipeline is untouched and
 * the CLI workflow that the analyzer's development depends on keeps working with no cloud
 * anything. Publishing is a separate, re-runnable act afterwards.
 *
 * Keeping it separate is also what makes the `analyzer-service` track possible without a redesign:
 * a hosted worker publishes from its own scratch directory using this same function, and nothing
 * else in the system needs to know the difference.
 */

/** The analyzer's default output root. Only the publish path knows this exists. */
export const ANALYZER_OUT_ROOT =
  process.env.SWINGSAGE_MEDIA_ROOT ??
  path.resolve(process.cwd(), "..", "..", "services", "analyzer", "out");

export interface PublishResult {
  published: ArtifactName[];
  /** Artifacts the run did not produce — `--no-silhouette`, no club detector, and so on. */
  absent: ArtifactName[];
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Copy one analysis run's artifacts into the store under `address`.
 *
 * Absent artifacts are reported, never fabricated and never fatal. A swing analysed with
 * `--no-silhouette` genuinely has no `silhouette.json`, and the player already treats a missing
 * one as "the overlay is not offered" rather than as an error — that contract holds here.
 */
export async function publishFromWorkingDir(
  address: ViewAddress,
  workingDir: string,
): Promise<PublishResult> {
  const store = await getMediaStore();
  const published: ArtifactName[] = [];
  const absent: ArtifactName[] = [];

  for (const name of ARTIFACT_NAMES) {
    const src = path.join(workingDir, name);
    if (!(await fileExists(src))) {
      absent.push(name);
      continue;
    }
    await store.putFile(ARTIFACT_BUCKET, artifactKey(address, name), src, contentTypeFor(name));
    published.push(name);
  }

  return { published, absent };
}

/** The analyzer working directory for a view, by the stem stored on its row. */
export function workingDirFor(mediaKey: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(mediaKey)) throw new Error("invalid analyzer stem");
  return path.join(ANALYZER_OUT_ROOT, mediaKey);
}

/**
 * Whether this view's artifacts are already in the store at the given revision.
 *
 * `analysis.json` stands in for the set: it is the one artifact every successful run produces, so
 * its absence means the revision was never published rather than that one optional overlay is
 * missing.
 */
export async function isPublished(address: ViewAddress): Promise<boolean> {
  const store = await getMediaStore();
  return store.exists(ARTIFACT_BUCKET, artifactKey(address, "analysis.json"));
}
