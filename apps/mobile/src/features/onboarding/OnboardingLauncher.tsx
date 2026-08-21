import { useEffect, useMemo } from "react";

import { navigationRef } from "../../navigation";
import { useDebugGroups } from "../debug/DebugOverlay";
import { useProfile } from "../profile/useProfile";

/**
 * Opens onboarding for the account that has not finished it — §4.4's "starts right after
 * signup", expressed as state rather than as a hook on the signup call: a golfer who signed up,
 * killed the app and came back still lands in it, because the check is "is onboarding
 * complete", never "did signup just happen".
 *
 * Auto-opens ONCE per app launch. Backing out of the flow mid-way must not slingshot the
 * golfer straight back in — the flow already saved every answer they gave, and the next cold
 * start re-offers the rest.
 *
 * Also the debug door: "Run onboarding" in the debug sheet opens the same flow any time, which
 * is how the sequence is walked on a profile that already finished it.
 */

let autoLaunchedThisSession = false;

/** The tests' reset seam. */
export function resetOnboardingAutoLaunch(): void {
  autoLaunchedThisSession = false;
}

export function OnboardingLauncher() {
  const { state } = useProfile();

  const incomplete =
    state.kind === "ok" && state.profile.private.onboardingCompletedAt == null;

  useEffect(() => {
    if (!incomplete || autoLaunchedThisSession) return;
    if (!navigationRef.isReady()) return;
    autoLaunchedThisSession = true;
    navigationRef.navigate("Onboarding");
  }, [incomplete]);

  useDebugGroups(
    "onboarding",
    useMemo(
      () => [
        {
          title: "Profile",
          inline: true,
          actions: [
            {
              key: "run-onboarding",
              label: "Run onboarding",
              detail:
                "Opens the signup question sequence — answers prefill from the profile and " +
                "every tap saves to it.",
              onPress: () => {
                if (navigationRef.isReady()) navigationRef.navigate("Onboarding");
              },
            },
          ],
        },
      ],
      [],
    ),
  );

  return null;
}
