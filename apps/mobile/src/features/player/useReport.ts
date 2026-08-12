import { useEffect, useState } from "react";
import type { CoachReport } from "@swingsage/schema/contract";

import { ApiClientError } from "../../platform/api";
import { api } from "../../platform/client";

/**
 * The swing's scorecard — Stage 8's whole output, with no AI in it.
 *
 * Fetched separately from `analysis.json` and much later: the artifact is megabytes of per-frame
 * geometry that the overlay needs immediately, while this is a few kilobytes that nothing needs
 * until someone opens the Analysis panel. So it is **lazy** — the request does not go out until
 * `enabled` turns true.
 *
 * `not-scored` is a real and permanent state, not an error. A swing analysed with `--no-scoring`
 * has no report, and the honest answer is to say so rather than to show a zero — the same
 * distinction `useAnalysis` draws, for the same reason.
 */

export type ReportState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; report: CoachReport }
  | { kind: "not-scored" }
  | { kind: "unreachable" };

export function useReport(
  swingId: string | undefined,
  view: string | null | undefined,
  enabled: boolean,
): ReportState {
  const [state, setState] = useState<ReportState>({ kind: "idle" });

  useEffect(() => {
    if (!swingId || !enabled) return;
    let live = true;
    // Only from idle: re-opening the panel must not re-fetch a report that is already in hand.
    setState((s) => (s.kind === "idle" ? { kind: "loading" } : s));

    const path = view
      ? `swings/${swingId}/report?view=${encodeURIComponent(view)}`
      : `swings/${swingId}/report`;

    void api
      .request<CoachReport>(path)
      .then((report) => {
        if (live) setState({ kind: "ok", report });
      })
      .catch((err: unknown) => {
        if (!live) return;
        const status = err instanceof ApiClientError ? err.status : 0;
        setState({ kind: status === 404 || status === 400 ? "not-scored" : "unreachable" });
      });

    return () => {
      live = false;
    };
  }, [swingId, view, enabled]);

  return state;
}
