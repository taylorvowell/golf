"use client";

import { useEffect, useState } from "react";
import type { SwingSummary } from "@/lib/swings";
import type { ReferenceSwing } from "@/lib/proSwings";

/**
 * "Compare Swing" — laid over the top-right of the video, beside the overlay and full-bleed
 * controls, because that is where the other things you *do to the picture* live.
 */
export function CompareButton({ enabled, onToggle }: {
  enabled: boolean;
  onToggle: (on: boolean) => void;
}) {
  return (
    <button type="button" onClick={() => onToggle(!enabled)} aria-pressed={enabled}
      title={enabled ? "Hide the comparison video" : "Show a swing side by side"}
      className={`flex h-10 items-center gap-2 rounded-xl border px-3 text-[11px] font-bold
                  uppercase tracking-[.12em] backdrop-blur transition
                  ${enabled
                    ? "border-acid/60 bg-acid/20 text-acid shadow-[0_0_0_1px_rgba(94,208,255,.3)]"
                    : "border-white/25 bg-black/80 text-white hover:border-acid/50 hover:text-acid"}`}>
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="2" y="5" width="8.5" height="14" rx="1.5" />
        <rect x="13.5" y="5" width="8.5" height="14" rx="1.5" />
      </svg>
      Compare Swing
    </button>
  );
}

/**
 * Which swing is being compared against, as a dropdown. Doubles as the reference pane's label,
 * so that corner of the picture carries one control rather than a caption plus a menu.
 *
 * The swing list is fetched lazily on first open rather than passed down: the swing page's own
 * props carry only the ids either side of this one (for the prev/next links), and a comparison
 * wants the whole log.
 */
export function SourcePicker({ sourceId, onPickSource, currentId, references }: {
  sourceId: string;
  onPickSource: (id: string) => void;
  /** The swing being studied — never offered as its own comparison. */
  currentId: string;
  /**
   * The bundled model swings, resolved to real ids server-side. Passed in rather than imported:
   * since migration 0006 which row is a reference is a database fact, and a client component
   * cannot know it without being told.
   */
  references: ReferenceSwing[];
}) {
  const [swings, setSwings] = useState<SwingSummary[] | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open || swings) return;
    let cancelled = false;
    fetch("/api/swings")
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setSwings(d.swings ?? []); })
      .catch(() => { if (!cancelled) setSwings([]); });
    return () => { cancelled = true; };
  }, [open, swings]);

  const others = (swings ?? []).filter((s) => s.id !== currentId && !s.referenceLabel);
  const label = references.find((r) => r.id === sourceId)?.label
    ?? (swings ?? []).find((s) => s.id === sourceId)?.label
    ?? "Reference";

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="flex h-9 items-center gap-1.5 rounded-xl border border-white/20 bg-black/65 px-2.5
                   text-[10px] font-bold uppercase tracking-[.14em] text-neutral-100 backdrop-blur
                   hover:border-white/40">
        <span className="max-w-32 truncate">{label}</span>
        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <>
          {/* Click-away catcher. A menu that only closes via its own trigger reads as stuck. */}
          <button type="button" aria-hidden tabIndex={-1}
            className="fixed inset-0 z-40 cursor-default" onClick={() => setOpen(false)} />
          <div className="absolute left-0 z-50 mt-2 w-60 overflow-hidden rounded-2xl border
                          border-line bg-[#12141b] shadow-2xl">
            {references.map((p) => (
              <MenuItem key={p.id} label={p.label} hint="Reference"
                active={sourceId === p.id}
                onClick={() => { onPickSource(p.id); setOpen(false); }} />
            ))}
            <div className="border-t border-line px-3 py-1.5 text-[9px] font-bold uppercase
                            tracking-[.16em] text-neutral-600">
              Your swings
            </div>
            {swings === null && <p className="px-3 py-2 text-[11px] text-neutral-500">Loading…</p>}
            {swings !== null && !others.length && (
              <p className="px-3 py-2 text-[11px] text-neutral-500">No other analysed swings yet.</p>
            )}
            {others.map((s) => (
              <MenuItem key={s.id} label={s.label}
                hint={s.overallScore !== null ? `Score ${Math.round(s.overallScore)}` : "Not scored"}
                active={sourceId === s.id}
                onClick={() => { onPickSource(s.id); setOpen(false); }} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function MenuItem({ label, hint, active, onClick }: {
  label: string; hint: string; active: boolean; onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick}
      className={`flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left
                  transition hover:bg-white/[.05] ${active ? "bg-acid/[.08]" : ""}`}>
      <span className={`truncate text-[12px] font-semibold ${active ? "text-acid" : "text-neutral-200"}`}>
        {label}
      </span>
      <span className="shrink-0 text-[9px] uppercase tracking-[.12em] text-neutral-600">{hint}</span>
    </button>
  );
}
