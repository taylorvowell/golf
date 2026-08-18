import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  DEFAULT_SESSION_SETTINGS,
  RECORDING_DELAYS,
  type RecordingDelay,
  type SessionSettings,
} from "./sessionState";

/**
 * The golfer's saved session defaults — the "Save as my defaults" checkbox in the session
 * settings sheet. Device-local (`useStarred`'s pattern) until an account-level settings
 * surface exists; the wiring step decides whether it ever needs to move.
 *
 * Loading merges over `DEFAULT_SESSION_SETTINGS` field-by-field so a stored shape from an
 * older build (missing a key, or carrying a retired one) degrades to the shipped defaults
 * instead of poisoning the sheet with `undefined`s.
 */

const STORAGE_KEY = "swingsage.sessionDefaults.v1";

function isDelay(v: unknown): v is RecordingDelay {
  return typeof v === "number" && (RECORDING_DELAYS as number[]).includes(v);
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

export async function loadSessionDefaults(): Promise<SessionSettings> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw == null) return DEFAULT_SESSION_SETTINGS;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_SESSION_SETTINGS;
    const p = parsed as Record<string, unknown>;
    const d = DEFAULT_SESSION_SETTINGS;
    return {
      delaySeconds: isDelay(p.delaySeconds) ? p.delaySeconds : d.delaySeconds,
      videoReplay: bool(p.videoReplay, d.videoReplay),
      autoEndRecording: bool(p.autoEndRecording, d.autoEndRecording),
      aiAnalysis: bool(p.aiAnalysis, d.aiAnalysis),
      aiCoachTips: bool(p.aiCoachTips, d.aiCoachTips),
      aiCoachVoice: bool(p.aiCoachVoice, d.aiCoachVoice),
    };
  } catch {
    // Corrupt storage must never block entering session mode.
    return DEFAULT_SESSION_SETTINGS;
  }
}

export async function saveSessionDefaults(settings: SessionSettings): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Persistence is best-effort; the in-session settings still apply.
  }
}
