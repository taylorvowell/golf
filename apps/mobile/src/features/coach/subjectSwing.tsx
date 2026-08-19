import { useEffect, useMemo, useState } from "react";
import type { SwingSummary } from "@swingsage/schema/contract";

import { useDebugGroups } from "../debug/DebugOverlay";
import { createdAtMs } from "../swings/sessions";
import { useSwings } from "../swings/useSwings";

/**
 * The SUBJECT of every coach example — which golfer the stance walkthrough and the deep
 * swing analysis draw on. One store so all the examples show one person, and so the debug
 * menu can swap that person everywhere at once (Taylor, 2026-08-19).
 *
 * Default: the newest ready REFERENCE swing (the same person the after-swing compare uses),
 * falling back to the account's own newest scored swing. The debug override cycles through
 * every ready swing; NOT persisted on purpose — a forced subject that survives a reload is a
 * demo that quietly stops showing the golfer their own swing (the hide-overlay rule).
 */

let override: string | null = null;
const listeners = new Set<() => void>();

function setOverride(id: string | null): void {
  override = id;
  for (const listener of listeners) listener();
}

function useOverride(): string | null {
  const [id, setId] = useState(override);
  useEffect(() => {
    const update = () => setId(override);
    listeners.add(update);
    return () => {
      listeners.delete(update);
    };
  }, []);
  return id;
}

/** The swing every coach example should use right now, or null when nothing is ready. */
export function useSubjectSwing(): SwingSummary | null {
  const { state } = useSwings();
  const forced = useOverride();
  return useMemo(() => {
    if (state.kind !== "ok") return null;
    const ready = state.swings.filter((s) => s.status === "ready");
    if (forced) {
      const hit = ready.find((s) => s.id === forced);
      if (hit) return hit;
    }
    const refs = ready.filter((s) => s.referenceLabel);
    const pool = refs.length ? refs : ready.filter((s) => typeof s.overallScore === "number");
    if (!pool.length) return null;
    return pool.reduce((a, b) => (createdAtMs(a) >= createdAtMs(b) ? a : b));
  }, [forced, state]);
}

/**
 * The debug control: cycles the subject through every ready swing, and resets to the
 * default. Mounted inside `AuthGate` (it reads the swing list) — registration itself no-ops
 * in release. Renders nothing.
 */
export function SubjectDebug() {
  const { state } = useSwings();
  const forced = useOverride();
  const subject = useSubjectSwing();

  const groups = useMemo(() => {
    const ready = state.kind === "ok" ? state.swings.filter((s) => s.status === "ready") : [];
    return [
      {
        title: `Coach subject — ${subject ? (subject.referenceLabel ?? subject.label) : "none"}`,
        inline: true,
        actions: [
          {
            key: "subject-next",
            label: "Next golfer",
            detail: "Cycle every coach example (stance + deep analysis) to the next ready swing.",
            onPress: () => {
              if (!ready.length) return;
              const i = ready.findIndex((s) => s.id === (forced ?? subject?.id));
              setOverride(ready[(i + 1) % ready.length].id);
            },
          },
          {
            key: "subject-default",
            label: "Default",
            detail: "Back to the default subject (reference swing, else own newest scored).",
            onPress: () => setOverride(null),
          },
        ],
      },
    ];
  }, [forced, state, subject]);
  useDebugGroups("coach-subject", groups);
  return null;
}
