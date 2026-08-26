import { useEffect, useState } from "react";
import type { RolesResponse } from "@swingsage/schema/contract";

import { api } from "../../platform/client";

/**
 * The account's roles, read from `GET /api/v1/roles` — the first client to actually consume
 * the roles API the platform built. One question is asked of it today: **may this account see
 * the instructor mode switcher** (`instructorEligible`). Everything the instructor may then DO
 * is still the server's RLS — this read gates chrome, never data (architecture §4: mode is
 * presentation, not authorization).
 *
 * There is deliberately NO dev force-flag (Taylor, 2026-08-26): the debug personas are real
 * seeded accounts, so the instructor persona (Dave Kim) IS the way to be an instructor on a
 * dev device — eligibility always comes from the signed-in identity, exactly as in release.
 *
 * Module-level cache, one fetch per session: roles change on the order of onboarding events,
 * not screens. `clearRolesCache()` runs on sign-out (ModeGuard) so the next identity is never
 * read through the last one's answer.
 */

type RolesState =
  | { kind: "loading" }
  | { kind: "ok"; roles: readonly string[] }
  | { kind: "unreachable" };

let state: RolesState = { kind: "loading" };
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

async function fetchRoles(): Promise<void> {
  try {
    const response = await api.request<RolesResponse>("roles");
    // Typed at the read site, never trusted: a mocked or malformed body without `roles`
    // must read as "no roles", not crash every header that renders the switcher.
    state = { kind: "ok", roles: Array.isArray(response?.roles) ? response.roles : [] };
  } catch {
    // Unreachable ≠ no roles: the switcher simply stays hidden until a fetch lands, and the
    // next mount retries. Never cache the failure as an answer.
    state = { kind: "unreachable" };
    inflight = null;
  }
  notify();
}

export function clearRolesCache(): void {
  state = { kind: "loading" };
  inflight = null;
  notify();
}

export function useRoles(): RolesState {
  const [value, setValue] = useState<RolesState>(state);
  useEffect(() => {
    let live = true;
    const update = () => {
      if (live) setValue(state);
    };
    listeners.add(update);
    if (state.kind !== "ok") inflight ??= fetchRoles();
    return () => {
      live = false;
      listeners.delete(update);
    };
  }, []);
  return value;
}

/** The one question the switcher asks. True when the account holds the instructor role. */
export function useInstructorEligible(): boolean {
  const roles = useRoles();
  return roles.kind === "ok" && roles.roles.includes("instructor");
}
