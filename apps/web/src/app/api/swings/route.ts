import { listSwings } from "@/lib/swings";
import { requireUserIdOrNull } from "@/lib/auth";

/** the architecture spec API surface: GET /api/swings?filters... — the admin user's log, from Postgres. */
export async function GET() {
  const userId = await requireUserIdOrNull();
  // 401, never a redirect: a fetch cannot do anything useful with sign-in HTML.
  if (!userId) return new Response("unauthorized", { status: 401 });
  const swings = await listSwings(userId);
  return Response.json({ swings }, { headers: { "Cache-Control": "no-store" } });
}
