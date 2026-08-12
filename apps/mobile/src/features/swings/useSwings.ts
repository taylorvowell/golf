import { useCallback, useEffect, useState } from "react";
import type { SwingListResponse, SwingSummary } from "@swingsage/schema/contract";

import { ApiClientError } from "../../platform/api";
import { api } from "../../platform/client";

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

export function useSwings(): SwingsHook {
  const [state, setState] = useState<SwingsState>({ kind: "loading" });
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh: boolean) => {
    if (isRefresh) setRefreshing(true);
    else setState({ kind: "loading" });
    try {
      const body = await api.request<SwingListResponse>("swings");
      setState({ kind: "ok", swings: body.swings });
    } catch (err) {
      const declined = err instanceof ApiClientError && err.status === 401;
      setState({ kind: declined ? "signed-out" : "unreachable" });
    } finally {
      if (isRefresh) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
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
 * rewrite of this hook.
 */
export function useSwing(id: string | undefined): { state: SwingsState; swing: SwingSummary | null } {
  const { state } = useSwings();
  const swing =
    state.kind === "ok" && id ? (state.swings.find((s) => s.id === id) ?? null) : null;
  return { state, swing };
}
