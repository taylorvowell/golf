import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Which face of the app this DEVICE is wearing: the golfer's, or the instructor's.
 *
 * Three properties pin the design (the instructor-platform architecture §4, accepted
 * 2026-08-26), and each forbids a tempting alternative:
 *
 *   * **Mode is presentation, not authorization.** The `instructor` role row and RLS decide
 *     what an account may DO; mode only decides which shell renders. Switching calls no API,
 *     so there is nothing here to secure and nothing a stale mode can leak.
 *   * **Mode is device-local.** Two signed-in devices may sit in different modes — a phone in
 *     the teaching bay in instructor mode, a tablet at home in personal. Syncing it would
 *     invent a distributed-state problem with no payoff.
 *   * **Personal is the default, always.** A fresh install, a sign-out, or losing the role all
 *     land on personal — the golfer face is the product; instructor mode is entered on purpose.
 *
 * Module-level store with the house load-once idiom (`useInstructorFlag` / `useThemePreference`)
 * rather than a context provider, because `ThemeProvider` — very near the root — must read it,
 * and a provider above the theme would exist only to hold one string.
 */

export type AppMode = "personal" | "instructor";

const STORAGE_KEY = "swingsage.app-mode.v1";

let mode: AppMode | null = null;
let loading: Promise<AppMode> | null = null;
const listeners = new Set<() => void>();

function parse(raw: string | null): AppMode {
  return raw === "instructor" ? "instructor" : "personal";
}

async function ensureLoaded(): Promise<AppMode> {
  if (mode !== null) return mode;
  loading ??= AsyncStorage.getItem(STORAGE_KEY)
    .then(parse)
    // A corrupt store must not wedge the shell — personal is always safe.
    .catch(() => "personal" as const);
  const loaded = await loading;
  // A `setAppMode` that raced the read wins: the stored value is a default, never an override —
  // without this guard, flipping the mode during the first frames is silently undone.
  if (mode === null) mode = loaded;
  return mode;
}

export function setAppMode(next: AppMode): void {
  mode = next;
  // Fire and forget: memory is already what the shell reads.
  void AsyncStorage.setItem(STORAGE_KEY, next).catch(() => undefined);
  for (const listener of listeners) listener();
}

/** The tests' reset seam. */
export function clearAppModeCache(): void {
  mode = null;
  loading = null;
}

/**
 * The current mode, live. Defaults to `personal` until the stored value loads — a one-frame
 * personal flash for an instructor beats a mechanism that blocks the first paint for everyone.
 */
export function useAppMode(): AppMode {
  const [value, setValue] = useState<AppMode>(() => mode ?? "personal");
  useEffect(() => {
    let live = true;
    const update = () => {
      if (live) setValue(mode ?? "personal");
    };
    listeners.add(update);
    void ensureLoaded().then(update);
    return () => {
      live = false;
      listeners.delete(update);
    };
  }, []);
  return value;
}
