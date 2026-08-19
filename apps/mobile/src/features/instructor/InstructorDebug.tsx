import { useMemo } from "react";

import { useDebugGroups } from "../debug/DebugOverlay";
import { setInstructorFlag, useInstructorFlag } from "./useInstructor";

/**
 * The instructor flag's debug control, registered app-wide (mounted next to the overlay in
 * `App.tsx`) rather than from any one screen: the flag changes the Coach tab AND the profile
 * drawer, so the toggle must be reachable from both — "which screen registers it" is exactly
 * the question this placement removes. Renders nothing; `DebugProvider` no-ops in release.
 */
export function InstructorDebug() {
  const on = useInstructorFlag();
  const groups = useMemo(
    () => [
      {
        title: "Instructor",
        toggles: [
          {
            key: "has-instructor",
            label: "Has local instructor",
            detail:
              "Shows the instructor bubble on Coach and the connected card in the profile drawer. Remembered across reloads.",
            value: on,
            onChange: setInstructorFlag,
          },
        ],
      },
    ],
    [on],
  );
  useDebugGroups("instructor", groups);
  return null;
}
