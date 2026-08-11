"use client";

import { useEffect, useRef, useState } from "react";
import type { Analysis } from "@/lib/swings";
import { SIDE_COLOR, TRACE_COLOR } from "@/lib/skeleton";
import { BUILD_TAG, OVERLAY_GROUPS, type ToggleKey, type Toggles } from "@/lib/overlays";
import { MicroHead } from "./ui/kiosk";

/**
 * Overlay selection, as a dropdown hung off an icon in the video's top bar.
 *
 * It sits over the picture rather than beside it because that is where the decision is made:
 * you turn the trace on while looking at the swing, not while reading a settings column. The
 * old rail put eight checkboxes at the same visual weight as the pose-quality diagnostics,
 * which is the hierarchy problem the UI brief opens with (§8.1).
 *
 * The trigger stays lit while any non-default overlay is on, so the menu never hides state.
 */
export default function OverlayMenu({
  analysis, t, setT, cropAvailable, cropInfo, hasDetector, hasSilhouette, silhouetteLoading,
  onClearAll,
}: {
  analysis: Analysis;
  t: Toggles;
  setT: (k: ToggleKey, v: boolean) => void;
  cropAvailable: boolean;
  cropInfo: { cw: number; ch: number } | null;
  hasDetector: boolean;
  /** The swing has a stored per-frame outline. False hides the group rather than offering a
   * toggle that would draw nothing — the case CLAUDE.md calls indistinguishable from a bug. */
  hasSilhouette: boolean;
  /** Its (lazy, ~1 MB) fetch is in flight, so the toggle can say so instead of looking dead. */
  silhouetteLoading: boolean;
  /** Turn every overlay off in one go. Whole-set, not per-visible-group — see the button. */
  onClearAll: () => void;
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

  const club = analysis.club;
  const traceLocked = !!club && !club.trace_enabled;

  const butt = analysis.posture?.butt_line ?? null;

  const groups = OVERLAY_GROUPS.filter((g) =>
    g.needs === "club" ? !!club
    : g.needs === "detector" ? hasDetector
    : g.needs === "crop" ? cropAvailable
    : g.needs === "silhouette" ? hasSilhouette
    : g.needs === "posture" ? !!butt
    : true);

  const nOn = groups.flatMap((g) => g.items).filter((i) => t[i.key]).length;
  // Over the WHOLE set, not just the groups this swing shows. The toggles are shared across
  // the workspace, so a swing with no club data can arrive with `trace` still on from the
  // previous one — invisible here, but real, and "clear all" has to be able to reach it.
  const anyOn = Object.values(t).some(Boolean);

  return (
    <div ref={wrap} className="relative">
      {/* Icon only, and the same dark chrome as full-bleed beside it — a labelled, lit button
          made the picker read as a headline rather than as a control. The count dot is the only
          state it needs to show; the panel says the rest. */}
      <button type="button" onClick={() => setOpen((o) => !o)}
        aria-expanded={open} aria-haspopup="true" aria-label="Overlays"
        title="Choose what is drawn over the video"
        className={`relative grid h-10 w-10 place-items-center rounded-xl border bg-black/55
                    backdrop-blur transition ${open
            ? "border-white/30 text-white"
            : "border-white/10 text-neutral-300 hover:border-white/25"}`}>
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="m12 3 9 5-9 5-9-5 9-5Z" />
          <path d="m3 13 9 5 9-5" />
        </svg>
        {nOn > 0 && (
          <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full
                           bg-acid px-1 text-[9px] font-bold tabular-nums text-canvas">
            {nOn}
          </span>
        )}
      </button>

      {open && (
        <div className="overlay-menu glass scrollbar" role="menu">
          {/* Count on the left, reset on the right. The count is the same number as the dot on
              the trigger, spelled out — the dot says "something is on", this says what to
              expect from clearing it. */}
          <div className="overlay-menu-bar">
            <span className="text-[9px] font-bold uppercase tracking-[.18em] text-neutral-500">
              {nOn === 0 ? "No overlays on" : `${nOn} overlay${nOn === 1 ? "" : "s"} on`}
            </span>
            {/* Enabled on `anyOn`, not on the visible count above — see its comment. */}
            <button type="button" onClick={onClearAll} disabled={!anyOn}
              title="Turn every overlay off"
              className="overlay-menu-clear">
              Clear all
            </button>
          </div>

          {groups.map((g) => (
            <div key={g.title}>
              <p className="overlay-menu-head">{g.title}</p>
              {g.items.map((i) => (
                <OverlayRow key={i.key} on={t[i.key]} onToggle={() => setT(i.key, !t[i.key])}
                  label={i.label} hint={i.hint}
                  disabled={i.key === "trace" && traceLocked}
                  why={i.key === "trace" && traceLocked
                    ? `disabled — swing coverage ${((club?.coverage.swing ?? 0) * 100).toFixed(0)}% is below the 50% quality gate`
                    : i.key === "crop" && cropInfo
                    ? `shows ${(cropInfo.cw * 100).toFixed(0)}% × ${(cropInfo.ch * 100).toFixed(0)}% of the frame, ${(1 / cropInfo.ch).toFixed(2)}× bigger`
                    : (i.key === "isolate" || i.key === "outline") && silhouetteLoading
                    ? "loading the outline…"
                    // Confidence is how still the setup was. A wandering address makes the
                    // "locked" line a median of several postures, and saying so is the
                    // difference between a reference and a red line of unknown provenance.
                    : i.key === "butt" && butt
                    ? `locked at frame ${butt.frame} · ${butt.conf < 0.7 ? "low confidence — " : ""}the seat moved ${(butt.spread_bh * 100).toFixed(1)}% of body height across the address hold`
                    : undefined} />
              ))}
            </div>
          ))}

          {/* The club-solution and trace-smoothing comparison pickers moved to the Debug
              Menu (user directive 2026-08-08): they are engineering comparisons, and this
              menu stays a viewer control. */}

          <p className="overlay-menu-head">Legend</p>
          <div className="flex flex-wrap gap-x-3 gap-y-1.5 px-1 pb-1 text-[11px] text-neutral-400">
            <Dot c={SIDE_COLOR.L} l="left" /><Dot c={SIDE_COLOR.R} l="right" />
            <Dot c={SIDE_COLOR.M} l="spine" />
            {/* Read from TRACE_COLOR rather than repeated literals — a legend that disagrees
                with the overlay is worse than no legend. */}
            <Dot c={TRACE_COLOR.backswing} l="backswing" />
            <Dot c={TRACE_COLOR.downswing} l="downswing" />
            {/* Hidden while the follow-through paints at zero alpha — a label beside an
                invisible dot reads as a broken legend, not as an intentionally off phase. */}
            {!/,\s*0\)$/.test(TRACE_COLOR.followthrough) && (
              <Dot c={TRACE_COLOR.followthrough} l="through" />
            )}
          </div>
          {hasDetector && t.rawDet && (
            <p className="mt-1 px-1 text-[10px] leading-4 text-neutral-600">
              <span className="text-rose-400">red</span> = club head,{" "}
              <span className="text-green-400">green</span> = shaft. Independent of every
              other overlay.
            </p>
          )}

          <div className="mt-3 border-t border-white/[.07] pt-2">
            <MicroHead>Keyboard</MicroHead>
            <p className="mt-1 text-[10px] leading-4 text-neutral-600">
              ← → step a frame · shift ×10 · space play/pause · click a phase to loop it
            </p>
            {/* Which build is actually running. HMR can leave a stale bundle behind, and this
                is the difference between "the fix did not work" and "the fix is not loaded". */}
            <p className="mt-2 text-[10px] leading-4 text-neutral-700">build {BUILD_TAG}</p>
          </div>
        </div>
      )}
    </div>
  );
}

