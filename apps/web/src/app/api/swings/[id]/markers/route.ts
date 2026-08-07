import { listMarkers, saveMarkers, type HeadMarker } from "@/db/markers";
import { getCurrentUserId } from "@/lib/auth";

/**
 * Same guard `lib/swings.ts` applies to ids off the URL. Repeated here rather than exported
 * from there: that module reads the filesystem and pulls in the Postgres client, and the split
 * that keeps it away from client bundles (CLAUDE.md) is worth more than three saved lines.
 */
function safeId(id: string): string | null {
  return /^[A-Za-z0-9._-]+$/.test(id) ? id : null;
}

/**
 * Hand-placed club-head positions for one swing (the player's "modify head markers" mode).
 *
 *   GET  -> { markers: [{frame, x, y}, ...] } ordered by frame
 *   PUT  { markers: [{frame, x, y}], deleted: [frame] } -> { saved, deleted }
 *
 * PUT is a batch and not idempotent-per-click on purpose — see `db/markers.ts`. Coordinates are
 * normalized 0–1 against the video frame, the same convention as `analysis.json`.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const swingId = safeId(id);
  if (!swingId) return Response.json({ error: "bad id" }, { status: 400 });
  const markers = await listMarkers(swingId);
  return Response.json({ markers }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const swingId = safeId(id);
  if (!swingId) return Response.json({ error: "bad id" }, { status: 400 });

  let body: { markers?: unknown; deleted?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "body must be JSON" }, { status: 400 });
  }
  const markers = Array.isArray(body.markers) ? (body.markers as HeadMarker[]) : [];
  const deleted = Array.isArray(body.deleted) ? (body.deleted as number[]) : [];
  if (!markers.length && !deleted.length) {
    return Response.json({ saved: 0, deleted: 0 });
  }

  const userId = await getCurrentUserId();
  try {
    const result = await saveMarkers(swingId, userId, markers, deleted);
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 404 });
  }
}
