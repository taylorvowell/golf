import { withUser } from "@/db/session";
import { listSwings } from "@/lib/swings";
import { requireUserIdOrNull } from "@/lib/auth";
import { isViewType } from "@/db/views";
import { createCapture, isAcceptedContentType } from "@/lib/ingest";

const noStore = { "Cache-Control": "no-store" };

/** the architecture spec API surface: GET /api/v1/swings?filters... — the caller's log, from Postgres. */
export async function GET() {
  const userId = await requireUserIdOrNull();
  // 401, never a redirect: a fetch cannot do anything useful with sign-in HTML.
  if (!userId) return new Response("unauthorized", { status: 401 });
  const swings = await withUser(userId, (tx) => listSwings(tx, userId));
  return Response.json({ swings }, { headers: { "Cache-Control": "no-store" } });
}

/**
 * Phase one of ingest: create the swing + view for a clip about to be uploaded, and answer with
 * where to send the bytes.
 *
 * Deliberately NOT an upload endpoint. The response names a target the client sends the file to
 * directly — Supabase Storage when it is the driver, this server's own route when it is not — so a
 * phone video never passes through a serverless function that could not accept it anyway. See
 * `lib/ingest.ts` for why the two phases are split.
 *
 * `view` and `handedness` are stated by the client because it is the only party that knows them:
 * the capture screen's toggle and the golfer's profile. Everything else about placement — the
 * storage key, the stem, the revision — is derived server-side from ids, so no request body can
 * influence where an object lands.
 */
export async function POST(req: Request) {
  const userId = await requireUserIdOrNull();
  if (!userId) return new Response("unauthorized", { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "expected a JSON body" }, { status: 400, headers: noStore });
  }
  const b = (body ?? {}) as Record<string, unknown>;

  const view = typeof b.view === "string" ? b.view : "";
  if (!isViewType(view)) {
    return Response.json({ error: "view must be 'dtl' or 'face_on'" }, { status: 400, headers: noStore });
  }
  const handedness = b.handedness;
  if (handedness !== "right" && handedness !== "left") {
    return Response.json(
      { error: "handedness must be 'right' or 'left' — it decides every lead/trail metric" },
      { status: 400, headers: noStore },
    );
  }
  const contentType = typeof b.contentType === "string" ? b.contentType : "";
  if (!isAcceptedContentType(contentType)) {
    return Response.json(
      { error: "contentType must be video/mp4 or video/quicktime" },
      { status: 400, headers: noStore },
    );
  }

  const created = await withUser(userId, (tx) =>
    createCapture(tx, userId, {
      view,
      handedness,
      sessionId: typeof b.sessionId === "string" ? b.sessionId : null,
      club: typeof b.club === "string" ? b.club : null,
      contentType,
    }));

  return Response.json(created, { status: 201, headers: noStore });
}
