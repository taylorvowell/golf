"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { TrackingTestId } from "@/lib/clubTests";

export interface ClubTestJob {
  status: "idle" | "queued" | "running" | "done" | "failed";
  /** The test id, carried in the job's stage field. */
  stage?: string;
  message?: string;
}

export interface ClubTest {
  job: ClubTestJob;
  /** A tracker process is working on this swing right now. */
  busy: boolean;
  start: (testId: TrackingTestId) => void;
  dismiss: () => void;
}

/**
 * One swing's club-test run: start a tracker, follow it to the merge, refresh the page data.
 *
 * Same shape as `useReanalyze`, with one deliberate difference at the end: `router.refresh()`
 * instead of a full reload. A club test merges a block into `analysis.json` and touches
 * nothing else — the video, the frame count and the playhead are all still valid, so the RSC
 * re-read is enough and the player keeps its state.
 */
export function useClubTest(id: string): ClubTest {
  const router = useRouter();
  const [job, setJob] = useState<ClubTestJob>({ status: "idle" });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollRef = useRef<() => void>(() => {});

  const poll = useCallback(async () => {
    try {
      const r = await fetch(`/api/swings/${id}/club-test`, { cache: "no-store" });
      const j: ClubTestJob = await r.json();
      setJob(j);
      if (j.status === "running" || j.status === "queued") {
        timer.current = setTimeout(() => pollRef.current(), 1000);
      } else if (j.status === "done") {
        router.refresh();
      }
    } catch {
      setJob({ status: "failed", message: "lost contact with the server" });
    }
  }, [id, router]);

  useEffect(() => { pollRef.current = poll; }, [poll]);

  // Rejoin a run already in flight (a longer model-based test surviving a page nav).
  useEffect(() => {
    const ac = new AbortController();
    fetch(`/api/swings/${id}/club-test`, { cache: "no-store", signal: ac.signal })
      .then((r) => r.json())
      .then((j: ClubTestJob) => {
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

  const start = useCallback((testId: TrackingTestId) => {
    setJob({ status: "queued", stage: testId, message: "starting tracker" });
    fetch(`/api/swings/${id}/club-test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ testId }),
    })
      .then(async (r) => {
        const j: ClubTestJob = await r.json();
        setJob(j);
        if (r.ok && j.status === "done") router.refresh();
        else if (r.ok) timer.current = setTimeout(() => pollRef.current(), 700);
      })
      .catch(() => setJob({ status: "failed", message: "could not reach the server" }));
  }, [id, router]);

  const busy = job.status === "running" || job.status === "queued";
  const dismiss = useCallback(() => {
    if (!busy) setJob({ status: "idle" });
  }, [busy]);

  return { job, busy, start, dismiss };
}
