import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Whether this golfer has a connected **instructor** (the human professional — "Coach" is
 * the AI, see `docs/decisions/mobile-client.md`), and who that is.
 *
 * One store drives every instructor surface — the bubble on the Coach tab, the profile
 * drawer's instructor block, and the placeholder Instructor pages — so a flag flipped in one
 * place can never leave the surfaces disagreeing about whether an instructor exists.
 *
 * There is no instructor platform yet, so in release this always answers `null` and the app
 * shows the find-an-instructor state everywhere. Under `__DEV__` the flag is a debug toggle
 * (DebugOverlay → "Instructor"), persisted across reloads so a design pass survives a refresh;
 * when the relationship becomes real this module reads it instead and nothing above changes.
 */

export interface Instructor {
  name: string;
  /** Two letters over the face disc until instructor photos exist. */
  initials: string;
  blurb: string;
  /** Unread messages/new items — drives the bubble's notification dot. Stub until chat exists. */
  unread: number;
}

const SAMPLE: Instructor = {
  name: "Michael Kent, PGA",
  initials: "MK",
  blurb: "Connected instructor with lesson notes, in-app feedback, and local session support.",
  unread: 2,
};

const STORAGE_KEY = "swingsage.debug-instructor.v1";

/** Null until the first read finishes — mirrors `useStarred`'s load-once shape. */
let flag: boolean | null = null;
let loading: Promise<boolean> | null = null;
const listeners = new Set<() => void>();

async function ensureLoaded(): Promise<boolean> {
  if (flag !== null) return flag;
  loading ??= AsyncStorage.getItem(STORAGE_KEY)
    .then((raw) => raw === "true")
    // A corrupt store must not wedge the toggle — start disconnected and move on.
    .catch(() => false);
  flag = await loading;
  return flag;
}

export function setInstructorFlag(next: boolean): void {
  flag = next;
  // Fire and forget: memory is already the truth every surface reads.
  void AsyncStorage.setItem(STORAGE_KEY, String(next)).catch(() => undefined);
  for (const listener of listeners) listener();
}

/** The tests' reset seam. */
export function clearInstructorCache(): void {
  flag = null;
  loading = null;
}

/** The raw flag, for the debug toggle's own state. */
export function useInstructorFlag(): boolean {
  const [on, setOn] = useState(() => flag ?? false);
  useEffect(() => {
    let live = true;
    const update = () => {
      if (live) setOn(flag ?? false);
    };
    listeners.add(update);
    void ensureLoaded().then(update);
    return () => {
      live = false;
      listeners.delete(update);
    };
  }, []);
  return on;
}

/** The connected instructor, or null. Release builds have no instructor until the platform lands. */
export function useInstructor(): Instructor | null {
  const on = useInstructorFlag();
  return __DEV__ && on ? SAMPLE : null;
}
