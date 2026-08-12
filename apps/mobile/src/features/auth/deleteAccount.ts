import type { AccountDeletion } from "@swingsage/schema/contract";

import { api } from "../../platform/client";
import { supabase } from "./supabase";

/**
 * §4.3 — delete this account, then end the session on this device.
 *
 * The sign-out afterwards is not tidying up. The access token stays cryptographically valid until
 * it expires, so without it the app keeps rendering a signed-in shell whose every request 401s,
 * and the golfer's last impression of deleting their account is an app that appears broken. It is
 * `scope: "local"` for the same reason every other sign-out here is (§4.2): the identity itself is
 * already gone server-side, so a global call would only be a request that cannot succeed.
 *
 * Sign-out failures are swallowed deliberately — the account is deleted at that point, and
 * surfacing "sign out failed" would say the opposite of what happened.
 */
export async function deleteAccount(): Promise<AccountDeletion> {
  const result = await api.request<AccountDeletion>("account", { method: "DELETE" });
  try {
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    // Nothing to recover: the session it refers to no longer exists on the server.
  }
  return result;
}

/**
 * What deletion removes, in the golfer's words.
 *
 * §34 requires that a user understands what deletion removes BEFORE it happens, so this list is
 * shown on the confirmation screen and is deliberately concrete — "your data" is not informed
 * consent. It mirrors the cascade documented in `apps/web/src/lib/account/deleteAccount.ts`; the
 * two are meant to be read against each other, and a change to one without the other is the bug.
 */
export const DELETION_CONSEQUENCES = [
  "Every swing video you have uploaded, and every analysis of it",
  "Your scores, findings, markers and practice history",
  "Your equipment bag, sessions and goals",
  "Any coach's access to your swings, immediately",
  "Your sign-in — this email will no longer have a SwingSage account",
] as const;
