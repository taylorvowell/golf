"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface ReanalyzeJob {
  status: "idle" | "queued" | "running" | "done" | "failed";
  stage?: string;
  progressPct?: number;
  message?: string;
  log?: string[];
}

export interface Reanalyze {
  job: ReanalyzeJob;
  /** Queued or running — a Python process is working on this swing right now. */
  busy: boolean;
  /** 0–100, clamped. */
  pct: number;
  start: () => void;
  /** Clear a failure so the banner goes away; a no-op while a job is in flight. */
  dismiss: () => void;
}

/**
 * The re-analysis job for one swing: start it, and follow it to the end.
 *
 * Owned at the page level and shared by everything that touches it — the settings menu that
 * starts it and the progress banner that reports it. It used to live inside the button, which
 * meant the only place the job existed was inside a dropdown: close the menu and a 90-second
 * Python run had no representation on the page at all. Two buttons would also have meant two
 * independent pollers disagreeing about the same job.
 *
 * The protocol is doc 02's and unchanged: POST starts, GET polls stage/progress/message. Job
 * state lives in the `jobs` Postgres table (D38), so a reload mid-run rejoins the run rather
 * than showing an idle button next to a process that is still working.
 */
export function useReanalyze(id: string): Reanalyze {
  const [job, setJob] = useState<ReanalyzeJob>({ status: "idle" });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // `poll` reschedules itself, so it cannot close over its own binding. The indirection is a
  // ref rather than a recursive reference so each tick calls the freshest closure.
  const pollRef = useRef<() => void>(() => {});

  const poll = useCallback(async () => {
    try {
      const r = await fetch(`/api/swings/${id}/reanalyze`, { cache: "no-store" });
      const j: ReanalyzeJob = await r.json();
      setJob(j);
      if (j.status === "running" || j.status === "queued") {
        timer.current = setTimeout(() => pollRef.current(), 1000);
      } else if (j.status === "done") {
        // Full reload rather than router.refresh(). The analyzer rewrites normalized.mp4 as
        // well as analysis.json, and the frame count can change between runs — so a component
        // holding a buffered video and a frame index that may now be out of range is exactly
        // the stale state worth not reasoning about. A 90-second analysis has already been
        // paid for; a reload is free next to it.
        window.location.reload();
      }
    } catch {
      setJob({ status: "failed", message: "lost contact with the server" });
    }
  }, [id]);

  useEffect(() => { pollRef.current = poll; }, [poll]);

  // Rejoin a run already in flight, so a reload mid-analysis picks it back up.
  useEffect(() => {
    const ac = new AbortController();
    fetch(`/api/swings/${id}/reanalyze`, { cache: "no-store", signal: ac.signal })
      .then((r) => r.json())
      .then((j: ReanalyzeJob) => {
        if (j.status === "running" || j.status === "queued") {
          setJob(j);
          timer.current = setTimeout(() => pollRef.current(), 1000);
        }
      })
      .catch(() => { /* nothing in flight is the normal case */ });
    return () => {
      ac.abort();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [id]);

  const start = useCallback(() => {
    setJob({ status: "queued", message: "starting analyzer", progressPct: 0 });
    fetch(`/api/swings/${id}/reanalyze`, { method: "POST" })
      .then(async (r) => {
        const j: ReanalyzeJob = await r.json();
        setJob(j);
        if (r.ok) timer.current = setTimeout(() => pollRef.current(), 800);
      })
      .catch(() => setJob({ status: "failed", message: "could not reach the server" }));
  }, [id]);

  const busy = job.status === "running" || job.status === "queued";
  const dismiss = useCallback(() => {
    if (!busy) setJob({ status: "idle" });
  }, [busy]);

  return { job, busy, pct: Math.min(100, Math.max(0, job.progressPct ?? 0)), start, dismiss };
}
