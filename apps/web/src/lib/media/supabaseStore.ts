import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { MediaStore, OpenedObject } from "./store";

/**
 * Supabase Storage driver (D8).
 *
 * Buckets are **private**. Playback works by minting a short-lived signed URL after the route has
 * already resolved ownership, so the bytes are served by Supabase's CDN — which is what preserves
 * HTTP range requests, and therefore frame-accurate scrubbing, without proxying ~30 MB of video
 * through the Next.js server on every seek.
 *
 * **Authorization note, recorded rather than glossed:** this driver holds a storage credential
 * that is not subject to the `storage.objects` policies, exactly as the analyzer worker will need
 * to be. Media authorization therefore still rests on `requireViewAccess` in the route, the same
 * place it rested when media came off local disk. Pushing it into storage-level policy is the
 * same open item as D24's "scope the analyzer's service role to specific tables", and belongs
 * with it — writing policies now while a bypassing credential does the reading would ship a
 * second inert boundary, which is precisely the mistake D26 and the `clubs` grant bug already
 * cost this project once each.
 */

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required for the supabase media driver`);
  return v;
}

let client: SupabaseClient | null = null;

function storageClient(): SupabaseClient {
  if (client) return client;
  client = createClient(
    process.env.SUPABASE_URL ?? requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SECRET_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return client;
}

export function supabaseStore(): MediaStore {
  return {
    kind: "supabase",
    canRedirect: true,

    async exists(bucket, key) {
      const slash = key.lastIndexOf("/");
      const { data, error } = await storageClient()
        .storage.from(bucket)
        .list(key.slice(0, slash), { search: key.slice(slash + 1), limit: 1 });
      return !error && !!data?.length;
    },

    async getBytes(bucket, key) {
      const { data, error } = await storageClient().storage.from(bucket).download(key);
      if (error || !data) return null;
      return new Uint8Array(await data.arrayBuffer());
    },

    /**
     * Used only by the JSON artifact routes and by anything running without a browser. Video never
     * comes through here — `canRedirect` sends the player straight at a signed URL instead, which
     * is the whole reason range requests keep working over the network path.
     */
    async open(bucket, key, range): Promise<OpenedObject | null> {
      const { data, error } = await storageClient()
        .storage.from(bucket)
        .download(key, range ? { ...({} as object) } : undefined);
      if (error || !data) return null;

      const size = data.size;
      const contentType = data.type || "application/octet-stream";
      if (!range) {
        return { body: data.stream() as ReadableStream<Uint8Array>, size, contentType, range: null };
      }

      // The storage SDK has no range parameter, so slice the downloaded blob. Correct, and only
      // ever reached for small artifacts — the video path redirects and never lands here.
      const start = range.start;
      const end = Math.min(range.end ?? size - 1, size - 1);
      if (start < 0 || start > end) return null;
      return {
        body: data.slice(start, end + 1).stream() as ReadableStream<Uint8Array>,
        size,
        contentType,
        range: { start, end },
      };
    },

    async put(bucket, key, body, contentType) {
      const { error } = await storageClient()
        .storage.from(bucket)
        .upload(key, body, { contentType, upsert: true });
      if (error) throw new Error(`storage put ${bucket}/${key}: ${error.message}`);
    },

    async putFile(bucket, key, filePath, contentType) {
      const size = (await stat(filePath)).size;
      const stream = createReadStream(filePath);
      const { error } = await storageClient()
        .storage.from(bucket)
        .upload(key, stream as unknown as ReadableStream, {
          contentType,
          upsert: true,
          duplex: "half",
          headers: { "content-length": String(size) },
        } as Parameters<ReturnType<SupabaseClient["storage"]["from"]>["upload"]>[2]);
      if (error) throw new Error(`storage putFile ${bucket}/${key}: ${error.message}`);
    },

    async signedUrl(bucket, key, ttlSeconds) {
      const { data, error } = await storageClient()
        .storage.from(bucket)
        .createSignedUrl(key, ttlSeconds);
      if (error || !data) return null;
      return data.signedUrl;
    },

    /**
     * Storage's own signed upload endpoint, so a ~300 MB phone clip goes phone → Supabase and
     * never touches this server. Proxying it is not merely wasteful — a serverless function
     * cannot accept a body that size at all, so this is the only shape that works in production.
     *
     * **The two-hour lifetime is Storage's, not a parameter.** `createSignedUploadUrl` has no TTL
     * argument, so it is reported here rather than chosen; an upload that outruns it re-requests
     * a target instead of failing silently.
     */
    async signedUploadUrl(bucket, key, contentType) {
      const { data, error } = await storageClient()
        .storage.from(bucket)
        .createSignedUploadUrl(key);
      if (error || !data) return null;
      return {
        url: data.signedUrl,
        method: "PUT",
        // Exactly what `uploadToSignedUrl` sends for a non-Blob body. `x-upsert` stays false: a
        // source key is minted per view and a second write to one means a bug, not a retry.
        headers: { "content-type": contentType },
        expiresIn: 2 * 60 * 60,
      };
    },

    async removePrefix(bucket, prefix) {
      // Storage has no recursive delete: list the tree, then remove by explicit key. Depth is
      // bounded (a view prefix holds revision folders holding flat artifact names), so a simple
      // two-level walk covers the whole shape without unbounded recursion.
      const store = storageClient().storage.from(bucket);
      const keys: string[] = [];
      const walk = async (dir: string, depth: number): Promise<void> => {
        if (depth > 4) return;
        const { data } = await store.list(dir, { limit: 1000 });
        for (const entry of data ?? []) {
          const child = `${dir}/${entry.name}`;
          // A directory placeholder has no id; a real object always does.
          if (entry.id) keys.push(child);
          else await walk(child, depth + 1);
        }
      };
      await walk(prefix, 0);
      if (!keys.length) return 0;
      const { error } = await store.remove(keys);
      if (error) throw new Error(`storage removePrefix ${bucket}/${prefix}: ${error.message}`);
      return keys.length;
    },

    async movePrefix(bucket, from, to) {
      // Storage has no prefix rename either: enumerate, then move each object by explicit key.
      // Same bounded two-level walk as `removePrefix` — a view prefix holds revision folders
      // holding flat artifact names.
      const store = storageClient().storage.from(bucket);
      const keys: string[] = [];
      const walk = async (dir: string, depth: number): Promise<void> => {
        if (depth > 4) return;
        const { data } = await store.list(dir, { limit: 1000 });
        for (const entry of data ?? []) {
          const child = `${dir}/${entry.name}`;
          if (entry.id) keys.push(child);
          else await walk(child, depth + 1);
        }
      };
      await walk(from, 0);

      let moved = 0;
      for (const key of keys) {
        const { error } = await store.move(key, `${to}${key.slice(from.length)}`);
        // An object already at the destination means an earlier run got that far. Treated as
        // done rather than fatal, so an interrupted move can be finished by running it again.
        if (error && !/exists/i.test(error.message)) {
          throw new Error(`storage movePrefix ${bucket}/${key}: ${error.message}`);
        }
        moved += 1;
      }
      return moved;
    },
  };
}
