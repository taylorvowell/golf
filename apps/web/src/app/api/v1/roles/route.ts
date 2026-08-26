import { requireUserIdOrNull } from "@/lib/auth";
import { CLAIMABLE_ROLES, claimRole, isClaimableRole, rolesOf } from "@/lib/roles";

/**
 * `GET /api/v1/roles` — which roles the caller holds, and which they may claim.
 * `POST /api/v1/roles` — claim one. §4.4, D32.
 *
 * The claim is free and instant by design: an instructor exploring the product gets the workspace with
 * an empty roster, and the friction lands where it belongs — being LISTED in the directory is a
 * reviewed application (`instructor-relationships`/`admin-surface`), not this route.
 *
 * `claimable` is in the response so a client never has to hardcode the rule. `admin` is not in it
 * and cannot be claimed here or anywhere on a request path; `app.claim_role` refuses it in the
 * database, so this route being wrong would still not be an escalation.
 */
export async function GET() {
  const userId = await requireUserIdOrNull();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json(
    { roles: await rolesOf(userId), claimable: CLAIMABLE_ROLES },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(req: Request) {
  const userId = await requireUserIdOrNull();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

  let body: { role?: unknown };
  try {
    body = (await req.json()) as { role?: unknown };
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const role = body?.role;
  if (typeof role !== "string" || !isClaimableRole(role)) {
    return Response.json(
      {
        error: "role_not_claimable",
        message: `claimable roles are: ${CLAIMABLE_ROLES.join(", ")}`,
      },
      { status: 400 },
    );
  }

  // Idempotent — a golfer tapping "I'm an instructor" twice is not an error, and the database says so
  // with `on conflict do nothing` rather than this route checking first and racing itself.
  await claimRole(userId, role);
  return Response.json({ roles: await rolesOf(userId) }, { headers: { "Cache-Control": "no-store" } });
}
