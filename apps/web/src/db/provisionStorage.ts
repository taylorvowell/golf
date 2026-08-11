import { createClient } from "@supabase/supabase-js";
import { ARTIFACT_BUCKET, SOURCE_BUCKET } from "../lib/media/keys";

/**
 * Create the two media buckets in whichever Supabase project the environment points at.
 *
 * Idempotent: an existing bucket is left alone rather than reconfigured, because changing a
 * bucket's public flag out from under live objects is not something a script should do quietly.
 *
 * Run with `pnpm --filter web media:provision`. Needs `SUPABASE_URL` and `SUPABASE_SECRET_KEY`;
 * the local driver needs none of this, which is the point of it being a separate command rather
 * than something the app does on boot.
 */

const BUCKETS = [
  {
    name: SOURCE_BUCKET,
    /**
     * The untrimmed upload. D29 keeps it 30 days after a successful analysis and then drops it, so
     * it is the only media in the product with an expiry — which is exactly why it is not in the
     * same bucket as the artifacts it produced.
     */
    fileSizeLimit: "2GB",
    allowedMimeTypes: ["video/mp4", "video/quicktime", "video/x-matroska", "video/webm"],
  },
  {
    name: ARTIFACT_BUCKET,
    /** Derived artifacts. They live as long as the swing does; no expiry. */
    fileSizeLimit: "1GB",
    allowedMimeTypes: ["application/json", "video/mp4", "image/jpeg"],
  },
];

async function main() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    console.error("SUPABASE_URL and SUPABASE_SECRET_KEY are required to provision buckets.");
    process.exit(1);
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: existing, error: listError } = await supabase.storage.listBuckets();
  if (listError) {
    console.error(`could not list buckets: ${listError.message}`);
    process.exit(1);
  }
  const have = new Set((existing ?? []).map((b) => b.name));

  for (const bucket of BUCKETS) {
    if (have.has(bucket.name)) {
      console.log(`${bucket.name}: already exists, left as-is`);
      continue;
    }
    // The requested per-file limit may exceed the PROJECT's global cap, which is a plan setting
    // rather than a bucket one — the Free plan's is far below a phone video. Ask for what the
    // product needs, then fall back to the project default and say so, because a bucket that
    // silently caps uploads lower than a real swing video is a failure that would only surface
    // when a golfer tried to upload one.
    let cappedByPlan = false;
    let { error } = await supabase.storage.createBucket(bucket.name, {
      // PRIVATE, always. Every read goes through a signed URL minted after `requireViewAccess`
      // has resolved ownership. A public bucket would make every swing video world-readable to
      // anyone who could guess a uuid, and §34.4 is explicit that nothing becomes public unless
      // the golfer intentionally chose it.
      public: false,
      fileSizeLimit: bucket.fileSizeLimit,
      allowedMimeTypes: bucket.allowedMimeTypes,
    });
    if (error && /maximum allowed size|exceeded/i.test(error.message)) {
      cappedByPlan = true;
      ({ error } = await supabase.storage.createBucket(bucket.name, {
        public: false,
        allowedMimeTypes: bucket.allowedMimeTypes,
      }));
    }
    if (error) {
      console.error(`${bucket.name}: ${error.message}`);
      process.exit(1);
    }
    console.log(
      cappedByPlan
        ? `${bucket.name}: created (private, per-file limit CAPPED BY PLAN below the requested ${bucket.fileSizeLimit})`
        : `${bucket.name}: created (private, ${bucket.fileSizeLimit})`,
    );
  }

  console.log("\nBuckets ready. Set MEDIA_DRIVER=supabase to use them; see infra/storage/README.md");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