interface OverlayRowProps {
  label: string;
  hint?: string;
  on: boolean;
  onToggle: () => void;
  disabled?: boolean;
  /** Replaces the hint when the row's state needs explaining (locked, loading, low confidence). */
  why?: string;
}

/**
 * One overlay row.
 *
 * **Module scope, deliberately — this was a bug.** It used to be declared inside `OverlayMenu`,
 * which made it a new component *type* on every render: React then unmounted and remounted every
 * row rather than updating it. During playback the workspace re-renders on every presented video
 * frame (~60/s), so a row's `<button>` was routinely destroyed between the mousedown and the
 * mouseup of a single click — and a click whose press and release land on different elements
 * fires no `click` event at all. The symptom was exactly that: overlays could only be switched
 * while the video was PAUSED. Hoisted, the element type is stable and the row is updated in
 * place, so a click lands mid-playback like any other.
 */
function OverlayRow({ label, hint, on, onToggle, disabled, why }: OverlayRowProps) {
  return (
    <button type="button" title={why} disabled={disabled} onClick={onToggle}
      className={`overlay-toggle${on && !disabled ? " on" : ""}`}>
      <span className="overlay-check" aria-hidden>✓</span>
      <span className="min-w-0">
        <span className="block leading-tight">{label}</span>
        {(why ?? hint) && (
          <span className="mt-0.5 block text-[10px] font-normal leading-3 text-neutral-500">
            {why ?? hint}
          </span>
        )}
      </span>
    </button>
  );
}

function Dot({ c, l }: { c: string; l: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <i className="inline-block h-2 w-2 rounded-full" style={{ background: c }} />{l}
    </span>
  );
}
