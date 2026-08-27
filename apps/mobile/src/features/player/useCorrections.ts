import { useEffect, useState } from "react";

import { api } from "../../platform/client";

/**
 * Hand corrections for one swing view — the pinned phase boundaries and the placed club heads.
 *
 * These are **not in `analysis.json` and must never be**: the artifact is rewritten wholesale by
 * every re-analysis, so a correction stored there would be silently destroyed the next time the
 * pipeline ran. They live in the database and merge by frame at render time, and this is the phone's
 * half of that merge. Both routes already exist and are already access-checked; nothing server-side
 * changes to read them.
 *
 * Everything here is **optional by design**. A swing nobody has corrected returns two empty lists,
 * a failure returns the same, and the overlay draws the analyzer's own answer — which is the correct
 * behaviour, not a degraded one. A correction that cannot be fetched must never stop a swing being
 * watched, so this hook has no error state to render.
 */

/** The five marks a person can point at in the picture. Mirrors the server's `STAGES`. */
export const PHASE_MARKS = [
  "approach_start",
  "backswing_start",
  "downswing_start",
  "impact",
  "finish_start",
] as const;

export type PhaseMark = (typeof PHASE_MARKS)[number];
export type PhaseOverrides = Partial<Record<PhaseMark, number>>;

/** Placed club-head positions, normalized, keyed by the frame they were placed on. */
export type HeadMarks = Map<number, [number, number]>;

export interface Corrections {
  phases: PhaseOverrides;
  marks: HeadMarks;
}

const EMPTY: Corrections = { phases: {}, marks: new Map() };

interface StagesResponse {
  stages?: { stage?: unknown; frame?: unknown; stale?: unknown }[];
}
interface MarkersResponse {
  markers?: { frame?: unknown; x?: unknown; y?: unknown; stale?: unknown }[];
}

const isMark = (s: unknown): s is PhaseMark =>
  typeof s === "string" && (PHASE_MARKS as readonly string[]).includes(s);

export function useCorrections(swingId: string | undefined, view?: string | null): Corrections {
  const [corrections, setCorrections] = useState<Corrections>(EMPTY);

  useEffect(() => {
    if (!swingId) {
      setCorrections(EMPTY);
      return;
    }
    let live = true;
    const controller = new AbortController();
    const q = view ? `?view=${encodeURIComponent(view)}` : "";
    const init = { signal: controller.signal };

    void Promise.all([
      api.request<StagesResponse>(`swings/${swingId}/stages${q}`, init).catch(() => null),
      api.request<MarkersResponse>(`swings/${swingId}/markers${q}`, init).catch(() => null),
    ]).then(([s, m]) => {
      if (!live) return;

      const phases: PhaseOverrides = {};
      // Stage NAMES are validated, not merely read. The oldest rows in this database predate the
      // five-mark model and still say `address` / `top` / `toe_up`; the web player ignores them by
      // only ever asking for the names it knows, and dropping them here rather than mapping them
      // keeps the two clients agreeing about which corrections are live.
      //
      // `stale` rows are dropped for a different reason (C10): they were placed against a
      // DIFFERENT artifact clock — a re-analysis changed the fps and renumbered every frame —
      // so their frame numbers name the wrong instant on this clip. The analyzer's own answer
      // is the honest fallback; the row survives server-side for whoever re-pins it.
      for (const row of s?.stages ?? []) {
        if (row.stale === true) continue;
        if (isMark(row.stage) && typeof row.frame === "number") phases[row.stage] = row.frame;
      }

      const marks: HeadMarks = new Map();
      for (const row of m?.markers ?? []) {
        if (row.stale === true) continue;
        if (typeof row.frame === "number" && typeof row.x === "number" && typeof row.y === "number") {
          marks.set(row.frame, [row.x, row.y]);
        }
      }

      setCorrections({ phases, marks });
    });

    return () => {
      live = false;
      controller.abort();
    };
  }, [swingId, view]);

  return corrections;
}
