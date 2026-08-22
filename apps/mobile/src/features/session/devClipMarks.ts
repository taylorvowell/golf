import AsyncStorage from "@react-native-async-storage/async-storage";

import type { CaptureView } from "./sessionState";

/**
 * What a developer has already learned about each pre-recorded clip — which ones have been
 * tried, which ones turned out good enough to keep, and which angle each was filmed from.
 *
 * Persisted because the whole point of a triage drawer is that it survives: a list of twenty
 * clips that forgets which four you already rejected sends you through them all again on the
 * next reload. Device-local (`sessionDefaults`' pattern), `__DEV__` only, and never uploaded.
 *
 * **Keyed by file NAME, not by path.** A clip can sit in either of the two scanned folders and
 * may be moved between them; the name is what stays the same, and losing a triage verdict
 * because a file was re-pushed somewhere else is the one failure this file exists to prevent.
 */

const STORAGE_KEY = "swingsage.devClipMarks.v1";

export type DevClipStatus = "new" | "tried" | "saved";

export interface DevClipMark {
  status: DevClipStatus;
  /** The angle it was filmed from — the swing is stamped with this when the clip is injected. */
  view: CaptureView;
}

export type DevClipMarks = Record<string, DevClipMark>;

/**
 * The angle a file name implies, before anyone says otherwise.
 *
 * A guess, deliberately: down-the-line is the overwhelming default (every fixture in the
 * project is DTL), so only an explicit hint flips it, and the drawer lets the guess be
 * overridden per clip. Getting this wrong stamps the swing with the wrong view, which inverts
 * every angle the analyzer reads — so it is offered as a visible, editable tag rather than
 * quietly decided.
 */
export function viewFromName(name: string): CaptureView {
  return /front|face[-_ ]?on|faceon|\bfo\b/i.test(name) ? "face_on" : "dtl";
}

export function markFor(marks: DevClipMarks, name: string): DevClipMark {
  return marks[name] ?? { status: "new", view: viewFromName(name) };
}

function isStatus(v: unknown): v is DevClipStatus {
  return v === "new" || v === "tried" || v === "saved";
}

function isView(v: unknown): v is CaptureView {
  return v === "dtl" || v === "face_on";
}

export async function loadDevClipMarks(): Promise<DevClipMarks> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw == null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const out: DevClipMarks = {};
    // Field-by-field, so one malformed entry written by an older build cannot poison the
    // whole drawer — the clip just reads as new.
    for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value !== "object" || value === null) continue;
      const v = value as Record<string, unknown>;
      out[name] = {
        status: isStatus(v.status) ? v.status : "new",
        view: isView(v.view) ? v.view : viewFromName(name),
      };
    }
    return out;
  } catch {
    return {};
  }
}

export async function saveDevClipMarks(marks: DevClipMarks): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(marks));
  } catch {
    // Best-effort: a failed write costs a verdict, never a session.
  }
}
