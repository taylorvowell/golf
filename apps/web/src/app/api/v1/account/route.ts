import { deleteAccount } from "@/lib/account/deleteAccount";
import { requireUserIdOrNull } from "@/lib/auth";

/**
 * `DELETE /api/v1/account` — §4.3. Erase the caller's account and everything in it.
 *
 * **There is no id in the path or the body, and that is the security property.** Deletion is the
 * one operation where a mistaken target cannot be undone, so the target is not expressible: the
 * only account this route can delete is the one that authenticated the request, resolved
 * server-side and passed straight through to `app.delete_own_account()`, which reads `auth.uid()`
 * itself and ignores anything a caller could have said.
 *
 * Confirmation lives in the client, not here. A "are you sure" flag on the wire is theatre — it
 * is set by the same code that made the call — and the real protection is that the request needs
 * a valid session, which a stray link or a CSRF attempt does not carry (this app authenticates
 * native clients by `Authorization: Bearer`, and a browser session by a `SameSite` cookie).
 */
export async function DELETE() {
  const userId = await requireUserIdOrNull();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

  try {
    const result = await deleteAccount(userId);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    // Reported, never swallowed. A partial deletion the golfer believes succeeded is worse than a
    // visible failure they can retry — and every step of the cascade is ordered to be retryable
    // for exactly this case (see lib/account/deleteAccount.ts).
    console.error("[account] deletion failed", err);
    return Response.json(
      {
        error: "deletion_failed",
        message:
          "Your account was not fully deleted. Nothing has been partially removed that a retry " +
          "cannot finish — please try again.",
      },
      { status: 500 },
    );
  }
}
