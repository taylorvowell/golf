import { ownedView, requireViewAccess, viewParam } from "@/lib/auth";
import { rawKeyFor } from "@/lib/ingest";
import { SOURCE_BUCKET } from "@/lib/media/keys";
import { getMediaStore } from "@/lib/media/store";

const noStore = { "Cache-Control": "no-store" };

/**
 * The local driver's upload target — the fallback `createCapture` hands out when the media store
 * cannot sign a URL of its own.
 *
 * **This exists so the capture loop works with no cloud account, and for no other reason.** With
 * Supabase Storage as the driver the client is given a signed URL and these bytes never come near
 * this server, which is the only arrangement that survives production: a serverless function
 * cannot accept a request body the size of a phone video, and buffering one here (as this route
 * must, since `MediaStore.put` is byte-oriented) would be a memory fault rather than a slow path.
 * A deployment reaching this route with real users is misconfigured, not merely unoptimised.
 *
 * Owner only. `requireViewAccess` also admits an approved instructor, which is correct for reading a
 * swing and wrong for writing its source — the same distinction `reanalyze` draws.
 */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireViewAccess(id, viewParam(req));
  if ("error" in access) return access.error;
  if (access.userId !== access.ownerId) {
    return Response.json(
      { error: "only the swing's owner can upload its video" },
      { status: 403, headers: noStore },
    );
  }

  const store = await getMediaStore();
  if (store.kind !== "local") {
    // Never a silent second write path: a driver that signs has already told the client where to
    // go, and accepting the bytes here as well would leave two ways for an object to arrive.
    return Response.json(
      { error: "this deployment issues signed upload URLs — send the file to the target you were given" },
      { status: 409, headers: noStore },
    );
  }

  const contentType = req.headers.get("content-type") ?? "";
  let key: string;
  try {
    key = rawKeyFor(ownedView(access), contentType);
  } catch {
    return Response.json(
      { error: "content-type must be video/mp4 or video/quicktime" },
      { status: 400, headers: noStore },
    );
  }

  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength === 0) {
    return Response.json({ error: "empty upload" }, { status: 400, headers: noStore });
  }

  /**
   * Refuse a body that arrived short of what the client said it was sending.
   *
   * Next buffers a request body up to `proxyClientMaxBodySize` and, past that, **keeps the first
   * N bytes and carries on** — no error to the client, no exception here. So a clip over the
   * ceiling is stored as a truncated MP4 that answers 200, and the failure surfaces minutes later
   * as `ffprobe` exiting 1 inside the analyzer, pointing at the analyzer instead of at the
   * upload. That happened on 2026-08-22 and cost the whole import.
   *
   * The ceiling is raised in `next.config.ts`, but a ceiling is a number someone can outgrow
   * again; this check is what makes outgrowing it loud. Same discipline as `completeCapture`,
   * one step earlier: the claim is verified, never believed.
   */
  const declared = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > 0 && bytes.byteLength !== declared) {
    return Response.json(
      {
        error: "truncated upload",
        message:
          `only ${bytes.byteLength} of ${declared} bytes arrived — the video was cut off in ` +
          "transit and has NOT been saved. Try again on a stronger connection.",
      },
      { status: 400, headers: noStore },
    );
  }

  await store.put(SOURCE_BUCKET, key, bytes, contentType);

  // Deliberately does NOT mark the view uploaded or enqueue anything. Landing the bytes and
  // deciding they count are separate steps precisely so the signed path — where this server never
  // sees the upload at all — goes through the same completion check rather than a shortcut.
  return Response.json({ bytes: bytes.byteLength }, { headers: noStore });
}

export const runtime = "nodejs";
