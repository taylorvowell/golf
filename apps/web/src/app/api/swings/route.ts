import { listSwings } from "@/lib/swings";
import { getCurrentUserId } from "@/lib/auth";

/** doc 02 API surface: GET /api/swings?filters... — the admin user's log, from Postgres. */
export async function GET() {
  const userId = await getCurrentUserId();
  const swings = await listSwings(userId);
  return Response.json({ swings }, { headers: { "Cache-Control": "no-store" } });
}
