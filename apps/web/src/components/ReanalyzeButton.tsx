"use client";

import type { Reanalyze } from "@/lib/useReanalyze";

/**
 * Starts a re-analysis. Presentational only: the job is owned by the page (`useReanalyze`) and
 * reported by `ReanalyzeProgress`, so this and the settings-menu row drive one run rather than
 * two independent pollers with two opinions about it.
 *
 * The point of `analysis.json` being a stored artifact (the architecture spec) is that an improved model can be
 * re-run over swings already filmed. Editing `swingsage/` does not change a stored analysis —
 * the player keeps drawing the old artifact until something re-runs the analyzer, which is the
 * usual reason a pipeline change "doesn't show up".
 */
export default function ReanalyzeButton({ r }: { r: Reanalyze }) {
  const { busy, pct, start, job } = r;
  return (
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
  );
}
