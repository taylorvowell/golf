"use client";

import { useEffect, useRef, useState } from "react";
import type { Analysis } from "@/lib/swings";
import { SIDE_COLOR, TRACE_COLOR } from "@/lib/skeleton";
import { OVERLAY_GROUPS, type ToggleKey, type Toggles } from "@/lib/overlays";
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
  analysis, t, setT, cropAvailable, cropInfo, hasDetector,
  clubOptions, clubVar, onPickClub,
}: {
  analysis: Analysis;
  t: Toggles;
  setT: (k: ToggleKey, v: boolean) => void;
  cropAvailable: boolean;
  cropInfo: { cw: number; ch: number } | null;
  hasDetector: boolean;
  clubOptions: { key: string; label: string; cov?: Record<string, number> }[];
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

  const club = analysis.club;
  const traceLocked = !!club && !club.trace_enabled;

  const groups = OVERLAY_GROUPS.filter((g) =>
    g.needs === "club" ? !!club
    : g.needs === "detector" ? hasDetector
    : g.needs === "crop" ? cropAvailable
    : true);

  const nOn = groups.flatMap((g) => g.items).filter((i) => t[i.key]).length;

  const Row = ({ k, label, hint, disabled, why }: {
    k: ToggleKey; label: string; hint?: string; disabled?: boolean; why?: string;
  }) => (
    <button type="button" title={why} disabled={disabled}
      onClick={() => setT(k, !t[k])}
      className={`overlay-toggle${t[k] && !disabled ? " on" : ""}`}>
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
          {groups.map((g) => (
            <div key={g.title}>
              <p className="overlay-menu-head">{g.title}</p>
              {g.items.map((i) => (
                <Row key={i.key} k={i.key} label={i.label} hint={i.hint}
                  disabled={i.key === "trace" && traceLocked}
                  why={i.key === "trace" && traceLocked
                    ? `disabled — swing coverage ${((club?.coverage.swing ?? 0) * 100).toFixed(0)}% is below the 50% quality gate`
                    : i.key === "crop" && cropInfo
                    ? `shows ${(cropInfo.cw * 100).toFixed(0)}% × ${(cropInfo.ch * 100).toFixed(0)}% of the frame, ${(1 / cropInfo.ch).toFixed(2)}× bigger`
                    : undefined} />
              ))}
            </div>
          ))}

          {clubOptions.length > 1 && (
            <>
              <p className="overlay-menu-head">Club solution — click to compare</p>
              <div className="flex flex-col gap-1">
                {clubOptions.map((o) => {
                  const on = clubVar === o.key;
                  return (
                    <button key={o.key} type="button" onClick={() => onPickClub(o.key)}
                      title="Switch solution, show the club, and loop the swing"
                      className={`rounded-xl border px-2.5 py-2 text-left transition ${on
                        ? "border-acid/40 bg-acid/[.10] text-neutral-100"
                        : "border-white/[.07] bg-white/[.02] text-neutral-400 hover:border-white/20 hover:text-neutral-100"}`}>
                      <span className="block text-[12px] font-semibold leading-tight">{o.label}</span>
                      {o.cov && (
                        <span className={`text-[10px] tabular-nums ${on ? "text-acid/80" : "text-neutral-600"}`}>
                          coverage {(o.cov.backswing * 100).toFixed(0)}/
                          {(o.cov.downswing * 100).toFixed(0)}/
                          {(o.cov.followthrough * 100).toFixed(0)}%
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 px-1 text-[10px] leading-4 text-neutral-600">
                Same frames, same detections — only the solve differs, and switching redraws
                rather than re-analysing. Lower coverage is usually the <i>more</i> honest
                number: it counts measured frames, not interpolated ones.
              </p>
            </>
          )}

          <p className="overlay-menu-head">Legend</p>
          <div className="flex flex-wrap gap-x-3 gap-y-1.5 px-1 pb-1 text-[11px] text-neutral-400">
            <Dot c={SIDE_COLOR.L} l="left" /><Dot c={SIDE_COLOR.R} l="right" />
            <Dot c={SIDE_COLOR.M} l="spine" />
            {/* Read from TRACE_COLOR rather than repeated literals — a legend that disagrees
                with the overlay is worse than no legend. */}
            <Dot c={TRACE_COLOR.backswing} l="backswing" />
            <Dot c={TRACE_COLOR.downswing} l="downswing" />
            <Dot c={TRACE_COLOR.followthrough} l="through" />
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
          </div>
        </div>
      )}
    </div>
  );
}

function Dot({ c, l }: { c: string; l: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <i className="inline-block h-2 w-2 rounded-full" style={{ background: c }} />{l}
    </span>
  );
}
