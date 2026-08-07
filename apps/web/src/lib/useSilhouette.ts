"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Silhouette } from "@/lib/swings";

export interface SilhouetteData {
  /** Rings by frame, ready to fill. Empty until the fetch lands, and after a failure. */
  byFrame: Map<number, [number, number][][]>;
  loading: boolean;
  /** Set when the fetch failed for a swing that was supposed to have one. */
  error: string | null;
  coverage: number;
  notes: string[];
}

const EMPTY: SilhouetteData = {
  byFrame: new Map(), loading: false, error: null, coverage: 0, notes: [],
};

/**
 * The golfer's outline for one swing, fetched **on demand**.
 *
 * `enabled` is the overlay toggle. The artifact is 0.3–1.1 MB — comparable to the analysis
 * itself — and most viewings never turn the silhouette on, so pulling it during page load
 * would make every visit pay for a feature few use. Once fetched it stays: switching the
 * overlay off and on again is free, which matters because comparing "with" and "without" is
 * exactly how this overlay gets used.
 *
 * A 404 is not an error condition. Swings analysed before Stage 2b existed have no silhouette,
 * and the caller decides how to present that (the overlay group hides itself); this hook just
 * reports empty.
 */
export function useSilhouette(swingId: string, enabled: boolean,
                              kind: "silhouette" | "isolation" = "silhouette"): SilhouetteData {
  const [raw, setRaw] = useState<Silhouette | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Which swing we have already asked for, so re-enabling does not re-fetch. A ref and not
  // state: nothing renders off it, and setting it must not itself schedule a render.
  const fetched = useRef<string | null>(null);

  // Drop the previous swing's outline the moment the id changes, not when the new one lands:
  // the comparison pane mounts a second stage against a different swing, and drawing golfer A's
  // outline over golfer B for the duration of a fetch is worse than drawing none.
  useEffect(() => {
    if (fetched.current !== null && fetched.current !== swingId) {
      fetched.current = null;
      setRaw(null);
    }
  }, [swingId]);

  useEffect(() => {
    if (!enabled || fetched.current === swingId) return;
    // kind is fixed per hook instance, so the fetched-marker stays swing-keyed
    fetched.current = swingId;
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    fetch(`/api/swings/${swingId}/${kind}`, { signal: ac.signal })
      .then((r) => {
        if (r.status === 404) return null;          // simply not analysed with Stage 2b
        if (!r.ok) throw new Error(`silhouette: ${r.status}`);
        return r.json() as Promise<Silhouette>;
      })
      .then((d) => setRaw(d))
      .catch((e) => {
        if ((e as Error).name === "AbortError") return;
        // Allow a retry: the toggle is the only way back here, and a transient failure that
        // permanently disabled the overlay would read as the feature being broken.
        fetched.current = null;
        setError((e as Error).message);
      })
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, [swingId, enabled, kind]);

  const byFrame = useMemo(() => {
    const m = new Map<number, [number, number][][]>();
    for (const row of raw?.frames ?? []) m.set(row.f, row.p);
    return m;
  }, [raw]);

  if (!enabled && !raw) return EMPTY;
  return {
    byFrame, loading, error,
    coverage: raw?.coverage ?? 0,
    notes: raw?.notes ?? [],
  };
}
