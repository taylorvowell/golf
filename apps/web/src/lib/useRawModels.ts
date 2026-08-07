"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { RawBox, RawModelsDoc } from "@/lib/swings";

export interface RawModelsData {
  /** [key, label] pairs of every candidate model in the sidecar, empty until fetched. */
  models: [string, string][];
  /** modelKey -> frame -> boxes. */
  byModel: Map<string, Map<number, RawBox[]>>;
  loading: boolean;
}

const EMPTY: RawModelsData = { models: [], byModel: new Map(), loading: false };

/**
 * The multi-model raw-detection sidecar, fetched on demand (same contract as
 * useSilhouette): 404 = scripts/rawmodels.py has not run for this swing, which is a
 * normal state the Debug menu explains rather than an error.
 */
export function useRawModels(swingId: string, enabled: boolean): RawModelsData {
  const [raw, setRaw] = useState<RawModelsDoc | null>(null);
  const [loading, setLoading] = useState(false);
  const fetched = useRef<string | null>(null);

  useEffect(() => {
    if (fetched.current !== null && fetched.current !== swingId) {
      fetched.current = null;
      setRaw(null);
    }
  }, [swingId]);

  useEffect(() => {
    if (!enabled || fetched.current === swingId) return;
    fetched.current = swingId;
    const ac = new AbortController();
    setLoading(true);
    fetch(`/api/swings/${swingId}/raw-models`, { signal: ac.signal })
      .then((r) => (r.status === 404 ? null : r.json() as Promise<RawModelsDoc>))
      .then((d) => setRaw(d))
      .catch((e) => {
        if ((e as Error).name !== "AbortError") fetched.current = null;
      })
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, [swingId, enabled]);

  const byModel = useMemo(() => {
    const m = new Map<string, Map<number, RawBox[]>>();
    for (const [key, entry] of Object.entries(raw?.models ?? {})) {
      const fm = new Map<number, RawBox[]>();
      for (const row of entry.frames) fm.set(row.f, row.d);
      m.set(key, fm);
    }
    return m;
  }, [raw]);

  if (!enabled && !raw) return EMPTY;
  return {
    models: Object.entries(raw?.models ?? {}).map(([k, v]) => [k, v.label]),
    byModel, loading,
  };
}
