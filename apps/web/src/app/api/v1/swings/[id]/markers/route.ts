import { listMarkers, saveMarkers, type HeadMarker } from "@/db/markers";
import { withUser } from "@/db/session";
import { requireViewAccess, viewParam } from "@/lib/auth";

/**
 * Hand-placed club-head positions for one swing VIEW (the player's "modify head markers" mode).
 *
 *   GET  -> { markers: [{frame, x, y}, ...] } ordered by frame
 *   GET ?hidden=1 -> also includes {frame, hidden: true} rows ("a human looked, no visible
 *        head here" — 0023). Opt-in because a hidden marker has no coordinates, and a client
 *        that predates the field would render it as a head at nowhere; the editor asks for
 *        them, everything else keeps seeing exactly what it saw before.
 *   PUT  { markers: [{frame, x, y} | {frame, hidden: true}], deleted: [frame] } -> { saved, deleted }
 *
 * `?view=dtl|face_on` selects the camera, defaulting to the swing's primary view. A marker is a
 * frame number, and two cameras number the same swing differently, so these are per-view rows —
 * not per-swing (migration 0006).
 *
 * PUT is a batch and not idempotent-per-click on purpose — see `db/markers.ts`. Coordinates are
 * normalized 0–1 against the video frame, the same convention as `analysis.json`.
 *
 * GET is behind the same access check as PUT. It used to answer for any id without one, which
 * returned an empty list for a stranger's swing rather than a 404 — harmless in content and
 * still a disclosure of which ids exist.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const access = await requireViewAccess(id, viewParam(req));
  if ("error" in access) return access.error;
  const includeHidden = new URL(req.url).searchParams.get("hidden") === "1";
  const markers = await withUser(access.userId, (tx) =>
    listMarkers(tx, access.viewId, { includeHidden }));
  return Response.json({ markers }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

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

  // Ownership, not merely sign-in. These write to a swing named in the URL, so checking only
  // that SOMEONE is signed in would let any account edit any swing's corrections.
  const access = await requireViewAccess(id, viewParam(req));
  if ("error" in access) return access.error;
  try {
    const result = await withUser(access.userId, (tx) =>
      saveMarkers(tx, access.viewId, access.userId, markers, deleted));
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 404 });
  }
}
