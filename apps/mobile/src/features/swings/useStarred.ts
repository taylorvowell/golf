import { useCallback, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Which swings this golfer has starred — **device-local, deliberately**.
 *
 * The contract has no `starred` field yet, so this persists on the phone alone and does not
 * pretend otherwise: a star set here survives an app restart but not a reinstall, and never
 * reaches another device. When the contract grows the field (an additive change, D41), this
 * module is the one seam to rewire — screens only ever see `{ starred, toggle }`.
 *
 * Storage is one JSON array under one key rather than a key per swing, because the natural
 * question is "which swings are starred", and answering it from per-swing keys means
 * `getAllKeys` over everything the app has ever stored.
 */

const STORAGE_KEY = "swingsage.starred-swings.v1";

/** The loaded set, shared by every mount. Null until the first read finishes. */
let starred: Set<string> | null = null;
let loading: Promise<Set<string>> | null = null;
const listeners = new Set<() => void>();

async function ensureLoaded(): Promise<Set<string>> {
  if (starred) return starred;
  loading ??= AsyncStorage.getItem(STORAGE_KEY)
    .then((raw) => {
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : []);
    })
    // A corrupt store must not make starring permanently impossible — start empty and move on.
    .catch(() => new Set<string>());
  starred = await loading;
  return starred;
}

function persist(set: Set<string>): void {
  // Fire and forget: the in-memory set is already the truth every screen reads, and a failed
  // write costs a star across a restart, not a wrong answer now.
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([...set])).catch(() => undefined);
}

/** The tests' reset seam. */
export function clearStarredCache(): void {
  starred = null;
  loading = null;
}

export function useStarred(swingId: string): { starred: boolean; toggle: () => void } {
  const [on, setOn] = useState(() => starred?.has(swingId) ?? false);

  useEffect(() => {
    let live = true;
    const update = () => {
      if (live) setOn(starred?.has(swingId) ?? false);
    };
    listeners.add(update);
    void ensureLoaded().then(update);
    return () => {
      live = false;
      listeners.delete(update);
    };
  }, [swingId]);

  const toggle = useCallback(() => {
    void ensureLoaded().then((set) => {
      if (set.has(swingId)) set.delete(swingId);
      else set.add(swingId);
      persist(set);
      for (const listener of listeners) listener();
    });
  }, [swingId]);

  return { starred: on, toggle };
}
