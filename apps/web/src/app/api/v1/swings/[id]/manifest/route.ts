import { validateSourceManifest } from "@swingsage/schema";
import { ownedView, requireViewAccess, viewParam } from "@/lib/auth";
import { manifestKeyFor } from "@/lib/ingest";
import { SOURCE_BUCKET } from "@/lib/media/keys";
import { getMediaStore } from "@/lib/media/store";

const noStore = { "Cache-Control": "no-store" };

/** A manifest is a page of JSON facts — anything bigger is not a manifest. */
const MAX_MANIFEST_BYTES = 256 * 1024;

/**
 * The local driver's source-manifest upload target — the fallback `createCapture` hands out
 * when the media store cannot sign a URL of its own. Mirror of `poster/route.ts`, with one
 * addition: the body is validated against the shared `source-manifest` schema at the door,
 * because a manifest that does not parse is worth refusing while the client can still say so
 * — the dispatcher would only silently ignore it later.
 *
 * Owner only, same as the video — an instructor can read a swing, never write its media.
 */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireViewAccess(id, viewParam(req));
  if ("error" in access) return access.error;
  if (access.userId !== access.ownerId) {
    return Response.json(
      { error: "only the swing's owner can upload its source manifest" },
      { status: 403, headers: noStore },
    );
  }

  const store = await getMediaStore();
  if (store.kind !== "local") {
    // Never a silent second write path — same rule as the video's local route.
    return Response.json(
      { error: "this deployment issues signed upload URLs — send the file to the target you were given" },
      { status: 409, headers: noStore },
    );
  }

  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.toLowerCase().split(";")[0].trim() !== "application/json") {
    return Response.json(
      { error: "content-type must be application/json" },
      { status: 400, headers: noStore },
    );
  }

  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_MANIFEST_BYTES) {
    return Response.json(
      { error: `a source manifest must be 1–${MAX_MANIFEST_BYTES} bytes of JSON` },
      { status: 400, headers: noStore },
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return Response.json({ error: "the manifest is not JSON" }, { status: 400, headers: noStore });
  }
  const check = validateSourceManifest(parsed);
  if (!check.valid) {
    return Response.json(
      { error: `the manifest does not match the source-manifest schema: ${check.errors[0] ?? ""}` },
      { status: 400, headers: noStore },
    );
  }

  await store.put(SOURCE_BUCKET, manifestKeyFor(ownedView(access)), bytes, "application/json");
  return Response.json({ bytes: bytes.byteLength }, { headers: noStore });
}

export const runtime = "nodejs";
