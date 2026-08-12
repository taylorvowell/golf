import { useCallback, useEffect, useState } from "react";
import type { Analysis } from "@swingsage/schema/contract";

import { ApiClientError } from "../../platform/api";
import { api } from "../../platform/client";

/**
 * The swing's `analysis.json`, fetched once and held for as long as the player is on screen.
 *
 * A **discriminated union, not a bag of booleans**, matching `useSwings` — and the state that
 * earns it here is `not-analysed`. A 404 from this route means the artifact does not exist, which
 * is a real and permanent condition for a swing that failed analysis or has not been analysed yet.
 * It is **not an error**, and the difference is load-bearing: the video must still play, the
 * transport must still work, and the overlay must simply be absent. Collapsing the two would show
 * "something went wrong" over a swing that is fine.
 *
 * `unreachable` is kept separate for the same reason one level down: the network failing is
 * temporary and worth retrying, a missing artifact is neither.
 */

export type AnalysisState =
  | { kind: "loading" }
  | { kind: "ok"; analysis: Analysis }
  | { kind: "not-analysed" }
  | { kind: "unreachable" };

export interface AnalysisHook {
  state: AnalysisState;
  reload: () => void;
}

/**
 * @param swingId the swing to fetch, or undefined to fetch nothing.
 * @param view    a view **TYPE** (`dtl` / `face_on`), never a view id — the route answers a uuid
 *                with 400 rather than falling back, the same trap that made every swing refuse to
 *                play in step 01. Omitted takes the swing's primary view.
 */
export function useAnalysis(swingId: string | undefined, view?: string | null): AnalysisHook {
  const [state, setState] = useState<AnalysisState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!swingId) {
      setState({ kind: "not-analysed" });
      return;
    }
    let live = true;
    setState({ kind: "loading" });

    const path = view
      ? `swings/${swingId}/analysis?view=${encodeURIComponent(view)}`
      : `swings/${swingId}/analysis`;

    void api
      .request<Analysis>(path)
      .then((analysis) => {
        if (live) setState({ kind: "ok", analysis });
      })
      .catch((err: unknown) => {
        if (!live) return;
        const status = err instanceof ApiClientError ? err.status : 0;
        // 400 lands here too, and it belongs with 404: an unrecognised view is a swing this client
        // cannot draw an overlay for, not a transient failure to retry.
        setState({ kind: status === 404 || status === 400 ? "not-analysed" : "unreachable" });
      });

    return () => {
      live = false;
    };
  }, [swingId, view, attempt]);

  return { state, reload: useCallback(() => setAttempt((n) => n + 1), []) };
}
