import { ARTIFACT_BUCKET, artifactKey } from "@/lib/media/keys";
import { getMediaStore } from "@/lib/media/store";
import { requireViewAccess, viewParam } from "@/lib/auth";

/**
 * The contact-frame still the analyzer already writes next to `analysis.json`.
 *
 * The swing log was a text list because nothing served an image, not because none existed —
 * `burnin.py` has written `contact.jpg` all along (UI brief §8.7). A missing file is a plain
 * 404 rather than an error, so a log entry produced before this stage existed just falls back
 * to the card's placeholder.
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
    artifactKey(access.address, "contact.jpg"),
  );
  if (!bytes) return new Response("not found", { status: 404 });

  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(bytes.byteLength),
      // Addressed by revision, so a re-analysis mints a different URL rather than changing what
      // this one returns. The no-store that used to be needed here is therefore obsolete — but a
      // private cache only: this is a picture of a person mid-swing.
      "Cache-Control": "private, max-age=86400",
    },
  });
}
