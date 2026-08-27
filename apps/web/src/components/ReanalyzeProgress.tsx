"use client";

import { useState } from "react";
import type { Reanalyze } from "@/lib/useReanalyze";
import { stageLabel } from "@swingsage/schema/stages";

/**
 * What a running re-analysis looks like from the page.
 *
 * It reports at the top of the workspace rather than inside the menu that started it, because
 * the menu closes and the job does not: a 90-second Python run needs somewhere to live that
 * survives the click that began it. The nine pipeline stages are named in the artifact's own
 * vocabulary (`normalize`, `pose`, `club`, …) so a stall is diagnosable — which stage it stopped
 * on is the first question, and the architecture spec made every stage report itself for exactly this.
 *
 * Renders nothing when idle. On failure it stays until dismissed and offers the stage log,
 * because a failed analysis that vanishes takes the only account of what went wrong with it.
 */
export default function ReanalyzeProgress({ r }: { r: Reanalyze }) {
  const [showLog, setShowLog] = useState(false);
  const { job, busy, pct, dismiss } = r;

  if (job.status === "idle" || job.status === "done") return null;

  if (job.status === "failed") {
    return (
      <div className="rounded-2xl border border-red-400/25 bg-red-400/[.06] px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[.12em] text-red-300">
              Re-analysis failed
            </p>
            <p className="mt-1 text-xs leading-5 text-red-200/90">
              {job.message ?? "the analyzer stopped without a reason"}
            </p>
          </div>
          <button type="button" onClick={dismiss} aria-label="Dismiss"
                  className="text-neutral-500 hover:text-neutral-200">×</button>
        </div>
        {!!job.log?.length && (
          <>
            <button type="button" onClick={() => setShowLog((s) => !s)}
                    className="mt-2 text-[10px] uppercase tracking-[.16em] text-neutral-500
                               hover:text-neutral-300">
              {showLog ? "hide" : "show"} stage log
            </button>
            {showLog && (
              <pre className="scrollbar mt-2 max-h-56 overflow-auto rounded-xl border border-line
                              bg-black/40 p-2 text-[10px] leading-tight text-neutral-400">
                {job.log.join("\n")}
              </pre>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-acid/25 bg-acid/[.06] px-4 py-3"
         role="status" aria-live="polite">
      <div className="flex items-center gap-3">
        <svg className="h-4 w-4 shrink-0 animate-spin text-acid" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" strokeWidth="2.5">
          <path d="M21 12a9 9 0 1 1-2.6-6.3" /><path d="M21 3v6h-6" />
        </svg>
        <p className="min-w-0 flex-1 truncate text-xs text-neutral-200">
          <span className="font-semibold uppercase tracking-[.08em] text-acid">
            {stageLabel(job.stage) || "working"}
          </span>
          {job.message && <span className="ml-2 text-neutral-400">{job.message}</span>}
        </p>
        <span className="shrink-0 text-xs font-semibold tabular-nums text-acid">
          {pct.toFixed(0)}%
        </span>
      </div>
      {/* A determinate bar, because the analyzer reports real per-stage progress (the architecture spec) and a
          spinner alone would throw that away — the slow stages are 2-4 and knowing you are 60%
          through pose is the difference between waiting and wondering. */}
      <div className="mt-2 h-[3px] overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-acid transition-[width] duration-500"
             style={{ width: `${busy ? pct : 100}%` }} />
      </div>
      <p className="mt-1.5 text-[10px] leading-4 text-neutral-500">
        Re-running the whole pipeline over the original clip — about 90 seconds. The page reloads
        when it finishes; leaving it does not stop the run.
      </p>
    </div>
  );
}
