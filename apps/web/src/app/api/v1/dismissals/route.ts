import type { DismissalSaveRequest } from "@swingsage/schema/contract";

import { requireUserIdOrNull } from "@/lib/auth";
import { withUser } from "@/db/session";
import { clearDismissals, listDismissals, saveDismissal } from "@/lib/dismissals";

/**
 * The generic dismissal store: `{ keys }` out, one key in. Nothing here knows what a
 * spotlight is — the key namespace (`spotlight.multiview.v1`) is the client's vocabulary,
 * and a new dismissable surface must be a new key, never a new route.
 */
export async function GET() {
  const userId = await requireUserIdOrNull();
  if (!userId) return new Response("unauthorized", { status: 401 });
  const body = await withUser(userId, (tx) => listDismissals(tx, userId));
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}

/**
 * Record one dismissal. Idempotent end to end — the client replays queued keys after being
 * offline, and two devices race on the same key, so "already dismissed" is a success.
 */
export async function POST(req: Request) {
  const userId = await requireUserIdOrNull();
  if (!userId) return new Response("unauthorized", { status: 401 });

  let body: DismissalSaveRequest;
  try {
    body = (await req.json()) as DismissalSaveRequest;
  } catch {
    return Response.json(
      { error: "invalid_json", message: "Body must be JSON." },
      { status: 400 },
    );
  }

  // Shape-checked here so a malformed key is a 400 about the request, not a Postgres check
  // violation surfacing as a 500 about our internals. Mirrors the column's own 1–200 bound.
  const key = typeof body.key === "string" ? body.key.trim() : "";
  if (key.length === 0 || key.length > 200) {
    return Response.json(
      { error: "invalid_key", message: "Provide the dismissal key (1–200 chars)." },
      { status: 400 },
    );
  }

  const result = await withUser(userId, (tx) => saveDismissal(tx, userId, key));
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}

/**
 * The debug-menu reset — forget every dismissal so dismissed cards come back. Dev tooling,
 * not product (the product never un-dismisses; a reworked card is a new key), so production
 * refuses it outright: the row policies make it safe, this gate makes it not-a-feature.
 */
export async function DELETE() {
  if (process.env.NODE_ENV === "production") {
    return new Response("not found", { status: 404 });
  }
  const userId = await requireUserIdOrNull();
  if (!userId) return new Response("unauthorized", { status: 401 });
  const result = await withUser(userId, (tx) => clearDismissals(tx, userId));
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
