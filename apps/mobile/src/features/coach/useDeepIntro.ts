import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * The deep-swing-analysis home highlight — the second card of the homepage pair (deep on
 * top of posture, Taylor 2026-08-19). Same contract as `useStanceIntro`: only the card's X
 * dismisses it, walking the analysis leaves it up, device-local on purpose.
 */

const STORAGE_KEY = "swingsage.deep-intro-dismissed.v1";

let dismissed: boolean | null = null;
let loading: Promise<boolean> | null = null;
const listeners = new Set<() => void>();

async function ensureLoaded(): Promise<boolean> {
  if (dismissed !== null) return dismissed;
  loading ??= AsyncStorage.getItem(STORAGE_KEY)
    .then((raw) => raw === "true")
    .catch(() => false);
  dismissed = await loading;
  return dismissed;
}

export function dismissDeepIntro(): void {
  dismissed = true;
  void AsyncStorage.setItem(STORAGE_KEY, "true").catch(() => undefined);
  for (const listener of listeners) listener();
}

/** Debug-menu action — the dismissed state is otherwise one-way. */
export function resetDeepIntro(): void {
  dismissed = false;
  void AsyncStorage.removeItem(STORAGE_KEY).catch(() => undefined);
  for (const listener of listeners) listener();
}

/** The tests' reset seam. */
export function clearDeepIntroCache(): void {
  dismissed = null;
  loading = null;
}

export function useDeepIntro(): boolean {
  const [show, setShow] = useState(() => dismissed === false);
  useEffect(() => {
    let live = true;
    const update = () => {
      if (live) setShow(dismissed === false);
    };
    listeners.add(update);
    void ensureLoaded().then(update);
    return () => {
      live = false;
      listeners.delete(update);
    };
  }, []);
  return show;
}
