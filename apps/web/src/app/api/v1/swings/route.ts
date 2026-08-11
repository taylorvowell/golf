import { withUser } from "@/db/session";
import { listSwings } from "@/lib/swings";
import { requireUserIdOrNull } from "@/lib/auth";

/** the architecture spec API surface: GET /api/v1/swings?filters... — the caller's log, from Postgres. */
export async function GET() {
  const userId = await requireUserIdOrNull();
  // 401, never a redirect: a fetch cannot do anything useful with sign-in HTML.
  if (!userId) return new Response("unauthorized", { status: 401 });
  const swings = await withUser(userId, (tx) => listSwings(tx, userId));
  return Response.json({ swings }, { headers: { "Cache-Control": "no-store" } });
}
