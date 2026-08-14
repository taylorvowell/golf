import { useCallback, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Whether the after-swing screen leads with the stats slide-up or with the video —
 * **device-local, like the star**, and the same one seam to rewire when the contract grows
 * account preferences (an additive change, D41): screens only ever see `{ statsFirst, set }`.
 *
 * `statsFirst` is `null` until the stored value has been read. That state is load-bearing for
 * the after-swing screen: acting on a default before the read lands would flash the wrong
 * opening (a sheet that immediately vanishes, or a video the sheet then covers), so the screen
 * waits the few milliseconds and decides once.
 */

const STORAGE_KEY = "swingsage.after-swing-stats-first.v1";
/** Stats first — the summary slides up after a swing unless the golfer has said otherwise. */
const DEFAULT = true;

let cached: boolean | null = null;
let loading: Promise<boolean> | null = null;
const listeners = new Set<() => void>();

async function ensureLoaded(): Promise<boolean> {
  if (cached !== null) return cached;
  loading ??= AsyncStorage.getItem(STORAGE_KEY)
    .then((raw) => (raw === null ? DEFAULT : raw === "true"))
    // A corrupt store must not wedge the screen — fall back to the default and move on.
    .catch(() => DEFAULT);
  cached = await loading;
  return cached;
}

/** The tests' reset seam. */
export function clearSummaryPreferenceCache(): void {
  cached = null;
  loading = null;
}

export function useSummaryPreference(): {
  statsFirst: boolean | null;
  set: (value: boolean) => void;
} {
  const [value, setValue] = useState<boolean | null>(cached);

  useEffect(() => {
    let live = true;
    const update = () => {
      if (live) setValue(cached);
    };
    listeners.add(update);
    void ensureLoaded().then(update);
    return () => {
      live = false;
      listeners.delete(update);
    };
  }, []);

  const set = useCallback((next: boolean) => {
    cached = next;
    // Fire and forget — the in-memory value is already what every screen reads.
    void AsyncStorage.setItem(STORAGE_KEY, String(next)).catch(() => undefined);
    for (const listener of listeners) listener();
  }, []);

  return { statsFirst: value, set };
}
