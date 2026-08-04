"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface Job {
  status: "idle" | "queued" | "running" | "done" | "failed";
  stage?: string;
  progressPct?: number;
  message?: string;
  log?: string[];
}

/**
 * Re-runs the analyzer over this swing's original clip.
 *
 * The point of `analysis.json` being a stored artifact (doc 02) is that an improved model can
 * be re-run over swings already filmed. Editing `swingsage/` does not change a stored
 * analysis — the player keeps drawing the old artifact until something re-runs the analyzer,
 * which is the usual reason a pipeline change "doesn't show up".
 *
 * Rendered as a `workspace-action` in the tab bar, so it sits with the other swing-level
 * actions rather than as a stray button in a header. Progress runs as a fill along the bottom
 * of the button itself; a failure opens the stage log underneath.
 */
export default function ReanalyzeButton({ id }: { id: string }) {
  const [job, setJob] = useState<Job>({ status: "idle" });
  const [showLog, setShowLog] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // `poll` reschedules itself, so it cannot close over its own binding. The indirection is a
  // ref rather than a recursive reference so each tick calls the freshest closure.
  const pollRef = useRef<() => void>(() => {});

  const poll = useCallback(async () => {
    try {
      const r = await fetch(`/api/swings/${id}/reanalyze`, { cache: "no-store" });
      const j: Job = await r.json();
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

  // Resume polling if a run is already in flight — a reload mid-analysis should rejoin it
  // rather than look idle next to a Python process that is still working.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`/api/swings/${id}/reanalyze`, { cache: "no-store" });
        const j: Job = await r.json();
        if (alive && (j.status === "running" || j.status === "queued")) {
          setJob(j);
          timer.current = setTimeout(() => pollRef.current(), 1000);
        }
      } catch { /* nothing in flight is the normal case */ }
    })();
    return () => {
      alive = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [id, poll]);

  const start = async () => {
    setShowLog(false);
    setJob({ status: "queued", message: "starting analyzer", progressPct: 0 });
    try {
      const r = await fetch(`/api/swings/${id}/reanalyze`, { method: "POST" });
      const j: Job = await r.json();
      setJob(j);
      if (r.ok) timer.current = setTimeout(() => pollRef.current(), 800);
    } catch {
      setJob({ status: "failed", message: "could not reach the server" });
    }
  };

  const busy = job.status === "running" || job.status === "queued";
  const pct = Math.min(100, Math.max(0, job.progressPct ?? 0));

  return (
    <div className="relative">
      <button type="button" onClick={busy ? undefined : start} disabled={busy}
        title="Re-run the analyzer over the original clip with the current pipeline (~90s)"
        className={`workspace-action relative overflow-hidden ${busy
          ? "border border-acid/25 bg-acid/[.06] text-acid"
          : "bg-acid text-canvas shadow-[0_12px_34px_rgba(94,208,255,.18)]"}`}>
        <svg className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} viewBox="0 0 24 24" fill="none"
             stroke="currentColor" strokeWidth="2.5">
          <path d="M21 12a9 9 0 1 1-2.6-6.3" /><path d="M21 3v6h-6" />
        </svg>
        <span className="tabular-nums">
          {busy ? `${job.stage ?? "working"} ${pct.toFixed(0)}%` : "Re-analyze"}
        </span>
        {busy && (
          <span className="absolute inset-x-0 bottom-0 h-[3px] bg-acid/60 transition-[width] duration-500"
                style={{ width: `${pct}%` }} />
        )}
      </button>

      {busy && job.message && (
        <p className="absolute left-0 top-full mt-1 max-w-[280px] truncate text-[10px] text-neutral-500">
          {job.message}
        </p>
      )}

      {job.status === "failed" && (
        <div className="absolute right-0 top-full z-50 mt-2 w-[420px] max-w-[86vw] rounded-2xl border
                        border-red-400/25 bg-panel p-3 shadow-[0_24px_70px_rgba(0,0,0,.55)]">
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs leading-5 text-red-300">{job.message ?? "analysis failed"}</p>
            <button type="button" onClick={() => setJob({ status: "idle" })}
                    className="text-neutral-500 hover:text-neutral-200">×</button>
          </div>
          {!!job.log?.length && (
            <>
              <button type="button" onClick={() => setShowLog((s) => !s)}
                      className="mt-2 text-[10px] uppercase tracking-[.16em] text-neutral-500 hover:text-neutral-300">
                {showLog ? "hide" : "show"} stage log
              </button>
              {showLog && (
                <pre className="scrollbar mt-2 max-h-48 overflow-auto rounded-xl border border-line
                                bg-black/40 p-2 text-[10px] leading-tight text-neutral-400">
                  {job.log.join("\n")}
                </pre>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
