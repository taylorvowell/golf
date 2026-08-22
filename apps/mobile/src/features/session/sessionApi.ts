import type {
  SessionCreateRequest,
  SessionPatchRequest,
  SessionResponse,
  SessionSummary,
} from "@swingsage/schema/contract";

import { api } from "../../platform/client";
import type { SessionType } from "./sessionState";

/**
 * Session mode's two writes: mint the session, and rename it.
 *
 * A session row is created on the FIRST recorded swing, never on entering session mode (D61) —
 * a golfer who opens the camera and walks away leaves nothing behind. So the name and type live
 * in the reducer until the first Save, and this module is what turns them into a row.
 *
 * `name` is sent only when the golfer actually renamed the session. The app's own "Session 4" is
 * a number it counted, and storing it would make every session look named to the swing log,
 * which keeps its date title precisely when the name is null.
 */

export async function createSession(input: {
  name: string | null;
  sessionType: SessionType;
  /** The phone's calendar day — the server has no idea what timezone the golfer is in. */
  date: string;
}): Promise<SessionSummary> {
  const body: SessionCreateRequest = {
    name: input.name,
    sessionType: input.sessionType,
    date: input.date,
  };
  const { session } = await api.request<SessionResponse>("sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return session;
}

export async function renameSession(
  sessionId: string,
  name: string | null,
): Promise<SessionSummary> {
  const body: SessionPatchRequest = { name };
  const { session } = await api.request<SessionResponse>(
    `sessions/${encodeURIComponent(sessionId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  return session;
}

/** `YYYY-MM-DD` in the phone's own timezone — never `toISOString`, which is UTC. */
export function calendarDate(when: Date): string {
  const month = `${when.getMonth() + 1}`.padStart(2, "0");
  const day = `${when.getDate()}`.padStart(2, "0");
  return `${when.getFullYear()}-${month}-${day}`;
}
