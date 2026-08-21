import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * App-level preferences — the Settings screen's toggles, as opposed to per-session settings
 * (`sessionDefaults.ts`) which the session sheet owns. Device-local until an account-level
 * settings surface exists, mirroring the session-defaults decision.
 *
 * A module-level cache with subscribers keeps every mounted reader in sync: the Settings
 * switch and the capture screen see the same value in the same frame, and the async load
 * only ever runs once. Loading merges field-by-field over the defaults so an older stored
 * shape degrades to the shipped defaults instead of feeding `undefined` into a Switch.
 */

const STORAGE_KEY = "swingsage.appPrefs.v1";

export interface AppPrefs {
  /** Audible cue when recording starts and stops — the system camera's own sounds. */
  recordSounds: boolean;
  /** The countdown's 3-2-1 ticks. Only meaningful while `recordSounds` is on — the gate. */
  countdownTicks: boolean;
}

export const DEFAULT_APP_PREFS: AppPrefs = {
  recordSounds: true,
  countdownTicks: true,
};

let cache: AppPrefs = DEFAULT_APP_PREFS;
let loaded = false;
const listeners = new Set<() => void>();

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

async function loadOnce(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw == null) return;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return;
    const p = parsed as Record<string, unknown>;
    cache = {
      recordSounds: bool(p.recordSounds, DEFAULT_APP_PREFS.recordSounds),
      countdownTicks: bool(p.countdownTicks, DEFAULT_APP_PREFS.countdownTicks),
    };
    listeners.forEach((l) => l());
  } catch {
    // Corrupt storage must never take Settings down; the defaults stand.
  }
}

/** Current prefs for imperative call sites (sound cues); hooks should use `useAppPrefs`. */
export function getAppPrefs(): AppPrefs {
  void loadOnce();
  return cache;
}

export function setAppPrefs(patch: Partial<AppPrefs>): void {
  cache = { ...cache, ...patch };
  listeners.forEach((l) => l());
  // Best-effort persistence — the in-memory value already applies everywhere.
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cache)).catch(() => undefined);
}

/** Current prefs plus a patch setter; re-renders on any change from any screen. */
export function useAppPrefs(): [AppPrefs, (patch: Partial<AppPrefs>) => void] {
  const [prefs, setPrefs] = useState(cache);
  useEffect(() => {
    const listener = () => setPrefs(cache);
    listeners.add(listener);
    void loadOnce();
    // The load may have finished between the render and this effect — sync once on mount.
    listener();
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return [prefs, setAppPrefs];
}
