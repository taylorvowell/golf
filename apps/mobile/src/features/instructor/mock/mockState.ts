import { useEffect, useState } from "react";

import type { ListingLifecycle } from "./types";

/**
 * The mocked surface's FORCEABLE STATES (the standing debug rule: every state worth judging
 * gets a toggle). Session-only on purpose — these force *sample data* shapes for a design
 * walk, and a stale forced emptiness surviving a relaunch would read as a broken app.
 */

export interface InstructorMockState {
  rosterEmpty: boolean;
  /** Forces the FIRST conversation's state, so frozen/blocked are one tap away. */
  threadState: "active" | "frozen" | "blocked";
  listingLifecycle: ListingLifecycle;
  /** Forces the student detail's focus block to the slots-full refusal (§16.3.2). */
  focusSlotsFull: boolean;
}

let state: InstructorMockState = {
  rosterEmpty: false,
  threadState: "active",
  listingLifecycle: "listed",
  focusSlotsFull: false,
};

const listeners = new Set<() => void>();

export function setInstructorMockState(patch: Partial<InstructorMockState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

export function useInstructorMockState(): InstructorMockState {
  const [value, setValue] = useState(state);
  useEffect(() => {
    const update = () => setValue(state);
    listeners.add(update);
    return () => {
      listeners.delete(update);
    };
  }, []);
  return value;
}
