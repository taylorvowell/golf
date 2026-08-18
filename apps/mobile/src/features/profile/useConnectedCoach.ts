/**
 * The golfer's connected coach, for the profile drawer.
 *
 * There is no coach platform yet — no relationship table, no directory, no messaging — so in a
 * release build this is always `null` and the drawer shows the directory card alone. Under
 * `__DEV__` it answers with a sample so the connected state can actually be seen and skinned
 * while it is being designed; the moment the relationship is real this hook reads it and the
 * `__DEV__` branch goes, with nothing above it changing.
 */

export interface ConnectedCoach {
  name: string;
  /** Two letters over the disc when the coach has no photo. */
  initials: string;
  blurb: string;
}

const SAMPLE: ConnectedCoach = {
  name: "Michael Kent, PGA",
  initials: "MK",
  blurb: "Connected coach with lesson notes, in-app feedback, and local session support.",
};

export function useConnectedCoach(): ConnectedCoach | null {
  return __DEV__ ? SAMPLE : null;
}
