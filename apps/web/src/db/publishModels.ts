import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { MODEL_BUCKET, modelKey } from "../lib/media/keys";
import { getMediaStore, mediaDriverName } from "../lib/media/store";

/**
 * Give a private analyzer model a URL a hosted worker can fetch.
 *
 * The club-head detector (`best.pt`) is the only asset in the pipeline with no public source,
 * which is why a container has been un-deployable since the worker was containerised: the
 * MediaPipe landmarker and the MMPose onnx files fetch themselves from public URLs, and this
 * one had nowhere to come from.
 *
 * It goes through the media store the web app already owns rather than a new bucket vendor or a
 * secret baked into the image, which keeps D26 intact — the worker holds no storage credential
 * and learns nothing about buckets or key math. It receives a plain URL in
 * `SWINGSAGE_CLUB_WEIGHTS_URL` and verifies what arrives against the hash committed in
 * `services/analyzer/service/models.py`.
 *
 *   pnpm --filter web models:publish
 *   pnpm --filter web models:publish -- --file <path> --asset clubhead_best --ttl-days 365
 *
 * Prints the two things the deploy needs: the sha256 (which belongs in the Python manifest) and
 * the URL (which belongs in the worker's environment). On the local driver there is no signed
 * URL to print — it says so rather than printing something that will not resolve.
 */

const DEFAULT_FILE = "services/analyzer/runs/clubhead/weights/best.pt";
const DEFAULT_ASSET = "clubhead_best";
const DEFAULT_TTL_DAYS = 365;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function sha256OfFile(file: string): Promise<string> {
  // Streamed: these are tens of megabytes and there is no reason to hold one in memory.
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

async function main() {
  // The repo root is two levels up from apps/web, which is where the analyzer's default path is
  // written from — a relative --file is still resolved against the caller's cwd.
  const repoRoot = path.resolve(process.cwd(), "../..");
  const fileArg = arg("file");
  const file = fileArg ? path.resolve(fileArg) : path.join(repoRoot, DEFAULT_FILE);
  const asset = arg("asset") ?? DEFAULT_ASSET;
  const ttlDays = Number(arg("ttl-days") ?? DEFAULT_TTL_DAYS);
  if (!Number.isFinite(ttlDays) || ttlDays <= 0) {
    console.error(`--ttl-days must be a positive number, got ${arg("ttl-days")}`);
    process.exit(1);
  }

  let size: number;
  try {
    size = (await stat(file)).size;
  } catch {
    console.error(`no such file: ${file}`);
    console.error("Pass --file if the weights live somewhere else.");
    process.exit(1);
    return;
  }

  const sha256 = await sha256OfFile(file);
  const extension = path.extname(file).replace(/^\./, "").toLowerCase() || "bin";
  const key = modelKey(asset, sha256, extension);
  const driver = mediaDriverName();
  const store = await getMediaStore();

  if (await store.exists(MODEL_BUCKET, key)) {
    // Content-addressed, so an identical key IS identical bytes — re-uploading would be work
    // with no possible effect.
    console.log(`already published (content-addressed): ${key}`);
  } else {
    await store.putFile(MODEL_BUCKET, key, file, "application/octet-stream");
    console.log(`published ${(size / 1e6).toFixed(1)} MB to ${MODEL_BUCKET}/${key}`);
  }

  const url = await store.signedUrl(MODEL_BUCKET, key, Math.round(ttlDays * 86400));

  console.log("");
  console.log(`asset    ${asset}`);
  console.log(`file     ${file}`);
  console.log(`size     ${size}`);
  console.log(`sha256   ${sha256}`);
  console.log("");
  if (url) {
    console.log(`Set on the worker (valid ${ttlDays} days):`);
    console.log(`  SWINGSAGE_CLUB_WEIGHTS_URL=${url}`);
  } else {
    console.log(
      `The ${driver} driver mints no URLs, so there is nothing for a remote worker to fetch.\n` +
        "This run proved the upload and the hash; re-run it with MEDIA_DRIVER=supabase to get\n" +
        "the URL the deploy needs.",
    );
  }
  console.log("");
  console.log(
    "If the size or sha256 differ from services/analyzer/service/models.py, the weights were\n" +
      "retrained — update the manifest in the same commit as the re-publish.",
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
