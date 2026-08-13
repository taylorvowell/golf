import { ARTIFACT_BUCKET, artifactKey, contentTypeFor, isArtifactName } from "@/lib/media/keys";
import { getMediaStore } from "@/lib/media/store";
import { mediaAddress } from "@/db/views";
import { noStore, requireJobAccess } from "@/lib/jobs/internal";

/**
 * The worker uploads one produced artifact. The key is computed HERE, from the job's claims —
 * the worker names only the artifact (`analysis.json`, `overlay.mp4`, ...), and the address is
 * pinned to the token's `targetRevision`, so uploads land at one immutable revision no matter
 * when they arrive. Direct-to-storage signed upload URLs are a deploy-step optimization; for
 * now the bytes stream through this route into the store seam.
 */

/** Nothing the pipeline produces approaches this; a larger body is a bug, not a big swing. */
const MAX_ARTIFACT_BYTES = 1024 * 1024 * 1024;

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string; name: string }> },
) {
  const { id, name } = await params;
  const access = await requireJobAccess(req, id);
  if ("error" in access) return access.error;

  if (!isArtifactName(name)) {
    return Response.json({ error: `unknown artifact name: ${name}` }, { status: 400, headers: noStore });
  }
  if (access.job.status === "done" || access.job.status === "failed") {
    return Response.json({ error: "job is already terminal" }, { status: 409, headers: noStore });
  }

  const declared = Number(req.headers.get("content-length") ?? NaN);
  if (Number.isFinite(declared) && declared > MAX_ARTIFACT_BYTES) {
    return Response.json({ error: "artifact too large" }, { status: 413, headers: noStore });
  }

  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength === 0) {
    return Response.json({ error: "empty body" }, { status: 400, headers: noStore });
  }
  if (bytes.byteLength > MAX_ARTIFACT_BYTES) {
    return Response.json({ error: "artifact too large" }, { status: 413, headers: noStore });
  }

  const address = { ...mediaAddress(access.view), revision: access.claims.targetRevision };
  const store = await getMediaStore();
  await store.put(ARTIFACT_BUCKET, artifactKey(address, name), bytes, contentTypeFor(name));

  return Response.json({ ok: true, name, bytes: bytes.byteLength }, { headers: noStore });
}
