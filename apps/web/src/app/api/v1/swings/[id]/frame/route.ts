import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ARTIFACT_BUCKET, artifactKey, stillKey } from "@/lib/media/keys";
import { getJson, getMediaStore } from "@/lib/media/store";
import { requireViewAccess, viewParam } from "@/lib/auth";

/**
 * One exact frame of the normalized clip, as a JPEG.
 *
 * `?f=<frame>` names the frame directly; `?checkpoint=<P-code>` resolves it through the
 * artifact's own `checkpoints` table — the same source `checkpointFrames.ts` uses on the phone,
 * and for the same reason: P6 and P9 exist only there, and a client that guessed a frame would
 * put a golfer on a moment the scorecard never meant. The mobile home screen's "you vs pro"
 * strip is the first consumer: two swings frozen at the same coaching position.
 *
 * The still is extracted once with ffmpeg (`-ss frame/fps` on the CFR clip — normalization is
 * what makes that address exact) and **cached as an artifact** under the revision prefix, so a
 * re-analysis mints new keys and the deletion cascade sweeps stills with everything else. When
 * the analyzer pre-renders checkpoint stills at publish time they land on the same keys and this
 * route stops shelling out entirely. Extraction failing — no ffmpeg on the host, a truncated
 * clip — is a 404, not a 500: to a client it is the same permanent "no such image" as a swing
 * analysed before this route existed, and the strip simply does not render.
 */

interface AnalysisSlice {
  video?: { fps?: number };
  checkpoints?: Array<{ p?: string; frame?: number }>;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const access = await requireViewAccess(id, viewParam(req));
  if ("error" in access) return access.error;

  const url = new URL(req.url);
  const store = await getMediaStore();

  const analysis = await getJson<AnalysisSlice>(
    store,
    ARTIFACT_BUCKET,
    artifactKey(access.address, "analysis.json"),
  );
  const fps =
    analysis?.video?.fps && Number.isFinite(analysis.video.fps) && analysis.video.fps > 0
      ? analysis.video.fps
      : 60;

  const checkpoint = url.searchParams.get("checkpoint");
  const fParam = url.searchParams.get("f");
  let frame: number;
  if (checkpoint) {
    const found = analysis?.checkpoints?.find((c) => c.p === checkpoint);
    if (!found || typeof found.frame !== "number" || !Number.isFinite(found.frame)) {
      return new Response("checkpoint not in artifact", { status: 404 });
    }
    frame = Math.round(found.frame);
  } else if (fParam !== null) {
    const n = Number(fParam);
    if (!Number.isInteger(n) || n < 0) return new Response("bad frame", { status: 400 });
    frame = n;
  } else {
    return new Response("f or checkpoint required", { status: 400 });
  }

  const key = stillKey(access.address, frame);
  let body: Uint8Array<ArrayBuffer>;
  const cached = await store.getBytes(ARTIFACT_BUCKET, key);
  if (cached) {
    body = new Uint8Array(cached);
  } else {
    const video = await store.getBytes(
      ARTIFACT_BUCKET,
      artifactKey(access.address, "normalized.mp4"),
    );
    if (!video) return new Response("not found", { status: 404 });

    const dir = await mkdtemp(join(tmpdir(), "swingsage-still-"));
    try {
      const src = join(dir, "in.mp4");
      const out = join(dir, "out.jpg");
      await writeFile(src, video);
      await new Promise<void>((resolve, reject) => {
        // -ss before -i: input seeking, keyframe-then-decode-forward, exact on a CFR clip.
        // Frame N's timestamp is N/fps by construction — no ±half-frame nudge (that is a player
        // convention, D40; ffmpeg lands on the first frame at or after the target).
        const p = spawn("ffmpeg", [
          "-v", "error",
          "-ss", String(frame / fps),
          "-i", src,
          "-frames:v", "1",
          "-q:v", "3",
          "-y", out,
        ]);
        p.on("error", reject);
        p.on("close", (code) =>
          code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)),
        );
      });
      body = new Uint8Array(await readFile(out));
      // Idempotent by key — two racing extractions write the same bytes.
      await store.put(ARTIFACT_BUCKET, key, body, "image/jpeg");
    } catch {
      return new Response("still unavailable", { status: 404 });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(body.byteLength),
      // Revision-addressed and immutable; private because it is a picture of a person.
      "Cache-Control": "private, max-age=86400",
    },
  });
}
