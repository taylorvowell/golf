import { useEffect, useState } from "react";
import type { SyncProfile } from "@swingsage/schema/contract";

import { ApiClientError } from "../../platform/api";
import { api } from "../../platform/client";

/**
 * The two kilobytes needed to line another swing up against this one.
 *
 * ## Why this is not `useAnalysis`
 *
 * It was. Picking a swing to compare against fetched that swing's whole `analysis.json` — 5.9 MB
 * on `6iron-1`, 22 MB on `pro_3` — to read ten integers, a frame rate and the shape of the
 * picture. Twice, in fact: the panel wanted the phase timings and the pane wanted the anchors.
 * On a phone that download is the entire perceived quality of the feature; a comparison that
 * arrives seconds after the tap reads as broken rather than as slow.
 *
 * `/sync-profile` is a projection of the same stored artifact, so the numbers cannot disagree —
 * and the reference's keypoints, which are the megabytes, are not fetched at all, because nothing
 * is drawn on the reference pane.
 *
 * ## The states are the same three `useAnalysis` has, for the same reasons
 *
 * `not-analysed` is a 404, which is permanent and normal: a swing that failed analysis, or has not
 * been analysed yet, has no positions to align on. It is not an error, the video still plays, and
 * the pane says the two cannot be lined up. `unreachable` stays separate because the network
 * failing is worth retrying and a missing artifact never will be.
 */

export type SyncProfileState =
  | { kind: "loading" }
  | { kind: "ok"; profile: SyncProfile }
  | { kind: "not-analysed" }
  | { kind: "unreachable" };

/**
 * Profiles already fetched this session, keyed by request path.
 *
 * Unbounded, unlike the artifact cache next door, and deliberately: an entry is on the order of two
 * kilobytes, so a golfer who tried twenty references in one sitting is holding forty. The reason
 * that cache needs a limit — whole-clip keypoints — is exactly what this one does not carry.
 */
const cache = new Map<string, SyncProfile>();

/** Sign-out and the tests' reset seam — one golfer's swings must not outlive their session. */
export function clearSyncProfileCache(): void {
  cache.clear();
}

function pathFor(swingId: string, view?: string | null): string {
  return view
    ? `swings/${swingId}/sync-profile?view=${encodeURIComponent(view)}`
    : `swings/${swingId}/sync-profile`;
}

/**
 * @param swingId the swing to line up, or undefined to fetch nothing.
 * @param view    a view TYPE (`dtl` / `face_on`), never a view id — the route answers a uuid with
 *                400 rather than falling back. Omitted takes the swing's primary view.
 */
export function useSyncProfile(swingId: string | undefined, view?: string | null): SyncProfileState {
  const [state, setState] = useState<SyncProfileState>(() => {
    const hit = swingId ? cache.get(pathFor(swingId, view)) : undefined;
    return hit ? { kind: "ok", profile: hit } : { kind: "loading" };
  });

  useEffect(() => {
    if (!swingId) {
      setState({ kind: "not-analysed" });
      return;
    }
    const path = pathFor(swingId, view);
    const hit = cache.get(path);
    if (hit) {
      setState({ kind: "ok", profile: hit });
      return;
    }

    let live = true;
    const controller = new AbortController();
    setState({ kind: "loading" });

    void api
      .request<SyncProfile>(path, { signal: controller.signal })
      .then((profile) => {
        cache.set(path, profile);
        if (live) setState({ kind: "ok", profile });
      })
      .catch((err: unknown) => {
        if (!live) return;
        const status = err instanceof ApiClientError ? err.status : 0;
        // 400 belongs with 404: an unrecognised view is a swing this client cannot line up, not a
        // transient failure worth retrying.
        setState({ kind: status === 404 || status === 400 ? "not-analysed" : "unreachable" });
      });

    return () => {
      live = false;
      controller.abort();
    };
  }, [swingId, view]);

  return state;
}
