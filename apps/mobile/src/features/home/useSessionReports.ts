import { useEffect, useMemo, useState } from "react";
import type { CoachReport, SwingSummary } from "@swingsage/schema/contract";

import { ApiClientError } from "../../platform/api";
import { api } from "../../platform/client";
import { supabase } from "../auth/supabase";

/**
 * The coach reports behind one session's scored swings — the focus aggregation's input.
 *
 * Reports are a few kilobytes each and immutable for a given analysis revision, so they are
 * cached at module level by swing id: opening Home after the after-swing screen already fetched
 * a report must not pay for it again, and neither must a pull-to-refresh. The cache clears on
 * sign-out with the same reasoning as `useSwings`' list cache — one golfer's faults must never
 * seed another's home screen.
 *
 * A report that cannot be fetched is **excluded, not guessed at**: the aggregation runs over the
 * reports that actually arrived, and if none did the focus section simply does not render. The
 * session card above it is fed by the list request, so a network failure still reads as the
 * screen-level "cannot reach" state — this hook never has to stand in for it.
 */

/** A report still attached to the swing it scored — the hero card needs the swing (its photo,
 *  its id to open) as much as the priorities inside. */
export interface SessionReport {
  swingId: string;
  report: CoachReport;
}

export type SessionReportsState =
  | { kind: "loading" }
  | { kind: "ok"; reports: SessionReport[] };

/** `"none"` marks a confirmed 404/400 — asking again would spend a request to learn it again. */
const cache = new Map<string, CoachReport | "none">();

/** The auth-boundary reset and the tests' seam. */
export function clearReportsCache(): void {
  cache.clear();
}

supabase.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT") clearReportsCache();
});

/** Enough swings to see a pattern; few enough that Home never fans out a whole afternoon. */
const MAX_REPORTS = 8;

export function useSessionReports(swings: SwingSummary[]): SessionReportsState {
  // Newest MAX_REPORTS scored swings, still oldest → newest so "newest cue wins" holds downstream.
  const targets = useMemo(
    () =>
      swings
        .filter((s) => s.status === "ready" && typeof s.overallScore === "number")
        .slice(-MAX_REPORTS),
    [swings],
  );

  const [state, setState] = useState<SessionReportsState>({ kind: "loading" });

  useEffect(() => {
    let live = true;
    const controller = new AbortController();

    const publish = () => {
      if (!live) return;
      const reports: SessionReport[] = [];
      for (const s of targets) {
        const cached = cache.get(s.id);
        if (cached !== undefined && cached !== "none") reports.push({ swingId: s.id, report: cached });
      }
      setState({ kind: "ok", reports });
    };

    const missing = targets.filter((s) => !cache.has(s.id));
    if (missing.length === 0) {
      publish();
      return () => {
        live = false;
      };
    }

    // Draw what the cache already holds rather than blanking a focus that was on screen; the
    // refined set lands when the stragglers do. A fully cold cache stays "loading" instead —
    // an empty `ok` for one frame would flash the section away and back.
    if (targets.some((s) => cache.has(s.id))) publish();
    else setState({ kind: "loading" });

    void Promise.all(
      missing.map(async (s) => {
        try {
          const path = s.view
            ? `swings/${s.id}/report?view=${encodeURIComponent(s.view)}`
            : `swings/${s.id}/report`;
          const report = await api.request<CoachReport>(path, { signal: controller.signal });
          cache.set(s.id, report);
        } catch (err) {
          if (controller.signal.aborted) return;
          const status = err instanceof ApiClientError ? err.status : 0;
          // 404/400 is the server's answer; anything else is no answer, left uncached so a
          // later mount retries instead of remembering a network blip as "no report".
          if (status === 404 || status === 400) cache.set(s.id, "none");
        }
      }),
    ).then(publish);

    return () => {
      live = false;
      controller.abort();
    };
  }, [targets]);

  return state;
}
