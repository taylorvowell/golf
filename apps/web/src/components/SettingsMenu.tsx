"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The gear beside full-bleed — things you *do to the analysis*, as opposed to the overlay
 * menu's things you *draw over it*.
 *
 * Head-marker editing lives here rather than as its own button under the picture: it is a rare,
 * deliberate action, and a permanently visible "Modify head markers" control sat at the same
 * weight as the transport for something most viewings never touch. The editing strip still
 * appears under the frame once the mode is on — that one *is* frame-by-frame work and wants to
 * be in reach.
 *
 * Re-analysis is the same shape of action and now sits beside it. It does NOT report progress
 * here: the menu closes on the click that starts it, and a 90-second run needs somewhere on the
 * page that outlives the dropdown — `ReanalyzeProgress`, at the top of the workspace.
 */
export default function SettingsMenu({ editing, onEditHeads, reanalyze }: {
  /** Marker editing is currently on — the row reads as a toggle, because it is one. */
  editing: boolean;
  onEditHeads: () => void;
  /** The shared re-analysis job. Absent on a swing with no source clip to re-run. */
  reanalyze?: { busy: boolean; pct: number; start: () => void };
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  // Same click-away + Escape contract as the overlay menu next to it. Two dropdowns in one
  // corner that dismiss differently is the kind of small inconsistency that reads as a bug.
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

  return (
    <div ref={wrap} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)}
        aria-expanded={open} aria-haspopup="true" aria-label="Settings"
        title="Correction and analysis tools"
        className={`relative grid h-10 w-10 place-items-center rounded-xl border bg-black/55
                    backdrop-blur transition ${open || editing
            ? "border-white/30 text-white"
            : "border-white/10 text-neutral-300 hover:border-white/25"}`}>
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
        </svg>
        {/* A dot, not a count: the gear has one stateful entry and "1" would read as a tally. */}
        {editing && (
          <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-emerald-400" />
        )}
      </button>

      {open && (
        <div className="overlay-menu glass scrollbar" role="menu">
          <p className="overlay-menu-head">Corrections</p>
          {/* A button, not a checkbox. The overlay menu above it is a set of toggles you flip on
              and off from the same place; this one starts a mode you leave from the editing
              strip's own Done. Borrowing `.overlay-toggle` for its geometry and hover, without
              the check square or the lit `on` state that would make it read as another toggle. */}
          <button type="button" role="menuitem"
            onClick={() => { onEditHeads(); setOpen(false); }}
            className="overlay-toggle">
            <span className="min-w-0">
              <span className="block leading-tight">Modify head markers</span>
              <span className="mt-0.5 block text-[10px] font-normal leading-3 text-neutral-500">
                drag the club head frame by frame where the detector got it wrong
              </span>
            </span>
          </button>

          {reanalyze && (
            <>
              <p className="overlay-menu-head">Analysis</p>
              <button type="button" disabled={reanalyze.busy}
                onClick={() => { reanalyze.start(); setOpen(false); }}
                className="overlay-toggle disabled:cursor-not-allowed disabled:opacity-60">
                <span className="overlay-check" aria-hidden>
                  <svg className={`h-3 w-3 ${reanalyze.busy ? "animate-spin" : ""}`}
                       viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M21 12a9 9 0 1 1-2.6-6.3" /><path d="M21 3v6h-6" />
                  </svg>
                </span>
                <span className="min-w-0">
                  <span className="block leading-tight">
                    {reanalyze.busy ? `Re-analyzing… ${reanalyze.pct.toFixed(0)}%` : "Re-analyze"}
                  </span>
                  <span className="mt-0.5 block text-[10px] font-normal leading-3 text-neutral-500">
                    {reanalyze.busy
                      ? "progress is at the top of the page"
                      : "re-run the pipeline over the original clip (~90s)"}
                  </span>
                </span>
              </button>
              <p className="mt-1 px-1 text-[10px] leading-4 text-neutral-600">
                Editing <code>swingsage/</code> does not change a stored{" "}
                <code>analysis.json</code> — the player keeps drawing the old artifact until the
                analyzer re-runs. Hand-placed markers survive it.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
