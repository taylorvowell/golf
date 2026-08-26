import { useMemo } from "react";

import { useDebugGroups } from "../debug/DebugOverlay";
import { setAppMode, useAppMode } from "./appMode";

/**
 * Instructor-mode's debug control, registered app-wide next to the overlay: a direct mode
 * flip, so the two shells can be compared without hunting the header dropdown. There is NO
 * role force-flag (Taylor, 2026-08-26): the debug personas are real accounts, so becoming an
 * instructor on a dev device is switching to the instructor persona — eligibility always
 * flows from the signed-in identity, and `ModeGuard` demotes a flip the identity cannot hold.
 * Renders nothing; `DebugProvider` no-ops in release.
 */
export function ModeDebug() {
  const mode = useAppMode();

  const groups = useMemo(
    () => [
      {
        title: "Mode",
        toggles: [
          {
            key: "instructor-mode",
            label: "Instructor mode",
            detail:
              "Flips the shell directly — same as the header dropdown. Device-local, personal after sign-out; an ineligible identity is demoted back by ModeGuard.",
            value: mode === "instructor",
            onChange: (next: boolean) => setAppMode(next ? "instructor" : "personal"),
          },
        ],
      },
    ],
    [mode],
  );
  useDebugGroups("mode", groups);
  return null;
}
