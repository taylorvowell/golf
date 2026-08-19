import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Whether the guided stance analysis is still highlighted on home. **Only the card's dismiss
 * button hides it** (Taylor, 2026-08-19: "do NOT hide until the user hits a dismiss button on
 * the card") — walking the analysis deliberately does NOT count, so the card keeps offering
 * the walkthrough until the golfer explicitly waves it away.
 *
 * Device-local, deliberately (the `useStarred` shape): the intro is a first-run moment, and a
 * reinstall reintroducing it is correct, not a bug.
 */

const STORAGE_KEY = "swingsage.stance-intro-dismissed.v1";

let dismissed: boolean | null = null;
let loading: Promise<boolean> | null = null;
const listeners = new Set<() => void>();

async function ensureLoaded(): Promise<boolean> {
  if (dismissed !== null) return dismissed;
  loading ??= AsyncStorage.getItem(STORAGE_KEY)
    .then((raw) => raw === "true")
    // A corrupt store shows the card again — the harmless direction.
    .catch(() => false);
  dismissed = await loading;
  return dismissed;
}

/** The card's X — the ONLY thing that hides the highlight. */
export function dismissStanceIntro(): void {
  dismissed = true;
  void AsyncStorage.setItem(STORAGE_KEY, "true").catch(() => undefined);
  for (const listener of listeners) listener();
}

/** Debug-menu action: bring the card back (the dismissed state is otherwise one-way). */
export function resetStanceIntro(): void {
  dismissed = false;
  void AsyncStorage.removeItem(STORAGE_KEY).catch(() => undefined);
  for (const listener of listeners) listener();
}

/** The tests' reset seam. */
export function clearStanceIntroCache(): void {
  dismissed = null;
  loading = null;
}

/** True while the home highlight should show. Answers false until the store has loaded, so
 *  the card appears once the answer is known rather than flashing and vanishing. */
export function useStanceIntro(): boolean {
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
