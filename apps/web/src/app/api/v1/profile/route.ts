import { requireUserIdOrNull } from "@/lib/auth";
import { ProfileError, readProfile, updateProfile, type ProfilePatch } from "@/lib/account/profile";

/**
 * `GET /api/v1/profile` — §5, the caller's own profile.
 * `PATCH /api/v1/profile` — partial update, including the onboarding answers.
 *
 * **No id in the path, on either verb.** The only profile these routes can touch is the one that
 * authenticated the request — the same property that makes `DELETE /api/v1/account` safe. A
 * golfer reading an instructor's client's profile is a real feature (§26) and it belongs on a
 * instructor-scoped route where the relationship can be named and checked, not here behind a query
 * parameter.
 *
 * PATCH and not PUT: onboarding submits a few answers at a time and the profile screen edits one
 * field, so "send the whole object" would make every client responsible for not clobbering a
 * field it does not render — which is how a screen written before a field existed erases it.
 */
export async function GET() {
  const userId = await requireUserIdOrNull();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json(await readProfile(userId), { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(req: Request) {
  const userId = await requireUserIdOrNull();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

  let body: ProfilePatch;
  try {
    body = (await req.json()) as ProfilePatch;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  try {
    return Response.json(await updateProfile(userId, body), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    // A rejected VALUE is the caller's problem and says which value; anything else is ours.
    if (err instanceof ProfileError) {
      return Response.json({ error: err.code, message: err.message }, { status: 400 });
    }
    console.error("[profile] update failed", err);
    return Response.json({ error: "update_failed" }, { status: 500 });
  }
}
