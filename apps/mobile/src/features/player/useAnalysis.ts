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
/**
 * Artifacts already fetched this session, keyed by the request path.
 *
 * The artifact is immutable between re-analyses, and the player's own contract is that a stored
 * `analysis.json` does not change until something re-runs the analyzer — so serving a cached one
 * is not staleness, it is the same truth without the multi-MB refetch. What the cache buys is the
 * swing page's sideways swipe: without it every swipe re-downloaded and re-parsed the whole
 * artifact, and the overlay, the phase blocks and the corner orbs all arrived seconds late and
 * POPPED in over a video already playing (Taylor, 2026-08-22 — the chrome half of the swipe
 * flicker).
 *
 * Bounded hard: these are the largest objects the app holds (whole-clip keypoints), so at
 * `ANALYSIS_CACHE_MAX` the oldest entry goes. `reload()` bypasses and rewrites the entry, which
 * is what the re-analysis flow calls.
 */
const analysisCache = new Map<string, Analysis>();
const ANALYSIS_CACHE_MAX = 6;

function rememberAnalysis(path: string, analysis: Analysis): void {
  if (analysisCache.size >= ANALYSIS_CACHE_MAX && !analysisCache.has(path)) {
    const oldest = analysisCache.keys().next().value;
    if (oldest !== undefined) analysisCache.delete(oldest);
  }
  analysisCache.set(path, analysis);
}

/** Sign-out and the tests' reset seam — one golfer's artifacts must not outlive their session. */
export function clearAnalysisCache(): void {
  analysisCache.clear();
}

function analysisPath(swingId: string, view?: string | null): string {
  return view
    ? `swings/${swingId}/analysis?view=${encodeURIComponent(view)}`
    : `swings/${swingId}/analysis`;
}

export function useAnalysis(swingId: string | undefined, view?: string | null): AnalysisHook {
  const [state, setState] = useState<AnalysisState>(() => {
    const cached = swingId ? analysisCache.get(analysisPath(swingId, view)) : undefined;
    return cached ? { kind: "ok", analysis: cached } : { kind: "loading" };
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!swingId) {
      setState({ kind: "not-analysed" });
      return;
    }
    // Cached and not an explicit reload: serve it and fetch nothing. `attempt > 0` is the
    // reload() path — re-analysis just rewrote the artifact, so the cache must be bypassed.
    const cached = analysisCache.get(analysisPath(swingId, view));
    if (cached && attempt === 0) {
      setState({ kind: "ok", analysis: cached });
      return;
    }
    let live = true;
    // Aborted on unmount, not merely ignored: this route serves the whole-clip artifact — the
    // largest payload the app moves — and a `live` flag alone lets a popped screen keep streaming
    // it and then JSON-parse all of it on the JS thread, right through the pop transition.
    const controller = new AbortController();
    setState({ kind: "loading" });

    const path = analysisPath(swingId, view);

    void api
      /**
       * The artifact is the largest payload the app moves (whole-clip keypoints, several MB),
       * and the default 12s timeout has been measured LOSING to it on the LAN dev server —
       * the same fetch marginally succeeds or fails per screen, which reads as "the overlay
       * sometimes doesn't work". 30s is the per-call override the client documents for
       * anything genuinely slow; a production host answers in a fraction of either number.
       */
      .request<Analysis>(path, { signal: controller.signal }, 30_000)
      .then((analysis) => {
        rememberAnalysis(path, analysis);
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
      controller.abort();
    };
  }, [swingId, view, attempt]);

  return { state, reload: useCallback(() => setAttempt((n) => n + 1), []) };
}
