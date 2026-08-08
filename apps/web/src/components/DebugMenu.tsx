"use client";

import { useEffect, useRef, useState } from "react";
import ReanalyzeButton from "./ReanalyzeButton";
import type { Reanalyze } from "@/lib/useReanalyze";
import { SMOOTHING_OPTIONS, type SmoothingKey } from "@/lib/traceSmoothing";
import type { ClubVariantOption } from "@/lib/clubVariants";

/**
 * Developer actions, off the main chrome.
 *
 * Re-analysis is a pipeline operation, not something a golfer reviewing a swing does — it sat
 * in the workspace bar next to "Swing Log" and "New Swing" purely because that was the only
 * row of buttons that existed. A floating, sticky corner keeps it one click away without
 * putting a 90-second Python job at the same weight as the product's own actions.
 *
 * It also holds the two club-trace comparisons — which solve, and how the line is smoothed.
 * They are engineering choices, so they live here rather than in the video's overlay menu,
 * which stays a viewer control.
 */
export default function DebugMenu({ id, reanalyze, smoothing, onPickSmoothing,
                                    clubOptions, clubVar, onPickClub }: {
  id: string;
  /** The page's shared re-analysis job — the same one the video's settings menu starts. */
  reanalyze: Reanalyze;
  /** Trace smoothing — render-time only, nothing is re-analysed. */
  smoothing: SmoothingKey;
  onPickSmoothing: (k: SmoothingKey) => void;
  /** Club solutions stored in the artifact. Picking one also turns the club+trace overlays
   * on and loops the swing, because a still frame is the worst way to compare solves. */
  clubOptions: ClubVariantOption[];
  clubVar: string;
  onPickClub: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pickBtn = (on: boolean) =>
    `w-full rounded-xl border px-2.5 py-1.5 text-left text-[11px] font-semibold transition ${
      on
        ? "border-acid/40 bg-acid/[.10] text-neutral-100"
        : "border-white/[.07] bg-white/[.02] text-neutral-400 hover:border-white/20 hover:text-neutral-100"}`;

  return (
    <div ref={wrap} className="fixed bottom-5 right-5 z-[130] flex flex-col items-end gap-3">
      {open && (
        <div className="glass w-[320px] max-h-[min(75vh,700px)] overflow-y-auto overscroll-contain
                        rounded-[22px] border border-white/10 p-4
                        shadow-[0_30px_90px_rgba(0,0,0,.55)]">
          <p className="text-[9px] font-bold uppercase tracking-[.18em] text-neutral-600">Debug</p>

          {clubOptions.length > 1 && (
            <>
              <p className="mt-3 text-[9px] font-bold uppercase tracking-[.18em] text-neutral-600">
                Club solution
              </p>
              <div className="mt-2 space-y-1">
                {clubOptions.map((o) => (
                  <button key={o.key} type="button" onClick={() => onPickClub(o.key)}
                          title="Switch solution, show the club, and loop the swing"
                          className={pickBtn(clubVar === o.key)}>
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate">{o.label}</span>
                      {o.cov && (
                        <span className="shrink-0 text-[9px] tabular-nums text-neutral-600">
                          {(o.cov.backswing * 100).toFixed(0)}/
                          {(o.cov.downswing * 100).toFixed(0)}/
                          {(o.cov.followthrough * 100).toFixed(0)}%
                        </span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}

          <p className="mt-3 text-[9px] font-bold uppercase tracking-[.18em] text-neutral-600">
            Trace smoothing
          </p>
          <div className="mt-2 space-y-1">
            {SMOOTHING_OPTIONS.map((o) => (
              <button key={o.key} type="button"
                      onClick={() => onPickSmoothing(o.key)}
                      title={o.hint}
                      className={pickBtn(smoothing === o.key)}>
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate">{o.label}</span>
                  <span className="shrink-0 text-[9px] uppercase text-neutral-600">
                    {o.strength}
                  </span>
                </span>
              </button>
            ))}
          </div>

          <div className="mt-3 border-t border-white/[.06] pt-3">
            <div className="flex justify-start">
              <ReanalyzeButton r={reanalyze} />
            </div>

            <a href={`/api/swings/${id}/analysis`} target="_blank" rel="noreferrer"
               className="mt-3 flex items-center gap-2 rounded-xl border border-line bg-raised px-3 py-2.5
                          text-[11px] font-semibold text-neutral-400 hover:border-white/25 hover:text-neutral-100">
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 3h7v7" /><path d="M10 14 21 3" />
                <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
              </svg>
              Open raw analysis.json
            </a>

            <p className="mt-3 text-[10px] leading-4 text-neutral-600">
              Pose, club, face and sync diagnostics are in the <b className="text-neutral-500">Advanced
              Stats</b> tab.
            </p>
          </div>
        </div>
      )}

      <button type="button" onClick={() => setOpen((o) => !o)}
        aria-expanded={open} title="Debug tools"
        className={`grid h-12 w-12 place-items-center rounded-full border shadow-[0_16px_40px_rgba(0,0,0,.5)]
                    backdrop-blur transition ${open
          ? "border-acid/45 bg-acid/15 text-acid"
          : "border-white/12 bg-[#11141a]/90 text-neutral-400 hover:border-white/30 hover:text-neutral-100"}`}>
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
          <path d="M8 7a4 4 0 0 1 8 0v1H8V7Z" />
          <path d="M5 12h14M6 8h12v6a6 6 0 0 1-12 0V8Z" />
          <path d="M3 9v2M21 9v2M4 17l3-1.6M20 17l-3-1.6" />
        </svg>
      </button>
    </div>
  );
}
