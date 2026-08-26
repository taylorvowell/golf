import { useEffect } from "react";

import { useAuth } from "../auth/AuthProvider";
import { setAppMode, useAppMode } from "./appMode";
import { clearRolesCache, useInstructorEligible, useRoles } from "./useRoles";

/**
 * The mode's two invariants, enforced in one place (architecture §4):
 *
 *   * **Sign-out resets to personal** and clears the roles cache, so the next identity is
 *     never read — or dressed — as the last one.
 *   * **Losing eligibility exits instructor mode.** A suspended or role-less account left in
 *     instructor mode would render a shell whose every surface it may not use; falling back to
 *     personal is graceful degradation, data intact (§7a's suspension semantics).
 *
 * Deliberately NOT "signed-out implies personal render" — the auth gate above the navigator
 * already swaps to sign-in; this guard only keeps the *stored* mode truthful for next launch.
 *
 * Mounted inside `AuthGate` (it needs `useAuth`), which is below `ThemeProvider` — fine,
 * because the mode store is module-level, not a context this component provides.
 */
export function ModeGuard() {
  const { session } = useAuth();
  const mode = useAppMode();
  const roles = useRoles();
  const eligible = useInstructorEligible();

  const signedIn = session != null;
  useEffect(() => {
    if (!signedIn) {
      clearRolesCache();
      setAppMode("personal");
    }
  }, [signedIn]);

  useEffect(() => {
    // Only a POSITIVE answer demotes: while roles are loading or unreachable, an instructor
    // who reopened the app offline must not be dumped out of their own mode.
    if (mode === "instructor" && roles.kind === "ok" && !eligible) setAppMode("personal");
  }, [mode, roles.kind, eligible]);

  return null;
}
