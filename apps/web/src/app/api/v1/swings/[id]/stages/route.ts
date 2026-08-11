import { isStage, listStages, setStage } from "@/db/stages";
import { withUser } from "@/db/session";
import { requireViewAccess, viewParam } from "@/lib/auth";

/**
 * Hand-corrected swing-stage keyframes for one swing VIEW.
 *
 * `?view=dtl|face_on` selects the camera, defaulting to the swing's primary view — a stage mark
 * is a frame number, so it belongs to one video (migration 0006).
 *
 *   GET -> { stages: [{stage, frame}, ...] } in swing order
 *   PUT { stage, frame }        -> pins that stage to that frame, releasing whatever held it
 *   PUT { stage, frame: null }  -> clears it
 *
 * One stage per request, unlike the markers route's batch: picking a stage is a single deliberate
 * choice rather than a drag that emits a position per pointer move, so there is nothing to
 * coalesce and no reason to make the user press save.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const access = await requireViewAccess(id, viewParam(req));
  if ("error" in access) return access.error;
  const stages = await withUser(access.userId, (tx) => listStages(tx, access.viewId));
  return Response.json({ stages }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  let body: { stage?: unknown; frame?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "body must be JSON" }, { status: 400 });
  }
  const stage = typeof body.stage === "string" ? body.stage : "";
  if (!isStage(stage)) return Response.json({ error: `unknown stage: ${stage}` }, { status: 400 });
  const frame = body.frame === null ? null
    : typeof body.frame === "number" ? body.frame
    : undefined;
  if (frame === undefined) {
    return Response.json({ error: "frame must be a number or null" }, { status: 400 });
  }

  // Ownership, not merely sign-in. These write to a swing named in the URL, so checking only
  // that SOMEONE is signed in would let any account edit any swing's corrections.
  const access = await requireViewAccess(id, viewParam(req));
  if ("error" in access) return access.error;
  try {
    // One transaction: the write and the read-back that the client renders cannot disagree.
    const stages = await withUser(access.userId, async (tx) => {
      await setStage(tx, access.viewId, access.userId, stage, frame);
      return listStages(tx, access.viewId);
    });
    return Response.json({ stages });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 404 });
  }
}
