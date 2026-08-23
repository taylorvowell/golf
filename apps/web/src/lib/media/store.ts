import type { ArtifactName } from "./keys";

/**
 * The media store seam.
 *
 * Two drivers implement this: `localStore` (a filesystem root, no credentials) and
 * `supabaseStore` (Supabase Storage, per D8). The interface is deliberately small and
 * byte-oriented — it knows nothing about swings, views or the database, so neither driver can
 * grow a dependency on the product schema.
 *
 * The reason both exist is step 09's own requirement: pipeline work must stay possible with no
 * cloud credentials. That is not a convenience. The analyzer is the asset in this repository and
 * making its inner loop depend on a network round-trip would be the single most expensive
 * self-inflicted wound available.
 */

export interface ByteRange {
  start: number;
  /** Inclusive. Absent means "to the end of the object". */
  end?: number;
}

export interface OpenedObject {
  body: ReadableStream<Uint8Array>;
  /** The object's FULL size, not the length of the returned slice — callers build Content-Range. */
  size: number;
  contentType: string;
  /** The slice actually returned, or null when the whole object is. */
  range: { start: number; end: number } | null;
}

/**
 * Where a client sends the bytes of an upload, and how.
 *
 * The whole point of this shape is that **the client never branches on the driver**. It asks the
 * API for a target, then sends the file exactly as described — a Supabase signed-storage URL and
 * the local driver's own upload route are the same three fields to the caller. That is what keeps
 * the resumable transport `media-pipeline` adds later a swap of *how* the bytes travel rather than
 * a second ingest design, and it is why the upload never proxies through a serverless function:
 * a phone video is far past what one can accept as a request body.
 */
export interface UploadTarget {
  /**
   * Absolute for a driver that signs (the bytes go straight to storage, never through the API);
   * app-relative for the local driver, whose only upload path is a route on this server.
   */
  url: string;
  method: "PUT";
  /** Sent verbatim by the client. `content-type` is always present. */
  headers: Record<string, string>;
  /** Seconds from issue until the target stops working. */
  expiresIn: number;
}

export interface MediaStore {
  readonly kind: "local" | "supabase" | "r2";
  /** Whether this driver can mint a URL the browser fetches directly (a CDN/signed-URL path). */
  readonly canRedirect: boolean;

  exists(bucket: string, key: string): Promise<boolean>;
  getBytes(bucket: string, key: string): Promise<Uint8Array | null>;
  /** Range-aware read. Returns null when the object does not exist. */
  open(bucket: string, key: string, range: ByteRange | null): Promise<OpenedObject | null>;
  put(bucket: string, key: string, body: Uint8Array, contentType: string): Promise<void>;
  /**
   * Copy a local file in without reading it into memory — how a ~30 MB `normalized.mp4` gets
   * published. The local driver hard-links it; the cloud driver streams it up.
   */
  putFile(bucket: string, key: string, filePath: string, contentType: string): Promise<void>;
  /** A URL the browser can fetch directly, or null on a driver that has none. */
  signedUrl(bucket: string, key: string, ttlSeconds: number): Promise<string | null>;
  /**
   * A one-shot target the client can PUT an object to WITHOUT holding a storage credential, or
   * null on a driver that cannot mint one (the local driver, which has no credentials at all).
   *
   * A null is not a failure — it is the ingest route's signal to hand back its own upload route
   * instead, which is how the same two-phase flow works with no cloud account. Callers must treat
   * the returned key as **claimed but not yet written**: nothing has been uploaded when this
   * resolves, so the completion half still has to verify the object really landed.
   */
  signedUploadUrl(
    bucket: string,
    key: string,
    contentType: string,
  ): Promise<UploadTarget | null>;
  /**
   * Where this object sits on THIS machine's disk, or null on a driver whose objects are not
   * files here.
   *
   * Exists for exactly one caller: the local analysis path, which spawns `burnin.py` as a child
   * process and therefore needs a path a Python process can open. The cloud driver correctly
   * answers null — its objects are not on this machine — and that null is what makes it
   * impossible to accidentally build a production path on the assumption that they are.
   *
   * Never returns a path for an object that is not there: a caller about to hand this to a
   * subprocess should not have to distinguish "no such object" from "wrong driver".
   */
  localPath(bucket: string, key: string): Promise<string | null>;
  /** Everything under a prefix. Returns how many objects went — the deletion cascade (D24). */
  removePrefix(bucket: string, prefix: string): Promise<number>;
  /**
   * Re-home everything under a prefix. Returns how many objects moved.
   *
   * Exists because **a key leads with the owner's id** (D33), so anything that changes who owns a
   * swing changes where its media lives. `db:claim-fixtures` is the case that found this: it
   * reassigned ten swings to a real account and every artifact stayed in the development
   * identity's namespace, so each swing resolved to a key with nothing behind it — a log full of
   * swings with no thumbnails and no video, and no error anywhere to say why.
   */
  movePrefix(bucket: string, from: string, to: string): Promise<number>;
}

/** JSON convenience shared by both drivers — parsing is identical either side. */
export async function getJson<T>(
  store: MediaStore,
  bucket: string,
  key: string,
): Promise<T | null> {
  const bytes = await store.getBytes(bucket, key);
  if (!bytes) return null;
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    // A truncated or half-written artifact reads as absent rather than throwing. Mid-analysis is
    // a normal state, and the player already handles "no artifact yet".
    return null;
  }
}

export type ArtifactDescriptor = { name: ArtifactName; contentType: string };

let cached: MediaStore | null = null;

/**
 * Which driver is in play. **Cloud is opt-in, never inferred.**
 *
 * The tempting rule is "use Supabase Storage if Supabase is configured", and it is wrong here:
 * this environment already has Supabase env vars for *auth* while its media is on local disk, so
 * inference would silently point every artifact read at a bucket that does not exist and report it
 * as a missing swing. Defaulting to local also means a fresh clone can run the pipeline before it
 * has any credential at all, which is step 09's own requirement.
 */
export function mediaDriverName(): "local" | "supabase" | "r2" {
  if (process.env.MEDIA_DRIVER === "r2") return "r2";
  return process.env.MEDIA_DRIVER === "supabase" ? "supabase" : "local";
}

export async function getMediaStore(): Promise<MediaStore> {
  if (cached) return cached;
  const driver = mediaDriverName();
  if (driver === "r2") {
    const { r2Store } = await import("./r2Store");
    cached = r2Store();
  } else if (driver === "supabase") {
    const { supabaseStore } = await import("./supabaseStore");
    cached = supabaseStore();
  } else {
    const { localStore } = await import("./localStore");
    cached = localStore();
  }
  return cached;
}

/** Tests and scripts that switch drivers mid-process. */
export function resetMediaStore(): void {
  cached = null;
}
