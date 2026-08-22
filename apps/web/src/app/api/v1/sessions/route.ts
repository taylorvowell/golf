import type { SessionCreateRequest } from "@swingsage/schema/contract";

import { withUser } from "@/db/session";
import { requireUserIdOrNull } from "@/lib/auth";
import {
  createSession,
  isCalendarDate,
  isSessionType,
  listSessions,
  normalizeName,
} from "@/lib/sessions";

const noStore = { "Cache-Control": "no-store" };

/**
 * `GET  /api/v1/sessions` — the caller's practice sessions, newest first.
 * `POST /api/v1/sessions` — mint one.
 *
 * POST is called on the FIRST recorded swing of a session, never on opening the capture screen
 * (D61). A golfer who opens the camera, changes their mind and leaves has created nothing —
 * which is why the name and type live client-side until this call, and why an empty body is a
 * valid request: it means "today's unnamed analysis session", the default the capture screen
 * offers.
 */
export async function GET() {
  const userId = await requireUserIdOrNull();
  if (!userId) return new Response("unauthorized", { status: 401 });
  const sessions = await withUser(userId, (tx) => listSessions(tx, userId));
  return Response.json({ sessions }, { headers: noStore });
}

export async function POST(req: Request) {
  const userId = await requireUserIdOrNull();
  if (!userId) return new Response("unauthorized", { status: 401 });

  // An absent body is the common case, not an error — `req.json()` throws on empty.
  let body: SessionCreateRequest = {};
  try {
    body = ((await req.json()) ?? {}) as SessionCreateRequest;
  } catch {
    body = {};
  }
  if (typeof body !== "object" || body === null) {
    return Response.json({ error: "invalid_body" }, { status: 400, headers: noStore });
  }

  if (body.sessionType !== undefined && !isSessionType(body.sessionType)) {
    return Response.json(
      { error: "invalid_session_type", message: "sessionType must be one of the SessionType values" },
      { status: 400, headers: noStore },
    );
  }
  if (body.date !== undefined && !isCalendarDate(body.date)) {
    return Response.json(
      { error: "invalid_date", message: "date must be YYYY-MM-DD" },
      { status: 400, headers: noStore },
    );
  }

  const session = await withUser(userId, (tx) =>
    createSession(tx, userId, {
      name: normalizeName(body.name),
      sessionType: body.sessionType,
      date: body.date,
    }));

  return Response.json({ session }, { status: 201, headers: noStore });
}
