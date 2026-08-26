import { sql } from "drizzle-orm";
import { withUser } from "@/db/session";
import { requireUserIdOrNull } from "@/lib/auth";
import { requireRole } from "@/lib/roles";

/**
 * `GET /api/v1/instructor/roster` — the golfers who have approved this instructor. §24, §26.
 *
 * The first ROLE-GATED route in the product, and it is here rather than in
 * `instructor-relationships` because a role model with nothing gated by it is a role model nobody
 * has proved. §3.4 and §31 make capability depend on role, and a check that has never refused
 * anybody is a check that has never run.
 *
 * D32 makes the empty answer the normal one: claiming `instructor` is free and instant and hands
 * over a workspace with an empty roster. So `[]` is success, not "not set up yet" — the 403 is
 * reserved for an account that has not claimed the role at all.
 *
 * The relationship is still enforced in the DATABASE, not by the role check:
 * `instructor_links_select` and `users_select_self` are what stop an instructor seeing a golfer
 * who has not approved them. The role gate answers "may this account use the instructor surface",
 * never "whose data may it see" — conflating the two is how a role check ends up standing in for
 * an access-control boundary.
 */
export async function GET() {
  const userId = await requireUserIdOrNull();
  const gate = await requireRole(userId, "instructor");
  if ("error" in gate) return gate.error;

  const rows = await withUser(gate.userId, (tx) =>
    tx.execute<{ id: string; display_name: string; avatar_url: string | null; since: string }>(sql`
      select u.id, u.display_name, u.avatar_url, il.updated_at::text as since
        from public.instructor_links il
        join public.users u on u.id = il.golfer_id
       where il.instructor_id = ${gate.userId}
         and il.status = 'approved'
       order by u.display_name
    `));

  return Response.json(
    {
      // Only the PUBLIC half of a golfer's profile. An instructor reads the private half through
      // the golfer's own routes, where the approved link is the thing being checked.
      golfers: rows.map((r) => ({
        id: r.id,
        displayName: r.display_name,
        avatarUrl: r.avatar_url,
        since: r.since,
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
