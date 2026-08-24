import { useCallback, useEffect, useRef, useState } from "react";
import type { SwingDeletion, SwingListResponse, SwingSummary } from "@swingsage/schema/contract";

import { ApiClientError } from "../../platform/api";
import { api } from "../../platform/client";
import { reportUpgradeRequired, upgradeDetailOf } from "../../platform/VersionGate";
import { supabase } from "../auth/supabase";
import { setOrphanCleanup } from "./pendingImports";
import { clearAnalysisCache } from "../player/useAnalysis";
import { clearPendingImports } from "./pendingImports";
import { dropSessionFromCache } from "./useSessions";

/**
 * The golfer's swing log.
 *
 * The state is a **discriminated union, not a bag of booleans**, and that is load-bearing rather
 * than stylistic. `{ loading, error, data }` permits states that cannot happen and — worse —
 * permits the one that must never be rendered: an empty `data` alongside an unacknowledged
 * `error`, which draws "no swings yet" at a golfer whose swings are fine and whose phone merely
 * lost signal. That reads as data loss to the only person who would know the difference.
 *
 * `signed-out` is separated from `unreachable` for the same reason at one level down: a 401 means
 * the server answered and declined, anything else means it never answered at all, and only one of
 * those is fixed by signing in again.
 */

export type SwingsState =
  | { kind: "loading" }
  | { kind: "ok"; swings: SwingSummary[] }
  | { kind: "signed-out" }
  | { kind: "unreachable" };

export interface SwingsHook {
  state: SwingsState;
  /** True during a pull-to-refresh — a re-fetch that must NOT blank the list already on screen. */
  refreshing: boolean;
  refresh: () => void;
}

/**
 * The last list the server confirmed, shared by every mount of this hook.
 *
 * This is what lets the detail screen open a swing WITHOUT paying a serial round trip first: the
 * log fetched the list moments ago, the tap that navigated here happened on a row of it, and the
 * label/fps/frameCount/aspect the player needs are all in that response. Each mount still
 * revalidates in the background (stale-while-revalidate) — the cache decides what draws first,
 * never what is true. Cleared on 401 and on sign-out, because a cached list outliving its
 * session is a leak across the auth boundary.
 */
let lastGood: SwingSummary[] | null = null;

/** The auth-boundary hook and the tests' reset seam — never a per-screen convenience. */
export function clearSwingsCache(): void {
  lastGood = null;
}

/**
 * Mounted hooks, so a cache write made OUTSIDE the fetch path (deletion, below) reaches screens
 * that are already drawn. Without this, deleting a swing from the player and going back lands on
 * a log still showing it — the log screen stays mounted under the stack and never refetches.
 */
const cacheListeners = new Set<() => void>();
function notifyCacheChanged(): void {
  for (const listener of cacheListeners) listener();
}

/**
 * Delete one swing — the server removes the rows and the media, then the cached list drops it.
 *
 * The cache is updated from the confirmed response, never optimistically: a delete that failed
 * on the wire but vanished from the log would read as done, and the swing's reappearance on the
 * next refresh as a bug. Throws on failure so the caller can say so.
 */
