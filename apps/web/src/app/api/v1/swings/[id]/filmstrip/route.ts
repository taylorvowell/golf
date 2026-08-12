import { ARTIFACT_BUCKET, artifactKey } from "@/lib/media/keys";
import { getMediaStore } from "@/lib/media/store";
import { requireViewAccess, viewParam } from "@/lib/auth";

/**
 * The scrubber's filmstrip — one row of clean frames across the swing's playback window.
 *
 * Deliberately **one image, not N requests**. A scrubber wants a dozen thumbnails at once and this
 * product is used on a course on cellular, so a strip is a single ~30–60 KB fetch and a single
 * decode where twelve separate frame requests would be twelve of each.
 *
 * It carries no metadata, and that is the contract: the cell count and cell shape are constants in
 * `swingsage/render.py`, so a client maps cell `i` onto a frame from the playback window it
 * already holds. Absent is normal and answered 404 — a swing analysed before `filmstrip.jpg`
 * existed simply has no strip, and the player draws its phase bar without one.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const access = await requireViewAccess(id, viewParam(req));
  if ("error" in access) return access.error;

  const store = await getMediaStore();
  const bytes = await store.getBytes(
    ARTIFACT_BUCKET,
    artifactKey(access.address, "filmstrip.jpg"),
  );
  if (!bytes) return new Response("not found", { status: 404 });

  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(bytes.byteLength),
      // Addressed by revision, so a re-analysis mints a different URL rather than changing what
      // this one returns. Private only: this is a picture of a person mid-swing.
      "Cache-Control": "private, max-age=86400",
    },
  });
}
