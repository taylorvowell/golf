import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import {
  CopyObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { MediaStore, OpenedObject } from "./store";

/**
 * Cloudflare R2 driver — the production media store (D64, step 09's appended note).
 *
 * Same shape as the Supabase driver: buckets are private, playback is a short-lived signed URL
 * minted after `requireViewAccess` has already resolved ownership, and uploads go client → R2
 * through a presigned PUT so a phone video never transits a serverless function. R2 speaks the
 * S3 API, so this is the AWS SDK pointed at the account endpoint; egress is $0/GB, which is why
 * production media lives here rather than Supabase Storage.
 *
 * **Credential tier matters (the ENVIRONMENT.md trap):** this driver uses the OBJECT-scoped
 * `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`, which cannot list or create buckets — and must not:
 * bucket management is provisioning, not runtime. A 403 from ListBuckets here is the tier
 * working, never a bug to fix by reaching for the admin keys.
 *
 * The authorization note on the Supabase driver applies verbatim: this credential is not subject
 * to any storage policy, so media authorization rests on `requireViewAccess` in the route.
 */

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required for the r2 media driver`);
  return v;
}

let client: S3Client | null = null;

function s3(): S3Client {
  if (client) return client;
  client = new S3Client({
    region: "auto",
    endpoint: `https://${requireEnv("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
    },
  });
  return client;
}

/** Upload targets outlive one request comfortably; chosen (R2 lets us), reported per the seam. */
const UPLOAD_TTL_SECONDS = 2 * 60 * 60;

function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === "NoSuchKey" || e?.name === "NotFound" || e?.$metadata?.httpStatusCode === 404;
}

export function r2Store(): MediaStore {
  return {
    kind: "r2",
    canRedirect: true,

    async exists(bucket, key) {
      try {
        await s3().send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return true;
      } catch (err) {
        if (isNotFound(err)) return false;
        throw err;
      }
    },

    /** Objects live in a bucket, not on this machine — so there is no path, ever. */
    async localPath() {
      return null;
    },

    async getBytes(bucket, key) {
      try {
        const out = await s3().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        if (!out.Body) return null;
        return new Uint8Array(await out.Body.transformToByteArray());
      } catch (err) {
        if (isNotFound(err)) return null;
        throw err;
      }
    },

    /**
     * Range-aware read. Like the Supabase driver, video rarely lands here — `canRedirect` sends
     * the player at a signed URL and R2 serves the range itself. This path covers JSON artifacts
     * and any server-side reader.
     */
    async open(bucket, key, range): Promise<OpenedObject | null> {
      try {
        const rangeHeader =
          range == null ? undefined : `bytes=${range.start}-${range.end ?? ""}`;
        const out = await s3().send(
          new GetObjectCommand({ Bucket: bucket, Key: key, Range: rangeHeader }),
        );
        if (!out.Body) return null;
        const contentType = out.ContentType || "application/octet-stream";
        const body = out.Body.transformToWebStream() as ReadableStream<Uint8Array>;

        if (rangeHeader && out.ContentRange) {
          // "bytes start-end/total" — the seam reports the FULL size plus the slice served.
          const m = /bytes\s+(\d+)-(\d+)\/(\d+)/.exec(out.ContentRange);
          if (m) {
            return {
              body,
              size: Number(m[3]),
              contentType,
              range: { start: Number(m[1]), end: Number(m[2]) },
            };
          }
        }
        return { body, size: out.ContentLength ?? 0, contentType, range: null };
      } catch (err) {
        if (isNotFound(err)) return null;
        // An unsatisfiable range comes back 416, which the seam treats as "no object slice".
        if ((err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode === 416) {
          return null;
        }
        throw err;
      }
    },

    async put(bucket, key, body, contentType) {
      await s3().send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
      );
    },

    async putFile(bucket, key, filePath, contentType) {
      const size = (await stat(filePath)).size;
      await s3().send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: createReadStream(filePath),
          ContentLength: size,
          ContentType: contentType,
        }),
      );
    },

    async signedUrl(bucket, key, ttlSeconds) {
      return getSignedUrl(s3(), new GetObjectCommand({ Bucket: bucket, Key: key }), {
        expiresIn: ttlSeconds,
      });
    },

    /**
     * Presigned PUT, so a ~300 MB phone clip goes phone → R2 and never touches this server.
     * Unlike Supabase's fixed two hours, the TTL here is ours — chosen to match, reported per
     * the seam so an upload that outruns it re-requests a target instead of failing silently.
     */
    async signedUploadUrl(bucket, key, contentType) {
      const url = await getSignedUrl(
        s3(),
        new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }),
        { expiresIn: UPLOAD_TTL_SECONDS },
      );
      return {
        url,
        method: "PUT",
        // content-type is part of the signature — the client must send it verbatim.
        headers: { "content-type": contentType },
        expiresIn: UPLOAD_TTL_SECONDS,
      };
    },

    async removePrefix(bucket, prefix) {
      // S3 lists recursively by prefix — no tree walk needed. Deletes batch at 1000.
      const listPrefix = prefix.endsWith("/") ? prefix : `${prefix}/`;
      let removed = 0;
      let token: string | undefined;
      do {
        const page = await s3().send(
          new ListObjectsV2Command({ Bucket: bucket, Prefix: listPrefix, ContinuationToken: token }),
        );
        const keys = (page.Contents ?? []).flatMap((o) => (o.Key ? [{ Key: o.Key }] : []));
        if (keys.length) {
          await s3().send(
            new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys, Quiet: true } }),
          );
          removed += keys.length;
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
      return removed;
    },

    async movePrefix(bucket, from, to) {
      // S3 has no rename: copy each object to its new key, then delete the old. A copy that
      // finds its destination already present is an earlier interrupted run getting finished.
      const listPrefix = from.endsWith("/") ? from : `${from}/`;
      let moved = 0;
      let token: string | undefined;
      do {
        const page = await s3().send(
          new ListObjectsV2Command({ Bucket: bucket, Prefix: listPrefix, ContinuationToken: token }),
        );
        for (const obj of page.Contents ?? []) {
          if (!obj.Key) continue;
          const dest = `${to}${obj.Key.slice(from.length)}`;
          await s3().send(
            new CopyObjectCommand({
              Bucket: bucket,
              Key: dest,
              CopySource: `/${bucket}/${encodeURIComponent(obj.Key).replace(/%2F/g, "/")}`,
            }),
          );
          moved += 1;
        }
        const keys = (page.Contents ?? []).flatMap((o) => (o.Key ? [{ Key: o.Key }] : []));
        if (keys.length) {
          await s3().send(
            new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys, Quiet: true } }),
          );
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
      return moved;
    },
  };
}
