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

export interface MediaStore {
  readonly kind: "local" | "supabase";
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
  /** Everything under a prefix. Returns how many objects went — the deletion cascade (D24). */
  removePrefix(bucket: string, prefix: string): Promise<number>;
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
export function mediaDriverName(): "local" | "supabase" {
  return process.env.MEDIA_DRIVER === "supabase" ? "supabase" : "local";
}

export async function getMediaStore(): Promise<MediaStore> {
  if (cached) return cached;
  if (mediaDriverName() === "supabase") {
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
