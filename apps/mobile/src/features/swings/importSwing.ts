import * as ImagePicker from "expo-image-picker";
import type { SessionSummary } from "@swingsage/schema/contract";

import { api } from "../../platform/client";
import { calendarDate, createSession } from "../session/sessionApi";
import type { CaptureView } from "../session/sessionState";
import { startProcessing } from "../session/processing";
import { primeSession } from "./useSessions";

/**
 * Bringing a swing you already filmed into the log.
 *
 * **An import is a recording that happened somewhere else.** Past the picker it is the exact same
 * path a swing recorded in the app takes — `processing.ts` uploads it, ingest verifies it, the
 * analyzer runs, and the swing lands in the log with markers and a score. There is deliberately
 * no second ingest route and no "imported" flag: a swing is a swing, and a parallel path would be
 * a second place for every rule about handedness, sessions and quarantine to drift.
 *
 * The two things the app cannot see in a file are supplied rather than guessed: the **angle** is
 * asked for (the analyzer reads completely different geometry from down-the-line and face-on, and
 * getting it wrong does not fail — it silently measures the wrong thing), and **handedness**
 * comes from the profile, which is where every other lead/trail decision already comes from.
 */

/** What the picker handed back, narrowed to what ingest needs. */
export interface PickedClip {
  uri: string;
  fileName: string | null;
  durationMs: number | null;
  sizeBytes: number | null;
}

export type PickOutcome =
  | { kind: "picked"; clip: PickedClip }
  | { kind: "cancelled" }
  /** The golfer said no to the library, or the OS did. Actionable, so it is its own answer. */
  | { kind: "denied" }
  | { kind: "failed"; reason: string };

/**
 * Open the system video picker.
 *
 * Videos only. An images-and-videos picker would let a golfer choose a photo and meet the failure
 * two minutes later, inside the analyzer, as "we couldn't find a swing" — a refusal the picker can
 * make impossible instead of explaining.
 */
export async function pickSwingVideo(): Promise<PickOutcome> {
  try {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return { kind: "denied" };

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["videos"],
      allowsMultipleSelection: false,
      // No editing pass: the trim that matters is the analyzer's swing window, and a platform
      // crop would re-encode the clip to get there.
      allowsEditing: false,
    });
    if (result.canceled) return { kind: "cancelled" };

    const asset = result.assets[0];
    if (!asset) return { kind: "cancelled" };
    return {
      kind: "picked",
      clip: {
        uri: asset.uri,
        fileName: asset.fileName ?? null,
        durationMs: asset.duration ?? null,
        sizeBytes: asset.fileSize ?? null,
      },
    };
  } catch (err) {
    return { kind: "failed", reason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * The session an import lands in: **one per day**, shared by every clip imported that day.
 *
 * A golfer emptying a bucket's worth of clips out of their camera roll is describing one practice
 * session, and minting a session per file would turn an afternoon into fifteen sessions of one
 * swing each. The day is the day of the IMPORT, not of the recording — a video file does not
 * reliably carry when it was filmed, and dating a session from a guess would put a golfer's swings
 * on a day they were not at the range.
 *
 * Serialized through `inFlight` because the obvious failure here is two imports started seconds
 * apart each finding no session for today and each creating one.
 */
const inFlight = new Map<string, Promise<string>>();

export async function sessionForToday(existing: readonly SessionSummary[]): Promise<string> {
  const today = calendarDate(new Date());
  const already = existing.find((s) => s.date === today);
  if (already) return already.id;

  const pending = inFlight.get(today);
  if (pending) return pending;

  const created = (async () => {
    // Re-read the server's list rather than trusting the caller's snapshot: the cache may predate
    // a session minted by session mode minutes ago, and joining that one is the whole point.
    try {
      const { sessions } = await api.request<{ sessions: SessionSummary[] }>("sessions");
      const found = sessions.find((s) => s.date === today);
      if (found) {
        primeSession(found);
        return found.id;
      }
    } catch {
      // Unreachable: fall through and create one. A duplicate session is recoverable; refusing
      // the import is not.
    }
    const session = await createSession({ name: null, sessionType: "swing_analysis", date: today });
    primeSession(session);
    return session.id;
  })();

  inFlight.set(today, created);
  try {
    return await created;
  } finally {
    inFlight.delete(today);
  }
}

/** The id an imported clip's pipeline run is keyed by — unique per import, never a file path. */
let importCounter = 0;

/**
 * Push a picked clip through the same pipeline a recorded swing uses.
 *
 * Returns the local run id so the caller can watch it. Fire-and-forget by design: the golfer
 * carries on using the log while it uploads, and the run lives at module scope so leaving the
 * screen does not cancel it.
 */
export async function importSwing(input: {
  clip: PickedClip;
  view: CaptureView;
  handedness: "right" | "left";
  sessions: readonly SessionSummary[];
}): Promise<string> {
  const localId = `import-${++importCounter}-${input.clip.uri.slice(-24)}`;
  // The session is resolved BEFORE the run starts, so the swing is attached at creation rather
  // than adopted afterwards — a swing that briefly has no session would group by time and jump
  // rows in the log as soon as the session arrived.
  const sessionId = await sessionForToday(input.sessions);

  startProcessing(localId, {
    clip: {
      path: input.clip.uri,
      // Unknown and unknowable from a file the app did not record. Neither is read by ingest —
      // the analyzer probes the real rate off the clip itself — so stating a guess here would be
      // inventing a number nothing needs.
      fps: 0,
      durationMs: input.clip.durationMs ?? 0,
    },
    view: input.view,
    handedness: input.handedness,
    sessionId,
    analyze: true,
  });
  return localId;
}
