import fs from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { swingFile } from "@/lib/swings";

/**
 * Streams the normalized clip with HTTP Range support.
 *
 * Range is not optional here: without 206 responses the browser cannot seek, and
 * frame-accurate scrubbing — the app's headline feature — is nothing but seeking.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  /**
   * `?v=framestamp` serves the frame-numbered copy instead — the sync test's reference picture.
   * A fixed whitelist, not the raw parameter: this resolves to a path on disk.
   */
  const want = new URL(req.url).searchParams.get("v");

  let file: string;
  try {
    file = swingFile(id, "normalized.mp4");
    // Falls back rather than 404s. A missing stamped clip is the normal state — it is written
    // by scripts/stampframes.py on demand — and answering "not found" blanked the player
    // entirely, which reads as the toggle having broken the video.
    if (want === "framestamp") {
      const stamped = swingFile(id, "framestamp.mp4");
      if (fs.existsSync(stamped)) file = stamped;
    }
  } catch {
    return new Response("bad id", { status: 400 });
  }

  let size: number;
  try {
    size = (await stat(file)).size;
  } catch {
    return new Response("not found", { status: 404 });
  }

  const range = req.headers.get("range");
  const common = {
    "Content-Type": "video/mp4",
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
  };

  if (!range) {
    const stream = Readable.toWeb(fs.createReadStream(file)) as ReadableStream;
    return new Response(stream, {
      status: 200,
      headers: { ...common, "Content-Length": String(size) },
    });
  }

  const m = /bytes=(\d*)-(\d*)/.exec(range);
  if (!m) return new Response("bad range", { status: 416 });

  const start = m[1] ? parseInt(m[1], 10) : 0;
  const end = Math.min(m[2] ? parseInt(m[2], 10) : size - 1, size - 1);
  if (Number.isNaN(start) || start > end) {
    return new Response("unsatisfiable", {
      status: 416,
      headers: { "Content-Range": `bytes */${size}` },
    });
  }

  const stream = Readable.toWeb(
    fs.createReadStream(file, { start, end }),
  ) as ReadableStream;

  return new Response(stream, {
    status: 206,
    headers: {
      ...common,
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Content-Length": String(end - start + 1),
    },
  });
}
