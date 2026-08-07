"use client";

import { useEffect, useRef, useState } from "react";

/**
 * `useState` that survives a refresh or a navigation, backed by localStorage.
 *
 * Deliberately GLOBAL, not per swing: these are comparison controls. Picking a tracking
 * test and a path fit and then flipping through swings to judge them is the whole
 * workflow — resetting the selection on every navigation would defeat it.
 *
 * Hydration: the first render always uses `fallback`, and the stored value is adopted in
 * an effect. Reading localStorage during render would make the client's first paint
 * disagree with the server-rendered HTML, which React treats as a hydration error. The
 * one-frame flash costs nothing here — the canvas draws after the video loads anyway.
 *
 * `sanitize` decides what a stored value is worth: return the value to adopt, or null to
 * keep the fallback. It both rejects selections that no longer apply (a club solution
 * this swing lacks, a test id since removed) and REPAIRS ones that partially apply — the
 * overlay toggle set gains keys as overlays are added, and an older stored set has to
 * merge over the current defaults rather than silently render the new toggles as off.
 */
export function usePersistentState<T>(
  key: string,
  fallback: T,
  sanitize?: (parsed: unknown, fallback: T) => T | null,
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = useState<T>(fallback);
  const loaded = useRef(false);
  // Keep the newest sanitizer without making it a dependency: callers pass inline
  // closures over props, so a dep would re-run the load effect on every render and
  // stomp the user's selection back to whatever is stored. The refs are seeded at mount
  // (which is all the load effect below needs) and synced in an effect afterwards —
  // writing a ref during render is not allowed.
  const sanitizeRef = useRef(sanitize);
  const fallbackRef = useRef(fallback);
  useEffect(() => {
    sanitizeRef.current = sanitize;
    fallbackRef.current = fallback;
  });

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) {
        const parsed: unknown = JSON.parse(raw);
        const next = sanitizeRef.current
          ? sanitizeRef.current(parsed, fallbackRef.current)
          : (parsed as T);
        if (next !== null) setValue(next);
      }
    } catch {
      /* unreadable or unparseable storage is simply no stored value */
    }
    loaded.current = true;
  }, [key]);

  useEffect(() => {
    // Never write before the load effect has run, or the fallback would immediately
    // overwrite the stored value on mount.
    if (!loaded.current) return;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* private mode / quota — persistence is a convenience, not a requirement */
    }
  }, [key, value]);

  return [value, setValue];
}

/** One namespace so the keys are greppable and clearable together. */
export const persistKey = (name: string) => `swingsage:${name}`;
