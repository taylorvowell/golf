import { ownedView, requireViewAccess, viewParam } from "@/lib/auth";
import { posterKeyFor } from "@/lib/ingest";
import { SOURCE_BUCKET } from "@/lib/media/keys";
import { getMediaStore } from "@/lib/media/store";

const noStore = { "Cache-Control": "no-store" };

/** A poster is one JPEG frame at card size — anything bigger is not a poster. */
const MAX_POSTER_BYTES = 2 * 1024 * 1024;

/**
 * The local driver's poster upload target — the fallback `createCapture` hands out when the
 * media store cannot sign a URL of its own. The signed-driver rules from `source/route.ts`
 * apply unchanged: with R2 as the driver the client is given a signed URL and these bytes never
 * come near this server.
 *
 * Owner only, same as the video — an instructor can read a swing, never write its media.
 */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireViewAccess(id, viewParam(req));
  if ("error" in access) return access.error;
  if (access.userId !== access.ownerId) {
    return Response.json(
      { error: "only the swing's owner can upload its poster" },
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
  if (contentType.toLowerCase().split(";")[0].trim() !== "image/jpeg") {
    return Response.json(
      { error: "content-type must be image/jpeg" },
      { status: 400, headers: noStore },
    );
  }

  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength === 0) {
    return Response.json({ error: "empty upload" }, { status: 400, headers: noStore });
  }
  if (bytes.byteLength > MAX_POSTER_BYTES) {
    return Response.json(
      { error: `a poster frame must be under ${MAX_POSTER_BYTES} bytes` },
      { status: 400, headers: noStore },
    );
  }

  await store.put(SOURCE_BUCKET, posterKeyFor(ownedView(access)), bytes, "image/jpeg");
  return Response.json({ bytes: bytes.byteLength }, { headers: noStore });
}

export const runtime = "nodejs";
