import { isStage, listStages, setStage } from "@/db/stages";
import { requireSwingAccess } from "@/lib/auth";

/** Same guard the other id-off-the-URL routes apply. See `markers/route.ts` for why it is
 * repeated rather than shared. */
function safeId(id: string): string | null {
  return /^[A-Za-z0-9._-]+$/.test(id) ? id : null;
}

/**
 * Hand-corrected swing-stage keyframes for one swing.
 *
 *   GET -> { stages: [{stage, frame}, ...] } in swing order
 *   PUT { stage, frame }        -> pins that stage to that frame, releasing whatever held it
 *   PUT { stage, frame: null }  -> clears it
 *
 * One stage per request, unlike the markers route's batch: picking a stage is a single deliberate
 * choice rather than a drag that emits a position per pointer move, so there is nothing to
 * coalesce and no reason to make the user press save.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const swingId = safeId(id);
  if (!swingId) return Response.json({ error: "bad id" }, { status: 400 });
  const stages = await listStages(swingId);
  return Response.json({ stages }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const swingId = safeId(id);
  if (!swingId) return Response.json({ error: "bad id" }, { status: 400 });

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
  const access = await requireSwingAccess(swingId);
  if ("error" in access) return access.error;
  const { userId } = access;
  try {
    await setStage(swingId, userId, stage, frame);
    return Response.json({ stages: await listStages(swingId) });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 404 });
  }
}
