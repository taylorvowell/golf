import { useMemo } from "react";

import { useDebugGroups } from "../debug/DebugOverlay";
import { setAppMode, useAppMode } from "./appMode";
import { setForceInstructorRole, useForceInstructorRole } from "./useRoles";

/**
 * Instructor-mode's debug controls, registered app-wide next to the overlay (the standing
 * forceable-states rule): the role force-flag — so instructor mode is walkable on a persona
 * whose account holds no role row — and a mode flip, so the shells can be compared without
 * hunting the header dropdown. Renders nothing; `DebugProvider` no-ops in release.
 */
export function ModeDebug() {
  const forced = useForceInstructorRole();
  const mode = useAppMode();

  const groups = useMemo(
    () => [
      {
        title: "Mode",
        toggles: [
          {
            key: "force-instructor-role",
            label: "Force instructor role",
            detail:
              "Makes this device instructor-eligible without a role row — the header dropdown appears and instructor mode opens. Remembered across reloads.",
            value: forced,
            onChange: setForceInstructorRole,
          },
          {
            key: "instructor-mode",
            label: "Instructor mode",
            detail:
              "Flips the shell directly — same as the header dropdown. Device-local, personal after sign-out.",
            value: mode === "instructor",
            onChange: (next: boolean) => setAppMode(next ? "instructor" : "personal"),
          },
        ],
      },
    ],
    [forced, mode],
  );
  useDebugGroups("mode", groups);
  return null;
}
