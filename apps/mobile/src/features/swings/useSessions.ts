import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionListResponse, SessionSummary } from "@swingsage/schema/contract";

import { ApiClientError } from "../../platform/api";
import { api } from "../../platform/client";
import { supabase } from "../auth/supabase";

/**
 * The golfer's practice sessions — the names and types the swing log groups swings under.
 *
 * Deliberately a SEPARATE hook from `useSwings` rather than a field on it. A session is an
 * organizing layer over swings (D29), not a property of one: the log needs the whole list to
 * number the next default name and to label a session that has no swings on this page, and a
 * swing list that carried its sessions inline would refetch every session on every swing
 * refresh.
 *
 * It fails SOFT, which is the difference from `useSwings`. The swing list is the golfer's data
 * and an error about it must be said out loud; session metadata only decides a title and whether
 * a session is quarantined from averages, so an unreachable server degrades to time-inferred
 * grouping — the exact behaviour every build before session mode had — instead of an error
 * screen over swings that are fine.
 */

export interface SessionsHook {
  sessions: SessionSummary[];
  /** True until the first answer (or failure) — the log waits for it before numbering. */
  loading: boolean;
  refresh: () => void;
}

/** Shared across mounts, like `useSwings`' — the log, the home screen and capture all read it. */
let lastGood: SessionSummary[] | null = null;
const listeners = new Set<() => void>();

export function clearSessionsCache(): void {
  lastGood = null;
}

/** After minting or renaming, so a log already on screen shows the session it just gained. */
export function primeSession(session: SessionSummary): void {
  const rest = (lastGood ?? []).filter((s) => s.id !== session.id);
  lastGood = [session, ...rest];
  for (const listener of listeners) listener();
}

supabase.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT") clearSessionsCache();
});

export function useSessions(): SessionsHook {
  const [sessions, setSessions] = useState<SessionSummary[]>(() => lastGood ?? []);
  const [loading, setLoading] = useState(lastGood === null);
  const liveRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const body = await api.request<SessionListResponse>("sessions", {
        signal: controller.signal,
      });
      lastGood = body.sessions;
      if (liveRef.current) setSessions(body.sessions);
    } catch (err) {
      if (!liveRef.current || controller.signal.aborted) return;
      // A 401 clears the cache — one golfer's session names must never outlive their session.
      if (err instanceof ApiClientError && err.status === 401) {
        lastGood = null;
        if (liveRef.current) setSessions([]);
      }
      // Anything else keeps whatever was confirmed before: grouping falls back to time.
    } finally {
      if (liveRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    liveRef.current = true;
    const onChanged = () => {
      if (liveRef.current) setSessions(lastGood ?? []);
    };
    listeners.add(onChanged);
    void load();
    return () => {
      liveRef.current = false;
      listeners.delete(onChanged);
      abortRef.current?.abort();
    };
  }, [load]);

  return { sessions, loading, refresh: useCallback(() => void load(), [load]) };
}
