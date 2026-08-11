#!/usr/bin/env node
/**
 * Serve real artifacts to the phone over the LAN, with HTTP Range support.
 *
 *     node scripts/serve-fixtures.mjs            # from apps/mobile, listens on :8790
 *
 * Every probe so far has measured a video bundled INTO the app. The product streams from object
 * storage over a network, which is a different problem: range requests, buffering, and a decoder
 * that can stall on the wire rather than on the CPU. This exists so probes 4 and 5 measure that
 * path instead of the easy one.
 *
 * Deliberately not the Supabase signed URL: that needs a credential the phone does not have and a
 * URL that expires in six hours, neither of which belongs in a spike. The Supabase CDN's range
 * behaviour was already verified separately (206, `bytes 1000-2999/5496355`, D33); what is
 * unverified is whether media3 seeks frame-exactly over HTTP at all, and any range-capable origin
 * answers that.
 *
 * No dependency on purpose — this whole harness is scheduled for deletion.
 */
import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const PORT = 8790;
const ROOTS = {
  "/out": resolve(process.cwd(), "..", "..", "services", "analyzer", "out"),
  "/assets": resolve(process.cwd(), "assets"),
};

const TYPES = { ".mp4": "video/mp4", ".json": "application/json", ".jpg": "image/jpeg" };

createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const mount = Object.keys(ROOTS).find((m) => url.pathname.startsWith(m + "/"));
  if (!mount) {
    res.writeHead(404).end("mount not found");
    return;
  }
  // normalize() collapses any ../ before it is joined, so a crafted path cannot escape the root.
  const rel = normalize(decodeURIComponent(url.pathname.slice(mount.length))).replace(/^[\\/]+/, "");
  const file = join(ROOTS[mount], rel);
  if (!file.startsWith(ROOTS[mount])) {
    res.writeHead(403).end("outside root");
    return;
  }

  let size;
  try {
    size = statSync(file).size;
  } catch {
    res.writeHead(404).end("not found");
    return;
  }

  const type = TYPES[extname(file)] ?? "application/octet-stream";
  const range = req.headers.range;
  if (!range) {
    res.writeHead(200, { "Content-Type": type, "Content-Length": size, "Accept-Ranges": "bytes" });
    createReadStream(file).pipe(res);
    return;
  }

  const m = /bytes=(\d*)-(\d*)/.exec(range);
  const start = m?.[1] ? parseInt(m[1], 10) : 0;
  const end = Math.min(m?.[2] ? parseInt(m[2], 10) : size - 1, size - 1);
  res.writeHead(206, {
    "Content-Type": type,
    "Content-Length": end - start + 1,
    "Content-Range": `bytes ${start}-${end}/${size}`,
    "Accept-Ranges": "bytes",
  });
  createReadStream(file, { start, end }).pipe(res);
}).listen(PORT, "0.0.0.0", () => {
  console.log(`serving on http://0.0.0.0:${PORT}  (/out/<stem>/..., /assets/...)`);
});
