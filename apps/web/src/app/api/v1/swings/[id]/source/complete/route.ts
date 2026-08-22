import { withUser } from "@/db/session";
import { ownedView, requireViewAccess, viewParam } from "@/lib/auth";
import { completeCapture } from "@/lib/ingest";

const noStore = { "Cache-Control": "no-store" };

/**
 * Phase two of ingest: the client says the upload finished, and this decides whether it did.
 *
 * **The claim is checked, never taken.** The client uploaded to a different host entirely (storage,
 * not this server), so "I'm done" is a report about work this process did not witness. Enqueueing on
 * it means the failure surfaces minutes later, inside the worker, as an error a golfer cannot act
 * on. `completeCapture` does one `exists` against the store and turns that into an immediate,
 * readable refusal instead — the same rule the worker's own done-callback follows in the other
 * direction.
 *
 * Owner only, and idempotent in the way that matters: a second call re-verifies and enqueues again,
 * which is the retry path for an analysis that failed, not a duplicate-upload hazard — the key is
 * derived per view, so there is only ever one object to find.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireViewAccess(id, viewParam(req));
  if ("error" in access) return access.error;
  if (access.userId !== access.ownerId) {
    return Response.json(
      { error: "only the swing's owner can complete its upload" },
      { status: 403, headers: noStore },
    );
  }

  let contentType = "";
  // Defaults to analysing: only an explicit `false` skips it, so a client that has never heard
  // of video-only sessions cannot accidentally store a swing nobody will ever measure.
  let analyze = true;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    contentType = typeof body?.contentType === "string" ? body.contentType : "";
    if (body?.analyze === false) analyze = false;
  } catch {
    return Response.json({ error: "expected a JSON body" }, { status: 400, headers: noStore });
  }

  try {
    const job = await withUser(access.userId, (tx) =>
      completeCapture(tx, access.userId, ownedView(access), contentType, analyze));
    // No job is a real answer, not an omission — `{ status: "idle" }` is the contract's own word
    // for "no run has ever been started for this view", which is exactly true of a video-only
    // swing. The client reads the same shape it polls with and needs no extra branch.
    return Response.json(job ?? { status: "idle" }, { headers: noStore });
  } catch (err) {
    // A refusal is an answer, not a server fault: the object is missing, the type is unsupported,
    // or the queue is refusing this user's fourth concurrent job. All four read the same to a
    // client — a 400 carrying a sentence it can show.
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400, headers: noStore },
    );
  }
}
