import { useMemo } from "react";

import { useDebugGroups } from "../../debug/DebugOverlay";
import { setInstructorMockState, useInstructorMockState } from "./mockState";
import type { ListingLifecycle } from "./types";

/**
 * The mocked instructor surface's forceable states (the standing debug rule), registered
 * app-wide: relationship/thread states, the listing lifecycle, the empty roster, and the
 * slots-full focus refusal — every state §4a names, one tap each, no second account needed.
 * Renders nothing; `DebugProvider` no-ops in release.
 */

const LIFECYCLES: ListingLifecycle[] = ["draft", "pending", "listed", "rejected", "suspended"];
const THREAD_STATES = ["active", "frozen", "blocked"] as const;

export function InstructorMockDebug() {
  const state = useInstructorMockState();

  const groups = useMemo(
    () => [
      {
        title: "Instructor mock",
        inline: true,
        toggles: [
          {
            key: "roster-empty",
            label: "Empty roster",
            detail:
              "Forces the no-students-yet state on Students and an all-caught-up Home. Session-only.",
            value: state.rosterEmpty,
            onChange: (next: boolean) => setInstructorMockState({ rosterEmpty: next }),
          },
          {
            key: "focus-slots-full",
            label: "Focus slots full",
            detail:
              "Student detail shows all 3 focus slots taken — the §16.3.2 refusal instead of the assign door.",
            value: state.focusSlotsFull,
            onChange: (next: boolean) => setInstructorMockState({ focusSlotsFull: next }),
          },
        ],
        actions: [
          ...THREAD_STATES.map((threadState) => ({
            key: `thread-${threadState}`,
            label:
              state.threadState === threadState ? `● Thread: ${threadState}` : `Thread: ${threadState}`,
            detail:
              "Forces the FIRST conversation's state — frozen is a relationship that ended (read-only), blocked hides history behind its state line.",
            onPress: () => setInstructorMockState({ threadState }),
          })),
          ...LIFECYCLES.map((lifecycle) => ({
            key: `listing-${lifecycle}`,
            label:
              state.listingLifecycle === lifecycle ? `● Listing: ${lifecycle}` : `Listing: ${lifecycle}`,
            detail: "Forces the directory listing's §31.5 lifecycle state on the editor.",
            onPress: () => setInstructorMockState({ listingLifecycle: lifecycle }),
          })),
        ],
      },
    ],
    [state],
  );
  useDebugGroups("instructor-mock", groups);
  return null;
}
