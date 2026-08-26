import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { RolesResponse } from "@swingsage/schema/contract";

import { api } from "../../platform/client";

/**
 * The account's roles, read from `GET /api/v1/roles` — the first client to actually consume
 * the roles API the platform built. One question is asked of it today: **may this account see
 * the instructor mode switcher** (`instructorEligible`). Everything the instructor may then DO
 * is still the server's RLS — this read gates chrome, never data (architecture §4: mode is
 * presentation, not authorization).
 *
 * Module-level cache, one fetch per session: roles change on the order of onboarding events,
 * not screens. `clearRolesCache()` runs on sign-out (ModeGuard) so the next identity is never
 * read through the last one's answer.
 *
 * The DEV force-flag lets Taylor walk instructor mode on a persona whose account holds no
 * role row — a debug toggle, `__DEV__`-gated at the read so release cannot carry it.
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

// ---- the DEV force flag ---------------------------------------------------------------------

const FORCE_KEY = "swingsage.debug-force-instructor-role.v1";

let forced: boolean | null = null;
let forcedLoading: Promise<boolean> | null = null;

async function ensureForcedLoaded(): Promise<boolean> {
  if (forced !== null) return forced;
  forcedLoading ??= AsyncStorage.getItem(FORCE_KEY)
    .then((raw) => raw === "true")
    .catch(() => false);
  const loaded = await forcedLoading;
  // Same race guard as `appMode`: a toggle during the read wins over the stored value.
  if (forced === null) forced = loaded;
  return forced;
}

export function setForceInstructorRole(next: boolean): void {
  forced = next;
  void AsyncStorage.setItem(FORCE_KEY, String(next)).catch(() => undefined);
  notify();
}

/** The raw flag, for the debug toggle's own state. */
export function useForceInstructorRole(): boolean {
  const [on, setOn] = useState(() => forced ?? false);
  useEffect(() => {
    let live = true;
    const update = () => {
      if (live) setOn(forced ?? false);
    };
    listeners.add(update);
    void ensureForcedLoaded().then(update);
    return () => {
      live = false;
      listeners.delete(update);
    };
  }, []);
  return on;
}

/**
 * The one question the switcher asks. True when the account holds the `instructor` role —
 * or, under `__DEV__` only, when the debug force flag is on.
 */
export function useInstructorEligible(): boolean {
  const roles = useRoles();
  const forcedOn = useForceInstructorRole();
  if (__DEV__ && forcedOn) return true;
  return roles.kind === "ok" && roles.roles.includes("instructor");
}
