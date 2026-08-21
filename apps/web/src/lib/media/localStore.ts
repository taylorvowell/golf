import fs from "node:fs";
import { constants } from "node:fs";
import { access, copyFile, link, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import type { MediaStore, OpenedObject } from "./store";

/**
 * The credential-free driver: object keys become directories under one root.
 *
 * Step 09 requires a local path that needs no cloud credentials, and this is it. The layout
 * mirrors the object keys exactly — `.media/<bucket>/u/<uid>/s/<sid>/v/<vid>/r1/analysis.json` —
 * so a key resolves to the same place in both drivers and no code branches on which is running.
 *
 * This is NOT the analyzer's `out/<stem>/` directory, and the distinction matters. `out/` is the
 * CV pipeline's working directory, named by clip stem, owned by `burnin.py` and rewritten
 * wholesale by every run. The store is the product's media, addressed by identity. `publish.ts`
 * moves artifacts from the first into the second, which is what lets step 09 change *where*
 * artifacts land without touching what the analyzer produces.
 */

export const DEFAULT_STORE_ROOT = path.resolve(process.cwd(), "..", "..", ".media");

export function storeRoot(): string {
  return process.env.MEDIA_STORE_ROOT ?? DEFAULT_STORE_ROOT;
}

/**
 * Keys are already validated by `keys.ts`, but this driver is the one that joins them to a
 * filesystem root, so it re-checks rather than trusting its caller. A key is a `/`-joined run of
 * safe segments and nothing else — no `..`, no backslashes, no absolute path, no drive letter.
 */
function resolveKey(bucket: string, key: string): string {
  if (!/^[a-z0-9-]+$/.test(bucket)) throw new Error("invalid bucket");
  const segments = key.split("/");
  if (!segments.length || segments.some((s) => !/^[A-Za-z0-9._-]+$/.test(s) || s === "..")) {
    throw new Error(`invalid media key: ${JSON.stringify(key)}`);
  }
  return path.join(storeRoot(), bucket, ...segments);
}

async function ensureDir(file: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
}

export function localStore(): MediaStore {
  return {
    kind: "local",
    /**
     * False, so the video route streams bytes itself with its existing Range handling rather than
     * redirecting. A `file://` URL would be useless to the browser, and a dev-only static route
     * would be a second serving path to keep correct for no gain.
     */
    canRedirect: false,

    async exists(bucket, key) {
      try {
        await access(resolveKey(bucket, key), constants.R_OK);
        return true;
      } catch {
        return false;
      }
    },

    async getBytes(bucket, key) {
      try {
        return new Uint8Array(await readFile(resolveKey(bucket, key)));
      } catch {
        return null;
      }
    },

    async open(bucket, key, range): Promise<OpenedObject | null> {
      let file: string;
      try {
        file = resolveKey(bucket, key);
      } catch {
        return null;
      }

      let size: number;
      try {
        size = (await stat(file)).size;
      } catch {
        return null;
      }

      const contentType = guessContentType(key);
      if (!range) {
        return {
          body: Readable.toWeb(fs.createReadStream(file)) as ReadableStream<Uint8Array>,
          size,
          contentType,
          range: null,
        };
      }

      const start = range.start;
      const end = Math.min(range.end ?? size - 1, size - 1);
      if (!Number.isFinite(start) || start < 0 || start > end) return null;

      return {
        body: Readable.toWeb(
          fs.createReadStream(file, { start, end }),
        ) as ReadableStream<Uint8Array>,
        size,
        contentType,
        range: { start, end },
      };
    },

    async put(bucket, key, body) {
      const file = resolveKey(bucket, key);
      await ensureDir(file);
      await writeFile(file, body);
    },

    /**
     * Hard-link first, copy on failure.
     *
     * Publishing ten fixtures copies ~512 MB of video that already exists on the same disk. A
     * hard link makes that near-free and keeps `.media/` cheap to rebuild; it fails across
     * volumes and on filesystems that lack them, which is exactly what the fallback is for.
     * Neither side ever mutates a published file in place — a re-analysis writes a new revision —
     * so sharing an inode with the analyzer's working copy is safe.
     */
    async putFile(bucket, key, filePath) {
      const dest = resolveKey(bucket, key);
      await ensureDir(dest);
      await rm(dest, { force: true });
      try {
        await link(filePath, dest);
      } catch {
        await copyFile(filePath, dest);
      }
    },

    async signedUrl() {
      return null;
    },

    /**
     * Null by construction: this driver holds no credential, so there is nothing for it to sign.
     *
     * The ingest route reads that as "hand the client my own upload route" — which is why the
     * whole capture loop runs with no cloud account while the client-side flow stays byte-for-byte
     * the production one.
     */
    async signedUploadUrl() {
      return null;
    },

    async removePrefix(bucket, prefix) {
      const dir = resolveKey(bucket, prefix);
      let count = 0;
      const walk = async (p: string): Promise<void> => {
        let entries;
        try {
          entries = await fs.promises.readdir(p, { withFileTypes: true });
        } catch {
          return;
        }
        for (const e of entries) {
          if (e.isDirectory()) await walk(path.join(p, e.name));
          else count += 1;
        }
      };
      await walk(dir);
      await rm(dir, { recursive: true, force: true });
      return count;
    },

    async movePrefix(bucket, from, to) {
      const src = resolveKey(bucket, from);
      const dest = resolveKey(bucket, to);

      // Count first — after the rename there is nothing at the source to walk, and reporting
      // "moved 0" while having moved a hundred files is how a migration gets re-run.
      let count = 0;
      const walk = async (p: string): Promise<void> => {
        let entries;
        try {
          entries = await fs.promises.readdir(p, { withFileTypes: true });
        } catch {
          return;
        }
        for (const e of entries) {
          if (e.isDirectory()) await walk(path.join(p, e.name));
          else count += 1;
        }
      };
      await walk(src);
      if (!count) return 0;

      await mkdir(path.dirname(dest), { recursive: true });
      try {
        await fs.promises.rename(src, dest);
      } catch {
        // `rename` fails when the destination already exists (a partially-completed earlier run),
        // and on Windows it also fails across volumes. Merging file-by-file covers both, and is
        // the only shape that makes a re-run of an interrupted move finish rather than throw.
        await mergeInto(src, dest);
        await rm(src, { recursive: true, force: true });
      }
      return count;
    },
  };
}

/** Recursive copy that tolerates an existing destination — the retry path for `movePrefix`. */
async function mergeInto(src: string, dest: string): Promise<void> {
  await mkdir(dest, { recursive: true });
  for (const e of await fs.promises.readdir(src, { withFileTypes: true })) {
    const from = path.join(src, e.name);
    const to = path.join(dest, e.name);
    if (e.isDirectory()) await mergeInto(from, to);
    else await copyFile(from, to);
  }
}

function guessContentType(key: string): string {
  if (key.endsWith(".json")) return "application/json";
  if (key.endsWith(".mp4")) return "video/mp4";
  if (key.endsWith(".jpg") || key.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}
