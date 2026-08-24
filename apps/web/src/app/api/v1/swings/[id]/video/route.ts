import {
  ARTIFACT_BUCKET,
  PLAYBACK_URL_TTL_SECONDS,
  SOURCE_BUCKET,
  artifactKey,
  sourceKey,
  type ArtifactName,
} from "@/lib/media/keys";
import { getMediaStore } from "@/lib/media/store";
import { requireViewAccess, viewParam } from "@/lib/auth";

/**
 * Serves the normalized clip.
 *
 * **Range support is not optional here**: without 206 responses the browser cannot seek, and
 * frame-accurate scrubbing — the app's headline feature — is nothing but seeking. Both paths below
 * preserve it, by different means:
 *
 *   * a driver that can mint URLs (Supabase Storage) gets a redirect, and the CDN answers the
 *     ranges directly. That is the point of the redirect: proxying every seek's byte range through
 *     Next.js would put a round trip in front of the one interaction this product is judged on.
 *   * the local driver streams the bytes here, with the same Range handling this route has always
 *     had.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const access = await requireViewAccess(id, viewParam(req));
  if ("error" in access) return access.error;

  /**
   * `?v=framestamp` serves the frame-numbered copy instead — the sync test's reference picture.
   * A fixed whitelist, not the raw parameter, because it names an artifact.
   */
  const want = new URL(req.url).searchParams.get("v");
  const store = await getMediaStore();

  let name: ArtifactName = "normalized.mp4";
  if (want === "framestamp") {
    // Falls back rather than 404s. A missing stamped clip is the normal state — it is written by
    // scripts/stampframes.py on demand — and answering "not found" blanked the player entirely,
    // which reads as the toggle having broken the video.
    const stamped = artifactKey(access.address, "framestamp.mp4");
    if (await store.exists(ARTIFACT_BUCKET, stamped)) name = "framestamp.mp4";
  }

  let bucket: string = ARTIFACT_BUCKET;
  let key = artifactKey(access.address, name);

  /**
   * `normalized.mp4` is published at the END of analysis, but a swing must play from the moment
   * its upload lands — the post-recording screen shows this swing while the analyzer is still
   * minutes from done, and a player that 404s until then reads as "saving broke the video".
   * Until the artifact exists, serve the uploaded original instead. The original is not CFR and
   * carries no artifact, so nothing frame-accurate is promised over it — and nothing is drawn on
   * it either, because there is no analysis to draw. The client re-prepares onto the normalized
   * copy when the swing turns ready (its source URI is keyed on the status).
   */
  if (name === "normalized.mp4" && !(await store.exists(ARTIFACT_BUCKET, key))) {
    for (const filename of ["original.mp4", "original.mov"]) {
      const raw = sourceKey(access.address, filename);
      if (await store.exists(SOURCE_BUCKET, raw)) {
        bucket = SOURCE_BUCKET;
        key = raw;
        break;
      }
    }
  }

  if (store.canRedirect) {
    const url = await store.signedUrl(bucket, key, PLAYBACK_URL_TTL_SECONDS);
    if (!url) return new Response("not found", { status: 404 });
    // 307 rather than 302: the method must be preserved, and a cached permanent redirect to a URL
    // that expires in six hours would be exactly the wrong thing to leave in a browser cache.
    return new Response(null, {
      status: 307,
      headers: { Location: url, "Cache-Control": "no-store" },
    });
  }

  const range = req.headers.get("range");
  const common = {
    "Content-Type": key.endsWith(".mov") ? "video/quicktime" : "video/mp4",
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
  };

  if (!range) {
    const object = await store.open(bucket, key, null);
    if (!object) return new Response("not found", { status: 404 });
    return new Response(object.body, {
      status: 200,
      headers: { ...common, "Content-Length": String(object.size) },
    });
  }

  const m = /bytes=(\d*)-(\d*)/.exec(range);
  if (!m) return new Response("bad range", { status: 416 });

  const start = m[1] ? parseInt(m[1], 10) : 0;
  if (Number.isNaN(start)) return new Response("bad range", { status: 416 });

  const object = await store.open(bucket, key, {
    start,
    end: m[2] ? parseInt(m[2], 10) : undefined,
  });
  if (!object) {
    // The store distinguishes "no such object" from "unsatisfiable range" only by whether it can
    // stat it, so ask again for the whole object to tell a 404 from a 416.
    const whole = await store.open(bucket, key, null);
    if (!whole) return new Response("not found", { status: 404 });
    await whole.body.cancel();
    return new Response("unsatisfiable", {
      status: 416,
      headers: { "Content-Range": `bytes */${whole.size}` },
    });
  }

  const { start: from, end: to } = object.range!;
  return new Response(object.body, {
    status: 206,
    headers: {
      ...common,
      "Content-Range": `bytes ${from}-${to}/${object.size}`,
      "Content-Length": String(to - from + 1),
    },
  });
}
