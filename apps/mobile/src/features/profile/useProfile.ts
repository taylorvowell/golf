import { useCallback, useEffect, useRef, useState } from "react";
import type {
  GolferProfilePrivate,
  ProfilePatchRequest,
  ProfileResponse,
} from "@swingsage/schema/contract";

import { ApiClientError } from "../../platform/api";
import { api } from "../../platform/client";
import { reportUpgradeRequired, upgradeDetailOf } from "../../platform/VersionGate";
import { supabase } from "../auth/supabase";

/**
 * The golfer's own profile (§5) — one store shared by onboarding, My profile and Goals, on the
 * `useSwings` pattern: a module cache seeded from the last confirmed response, discriminated
 * union state, stale-while-revalidate on mount, cleared at the auth boundary.
 *
 * Writes go through `saveProfile`, which applies the patch to the cache FIRST and reconciles
 * with what the server confirms. Optimistic on purpose where `useSwings`' delete is not: a
 * profile answer is the golfer's own statement about themselves, so drawing it immediately can
 * never show them something false — and a picker that waits a network round trip to look chosen
 * reads as broken. A failed save reverts the cache and rethrows so the caller can say so.
 */

export type ProfileState =
  | { kind: "loading" }
  | { kind: "ok"; profile: ProfileResponse }
  | { kind: "signed-out" }
  | { kind: "unreachable" };

let lastGood: ProfileResponse | null = null;
const listeners = new Set<() => void>();

function notifyChanged(): void {
  for (const l of listeners) l();
}

/** The auth-boundary reset and the tests' seam. */
export function clearProfileCache(): void {
  lastGood = null;
}

supabase.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT") clearProfileCache();
});

/** The last confirmed profile, if any mount has loaded one — for non-React callers. */
export function cachedProfile(): ProfileResponse | null {
  return lastGood;
}

/**
 * Apply a patch locally so the UI answers the tap now, without waiting for the wire.
 * Only the halves the patch names change; the server's confirmation replaces this wholesale.
 */
function applyLocally(base: ProfileResponse, patch: ProfilePatchRequest): ProfileResponse {
  return {
    public: { ...base.public, ...(patch.public ?? {}) },
    private: {
      ...base.private,
      ...(patch.private ?? {}),
      ...(patch.completeOnboarding
        ? { onboardingCompletedAt: new Date().toISOString() }
        : {}),
    },
  };
}

/**
 * PATCH the profile. Optimistic against the cache, reconciled from the response, reverted on
 * failure. Throws so the calling surface can tell the golfer the save did not land.
 */
export async function saveProfile(patch: ProfilePatchRequest): Promise<ProfileResponse> {
  const before = lastGood;
  if (before) {
    lastGood = applyLocally(before, patch);
    notifyChanged();
  }
  try {
    const confirmed = await api.request<ProfileResponse>("profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    lastGood = confirmed;
    notifyChanged();
    return confirmed;
  } catch (err) {
    lastGood = before;
    notifyChanged();
    throw err;
  }
}

export interface ProfileHook {
  state: ProfileState;
  refresh: () => void;
}

export function useProfile(): ProfileHook {
  const [state, setState] = useState<ProfileState>(() =>
    lastGood ? { kind: "ok", profile: lastGood } : { kind: "loading" },
  );
  const abortRef = useRef<AbortController | null>(null);
  const liveRef = useRef(true);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    if (!lastGood) setState({ kind: "loading" });
    try {
      const body = await api.request<ProfileResponse>("profile", { signal: controller.signal });
      lastGood = body;
      notifyChanged();
      if (liveRef.current) setState({ kind: "ok", profile: body });
    } catch (err) {
      if (!liveRef.current || controller.signal.aborted) return;
      if (err instanceof ApiClientError && err.isUpgradeRequired) {
        reportUpgradeRequired(upgradeDetailOf(err));
        return;
      }
      if (err instanceof ApiClientError && err.status === 401) {
        lastGood = null;
        setState({ kind: "signed-out" });
      } else if (!lastGood) {
        setState({ kind: "unreachable" });
      }
    }
  }, []);

  useEffect(() => {
    liveRef.current = true;
    const onChanged = () => {
      if (liveRef.current && lastGood) setState({ kind: "ok", profile: lastGood });
    };
    listeners.add(onChanged);
    void load();
    return () => {
      liveRef.current = false;
      listeners.delete(onChanged);
      abortRef.current?.abort();
    };
  }, [load]);

  return { state, refresh: useCallback(() => void load(), [load]) };
}

/** The private half, or null while nothing is confirmed — most editors want exactly this. */
export function useProfilePrivate(): GolferProfilePrivate | null {
  const { state } = useProfile();
  return state.kind === "ok" ? state.profile.private : null;
}

/**
 * The golfer's handedness for every surface that mirrors — capture overlays, control rails,
 * lead/trail copy. Defaults to right until the profile answers: the mirror must never flicker
 * left on a right-handed golfer while a fetch is in flight, and right-handed is the observed
 * default of every existing fixture.
 */
export function useHandedness(): "right" | "left" {
  const priv = useProfilePrivate();
  return priv?.handedness === "left" ? "left" : "right";
}
