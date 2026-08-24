import { useEffect, useMemo, useState } from "react";

import { useDebugGroups } from "../debug/DebugOverlay";

/**
 * The coach surface's forceable states (the react-native.md rule): the dismissed home
 * highlight is otherwise one-way, and the stance walkthrough's pose-art fallback is otherwise
 * unreachable on an account that has analysed swings. Registered app-wide next to the overlay
 * in `App.tsx` — renders nothing; `DebugProvider` no-ops in release.
 */

let forcePoseArt = false;
const listeners = new Set<() => void>();

function setForcePoseArt(next: boolean): void {
  forcePoseArt = next;
  for (const listener of listeners) listener();
}

/** Dev-only: makes the stance walkthrough ignore the golfer's photo and show the fallback. */
export function useForcePoseArt(): boolean {
  const [on, setOn] = useState(forcePoseArt);
  useEffect(() => {
    const update = () => setOn(forcePoseArt);
    listeners.add(update);
    return () => {
      listeners.delete(update);
    };
  }, []);
  return __DEV__ && on;
}

export function CoachDebug() {
  const poseArt = useForcePoseArt();
  const groups = useMemo(
    () => [
      {
        title: "Coach",
        inline: true,
        toggles: [
          {
            key: "stance-pose-art",
            label: "Stance: pose art",
            detail:
              "Force the stance walkthrough onto the pose-art fallback (what a golfer with no analysed swing sees). Not persisted.",
            value: poseArt,
            onChange: setForcePoseArt,
          },
        ],
        /* The intro cards moved into the spotlight deck (spotlights track) — their reset is
           the SpotlightRail's "Reset dismissals" action now. */
      },
    ],
    [poseArt],
  );
  useDebugGroups("coach", groups);
  return null;
}
