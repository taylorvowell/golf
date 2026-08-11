"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PHASE_MARK_KEYS, phaseMarkLabel, type PhaseMark } from "@/lib/swingPhases";

/** The five swing boundaries, in swing order. `lib/swingPhases.ts` owns the definition; this
 * re-exports it under the names the marker list already uses. `db/stages.ts` holds the server's
 * copy, duplicated because it is `server-only` and importing it here would pull the Postgres
 * client into the browser bundle (CLAUDE.md's scoring split). */
export const STAGES = PHASE_MARK_KEYS;

export type Stage = PhaseMark;

export const stageLabel = phaseMarkLabel;

export interface SwingStages {
  /** stage -> frame, for stages that have been corrected by hand. */
  byStage: Map<Stage, number>;
  /** frame -> stage, the same data indexed the way a per-frame list needs it. */
  byFrame: Map<number, Stage>;
  /** Pin `stage` to `frame`, or pass null to clear it. Saves immediately. */
  set: (stage: Stage, frame: number | null) => void;
  saving: boolean;
  error: string | null;
}

/**
 * Hand-corrected swing stages for one swing, from `/api/v1/swings/:id/stages`.
 *
 * Saved on every change rather than batched behind a save button, unlike `useHeadMarkers`. The
 * two are different shapes of edit: a head position is a drag that emits a value per pointer
 * move and genuinely needs coalescing, while a stage is one deliberate pick from a list. Writing
 * it straight through means there is no second unsaved-state surface to reason about, and the
 * exclusivity rule ("marking the top here releases the old top") is applied by the database's
 * unique index rather than reimplemented client-side.
 */
export function useSwingStages(swingId: string): SwingStages {
  const [byStage, setByStage] = useState<Map<Stage, number>>(() => new Map());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = useCallback((rows: { stage: string; frame: number }[]) => {
    setByStage(new Map(rows.map((r) => [r.stage as Stage, r.frame])));
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    fetch(`/api/v1/swings/${swingId}/stages`, { cache: "no-store", signal: ac.signal })
      .then((r) => r.json())
      .then((d: { stages?: { stage: string; frame: number }[] }) => apply(d.stages ?? []))
      .catch((e: Error) => { if (e.name !== "AbortError") setError("could not load swing stages"); });
    return () => ac.abort();
  }, [swingId, apply]);

  const set = useCallback((stage: Stage, frame: number | null) => {
    // Optimistic, and the response is authoritative. The server returns the whole set precisely
    // because one write can change two rows — pinning `top` to a new frame releases the old one —
    // and reconstructing that here would be a second implementation of the same rule.
    setByStage((cur) => {
      const next = new Map(cur);
      if (frame === null) next.delete(stage); else next.set(stage, frame);
      return next;
    });
    setSaving(true);
    setError(null);
    fetch(`/api/v1/swings/${swingId}/stages`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage, frame }),
    })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
        apply(d.stages ?? []);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setSaving(false));
  }, [swingId, apply]);

  const byFrame = useMemo(() => {
    const m = new Map<number, Stage>();
    for (const [s, f] of byStage) m.set(f, s);
    return m;
  }, [byStage]);

  return useMemo(() => ({ byStage, byFrame, set, saving, error }),
                 [byStage, byFrame, set, saving, error]);
}