export async function deleteSwing(id: string): Promise<void> {
  const result = await api.request<SwingDeletion>(`swings/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (lastGood) {
    lastGood = lastGood.filter((s) => s.id !== id);
    notifyCacheChanged();
  }
  // Emptying a session deletes it, server-side — the id comes back so the cached log drops the
  // row rather than drawing a session with nothing in it (Taylor, 2026-08-22). There is no
  // session delete of its own; this is the only way one goes.
  if (result.sessionDeleted) dropSessionFromCache(result.sessionDeleted);
}

/**
 * Re-fetch the list from outside a mounted screen — what the capture pipeline calls the moment an
 * analysis finishes.
 *
 * The confirmed response updates the shared cache and every mounted log re-reads it, so the swing
 * that was analysing on the post-swing screen becomes the real, artifact-backed swing without
 * anything optimistic being written. A failure is silent on purpose: the caller is a background
 * pipeline, and a toast about a refresh is not something a golfer can act on.
 */
export async function refreshSwings(): Promise<void> {
  try {
    const body = await api.request<SwingListResponse>("swings");
    lastGood = body.swings;
    notifyCacheChanged();
  } catch {
    // Keep whatever was confirmed before.
  }
}

// Registered once at module scope — the same pattern supabase.ts uses for its AppState hook.
// SIGNED_OUT fires on explicit sign-out and between two different users' sessions, which is
// exactly when a seeded list would otherwise draw one golfer's swings for another.
supabase.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT") {
    clearSwingsCache();
    // An import in flight belongs to the account that started it — a placeholder row surviving
    // a sign-out would draw one golfer's incoming swing on another's log.
    clearPendingImports();
    // And their artifacts — whole-clip keypoints are the most personal payload the app holds.
    clearAnalysisCache();
  }
});

/**
 * Wire the import pipeline's orphan cleanup to the real deletion.
 *
 * An upload that never landed leaves a swing row with no video — ingest mints the row before the
 * bytes move. That is not something to leave in a golfer's log, and the pipeline's failure
 * callback has nobody to hand a deleter to, so the wiring is made once here at module scope
 * rather than by whichever screen happened to be mounted.
 */
setOrphanCleanup((swingId) => {
  void deleteSwing(swingId).catch(() => {});
});

export function useSwings(): SwingsHook {
  const [state, setState] = useState<SwingsState>(() =>
    lastGood ? { kind: "ok", swings: lastGood } : { kind: "loading" },
  );
  const [refreshing, setRefreshing] = useState(false);

  /** The mount's lifetime, for the fetch that outlives it. Aborting stops the body download and
   *  the JSON parse — a `live` flag alone only discards the result after paying for it. */
  const abortRef = useRef<AbortController | null>(null);
  const liveRef = useRef(true);

  const load = useCallback(async (isRefresh: boolean) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    if (isRefresh) setRefreshing(true);
    // A seeded mount revalidates silently: blanking a drawn list to say "loading" about data the
    // screen already has is the flash the refreshing flag exists to prevent.
    else if (!lastGood) setState({ kind: "loading" });
    try {
      const body = await api.request<SwingListResponse>("swings", { signal: controller.signal });
      lastGood = body.swings;
      if (liveRef.current) setState({ kind: "ok", swings: body.swings });
    } catch (err) {
      if (!liveRef.current || controller.signal.aborted) return;
      // A 426 is not "unreachable" — it is the server refusing this build, and it must render as
      // the upgrade screen, not as a network problem the golfer will retry forever.
      if (err instanceof ApiClientError && err.isUpgradeRequired) {
        reportUpgradeRequired(upgradeDetailOf(err));
        return;
      }
      const declined = err instanceof ApiClientError && err.status === 401;
      if (declined) {
        lastGood = null;
        setState({ kind: "signed-out" });
      } else if (!lastGood) {
        // With a confirmed list on hand, a failed revalidate keeps drawing it — stale beats a
        // network-error screen about data the device demonstrably has. Without one, be honest.
        setState({ kind: "unreachable" });
      }
    } finally {
      if (liveRef.current && isRefresh) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    liveRef.current = true;
    // Deletion edits the module cache directly; every mounted log re-reads it here. Only an `ok`
    // write — a null cache means "nothing confirmed", which is not the same claim as "no swings".
    const onCacheChanged = () => {
      if (liveRef.current && lastGood) setState({ kind: "ok", swings: lastGood });
    };
    cacheListeners.add(onCacheChanged);
    void load(false);
    return () => {
      liveRef.current = false;
      cacheListeners.delete(onCacheChanged);
      abortRef.current?.abort();
    };
  }, [load]);

  return {
    state,
    refreshing,
    refresh: useCallback(() => void load(true), [load]),
  };
}

/**
 * One swing, by id — the detail screen's data.
 *
 * Deliberately re-fetches the list rather than calling a per-swing endpoint, because **there is no
 * per-swing endpoint** and inventing one here would be a server change smuggled into a client
 * step. At ten swings the cost is nothing; when the log is long enough for that to matter, the fix
 * is `GET /api/v1/swings/:id` on the contract, which is an additive change (D41) rather than a
 * rewrite of this hook. The module cache above already makes this instant for any swing reached
 * from the log.
 */
export function useSwing(id: string | undefined): { state: SwingsState; swing: SwingSummary | null } {
  const { state } = useSwings();
  const swing =
    state.kind === "ok" && id ? (state.swings.find((s) => s.id === id) ?? null) : null;
  return { state, swing };
}
