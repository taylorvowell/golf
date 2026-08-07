"use client";

import { memo, useEffect, useState } from "react";
import type { HeadMarkers } from "@/lib/useHeadMarkers";
import { STAGES, stageLabel, type Stage, type SwingStages } from "@/lib/useSwingStages";

/** One frame of the clip, and what is known about its club head. Built by `SwingStage`'s
 * `headPoints`. `x`/`y` are the hand-placed head if there is one, else the analyzer's tracked
 * one, else null — a frame can have neither. */
export interface HeadPoint {
  frame: number;
  x: number | null;
  y: number | null;
  /** A head you placed by hand. */
  manual: boolean;
  /** The analyzer solved a head here. */
  tracked: boolean;
  /** Placed, moved or cleared since the last save — the edit only exists in this browser. */
  unsaved: boolean;
  /** Inside `playback_window` — outside it, this frame is reachable from the editor but not
   * from the transport. */
  inWindow: boolean;
  /** One of the eight detected events, e.g. "top" or "mid downswing" — the analyzer's answer. */
  event?: string;
  /** A stage pinned to this frame by hand, which overrides the analyzer's. */
  stage?: Stage;
}

/**
 * The "modify head markers" control strip.
 *
 * Correcting a club head is a frame-by-frame job on a swing where the detector had nothing to
 * say, so the controls that matter are step-one-frame and place — not another panel of options.
 * It sits under the picture rather than over it: at impact the head is at the bottom of the
 * frame, which is exactly where a floating toolbar would be, and it would cover the thing being
 * corrected.
 *
 * Renders nothing until the mode is on. Entering it is the settings gear's job (`SettingsMenu`),
 * so nothing about this rare, deliberate correction workflow occupies the player until asked
 * for.
 */
export default function HeadMarkerBar({
  markers, stages, frame, seek, points, hasMark, unsaved,
}: {
  markers: HeadMarkers;
  /** Hand-corrected swing-stage keyframes — the list's per-row stage picker writes to these. */
  stages: SwingStages;
  frame: number;
  seek: (f: number) => void;
  /** Every correctable frame, in frame order — the analyzer's tracked head per frame, with any
   * hand-placed head replacing it. Built in `SwingStage`; see `headPoints` there. */
  points: HeadPoint[];
  /** Whether this frame already carries a hand-placed head. */
  hasMark: boolean;
  /** Frames edited since the last save. */
  unsaved: number;
}) {
  const { editing, setEditing, clear, save, saving, error } = markers;

  // Arrow keys step one frame while editing. Deliberately not shift-for-ten like the transport:
  // this mode exists to work one frame at a time, and a ten-frame jump from the same key is a
  // way to lose your place in a stretch you are halfway through correcting.
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (e.key === "ArrowLeft") { e.preventDefault(); seek(frame - 1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); seek(frame + 1); }
      else if (e.key === "Backspace" || e.key === "Delete") { e.preventDefault(); clear(frame); }
      else if (e.key === "s" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, frame, seek, clear, save]);

  // Leaving with edits in hand is the one way to lose work here, so say so.
  useEffect(() => {
    if (!unsaved) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);

  if (!editing) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-emerald-400/25
                    bg-emerald-400/[.06] px-3 py-2 text-[11px] text-neutral-300">
      <span className="font-semibold uppercase tracking-[.08em] text-emerald-300">
        Editing heads
      </span>
      <span className="text-neutral-500">
        drag the marker to move it · click elsewhere to place · ←/→ step a frame · del clears
      </span>

      <div className="ml-auto flex items-center gap-1.5">
        <Step label="◀" onClick={() => seek(frame - 1)} title="Previous frame" />
        <span className="w-16 text-center font-mono text-neutral-400">f{frame}</span>
        <Step label="▶" onClick={() => seek(frame + 1)} title="Next frame" />

        <button type="button" onClick={() => clear(frame)} disabled={!hasMark}
          className="rounded-lg border border-white/10 px-2.5 py-1 hover:border-white/25
                     disabled:cursor-not-allowed disabled:opacity-35">
          Clear
        </button>
        <button type="button" onClick={save} disabled={!unsaved || saving}
          className="rounded-lg border border-emerald-400/40 bg-emerald-400/15 px-2.5 py-1
                     font-semibold text-emerald-200 hover:bg-emerald-400/25
                     disabled:cursor-not-allowed disabled:opacity-35">
          {saving ? "Saving…" : unsaved ? `Save ${unsaved}` : "Saved"}
        </button>
        <button type="button" onClick={() => setEditing(false)}
          className="rounded-lg border border-white/10 px-2.5 py-1 hover:border-white/25">
          Done
        </button>
      </div>
      {!!unsaved && <span className="w-full text-amber-400/90">{unsaved} unsaved</span>}
      {error && <span className="w-full text-rose-400">{error}</span>}

      <MarkerList markers={markers} stages={stages} frame={frame} seek={seek} points={points} />
    </div>
  );
}

/**
 * Every hand-placed head, one row per frame, in frame order.
 *
 * The list is the tracked path, not a log of what you have touched. The analyzer already solves
 * a club head on every frame, so a list that started empty and grew as you clicked would be an
 * index of your own edits — useless for the actual job, which is to walk what is already there
 * and fix the frames where it is wrong. Every correctable frame gets a row from the start;
 * `manual` is what marks the ones you have since corrected.
 *
 * Clicking a row seeks to it, which puts that head under the crosshair ready to nudge.
 *
 * It is a jump list, not an editor: the position itself is only ever changed by dragging it on
 * the picture, where you can see the club head you are matching. Typing coordinates at a club
 * head you cannot see is not a thing anyone can do accurately.
 */
function MarkerList({ markers, stages, frame, seek, points }: {
  markers: HeadMarkers;
  stages: SwingStages;
  frame: number;
  seek: (f: number) => void;
  points: HeadPoint[];
}) {
  const edited = points.reduce((n, p) => n + (p.manual ? 1 : 0), 0);
  const withHead = points.reduce((n, p) => n + (p.x !== null ? 1 : 0), 0);
  const unsavedCount = points.reduce((n, p) => n + (p.unsaved ? 1 : 0), 0);

  if (!points.length) return null;

  return (
    <div className="w-full">
      <p className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase
                    tracking-[.12em] text-neutral-500">
        <span>{points.length} frames</span>
        {/* A legend, because the dot carries two independent facts and neither is guessable. */}
        <span className="flex items-center gap-1 text-emerald-300/80">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          {withHead} with head
        </span>
        {unsavedCount > 0 && (
          <span className="flex items-center gap-1 text-acid">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-acid" />
            {unsavedCount} unsaved
          </span>
        )}
        {edited > 0 && <span className="text-neutral-600">{edited} hand-placed</span>}
        {/* The one destructive action in the editor, so it is a word and not an icon, and it
            only exists once there is something to undo. */}
        {edited > 0 && (
          <button type="button" onClick={() => markers.clearAll()}
            title="Remove every hand-placed head on this swing"
            className="ml-auto rounded-lg border border-white/10 px-2 py-0.5 text-[9px]
                       tracking-[.12em] text-neutral-400 hover:border-rose-400/40
                       hover:text-rose-300">
            Clear all
          </button>
        )}
      </p>
      {/* Capped and scrolled: this is every frame of the swing, so an uncapped list would push
          the picture off the screen — which is the thing being corrected. The row for the frame
          you are on scrolls itself into view, so stepping with ←/→ keeps the list tracking the
          picture instead of leaving you to hunt for your place in it. */}
      <ul className="scrollbar max-h-72 divide-y divide-white/[.06] overflow-y-auto rounded-xl
                     border border-white/[.07] bg-black/20">
        {points.map((p) => (
          <Row key={p.frame} p={p} here={p.frame === frame} seek={seek}
            clear={markers.clear} setStage={stages.set} />
        ))}
      </ul>
    </div>
  );
}

/**
 * Memoized per row. The list is now every frame of the swing — hundreds of rows — and the only
 * thing that changes as the playhead moves is which single row is `here`. Without this, every
 * row re-renders on every frame step and on every pixel of a drag.
 */
const Row = memo(function Row({ p, here, seek, clear, setStage }: {
  p: HeadPoint;
  here: boolean;
  seek: (f: number) => void;
  clear: (f: number) => void;
  setStage: (stage: Stage, frame: number | null) => void;
}) {
  return (
    <li ref={here ? scrollIntoView : undefined}
      className={`group/row flex items-center ${here ? "bg-emerald-400/15" : ""}`}>
      {/* The row itself is the jump target — a small "go to" affordance beside the number would
          be a second thing to hit for the action the row already implies. */}
      <button type="button" onClick={() => seek(p.frame)}
        title={`Jump to frame ${p.frame}`}
        className={`flex min-w-0 flex-1 items-baseline gap-2.5 px-2.5 py-1.5 text-left
                    ${here ? "text-emerald-200" : "text-neutral-300 hover:text-white"}`}>
        {/* Three states, and the question each answers is different.
            GREEN — there is a head on this frame, whoever put it there. That is the one that
            matters when you are scanning for gaps in the track.
            BLUE — you placed, moved or cleared it and it is not saved yet. It overrides green,
            because "will this survive a reload" is the more urgent thing to know about a row.
            HOLLOW GREY — no head here at all. */}
        <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full border
                                     ${p.unsaved ? "border-acid bg-acid"
                                     : p.x !== null ? "border-emerald-400 bg-emerald-400"
                                     : "border-white/15"}`} />
        <span className={`font-mono tabular-nums ${p.inWindow ? "" : "text-neutral-500"}`}>
          f{p.frame}
        </span>
        {/* Where the head sits in the frame, 0–1. Not editable — the position is only ever
            changed by dragging it over the picture, where the club head is visible. It earns its
            place by making an outlier obvious in the list. */}
        <span className="truncate font-mono text-[10px] tabular-nums text-neutral-600">
          {p.x !== null && p.y !== null ? `${p.x.toFixed(3)}, ${p.y.toFixed(3)}` : "no head"}
        </span>
        {/* The named moments, so the list can be navigated by the swing rather than by counting
            frames — "the one at the top" is how anyone actually thinks about where to look.
            A hand-pinned stage is called out as such: it is the one thing on the row that
            disagrees with what the analyzer decided. */}
        {(p.stage ?? p.event) && (
          <span className={`ml-auto shrink-0 rounded px-1 text-[9px] uppercase tracking-[.1em]
                           ${p.stage ? "bg-violet/15 text-violet" : "text-acid/80"}`}>
            {p.stage ? stageLabel(p.stage) : p.event}
          </span>
        )}
      </button>
      <StagePicker frame={p.frame} stage={p.stage} setStage={setStage} />

      {/* Clear reverts this frame to the analyzer's tracked position. Present on every row so
          the column is straight and the control is where you expect it, but disabled where
          there is nothing of yours to clear. */}
      <button type="button" onClick={() => clear(p.frame)} disabled={!p.manual}
        title={p.manual ? `Clear the head you placed on frame ${p.frame}` : "Nothing to clear"}
        aria-label={`Clear the hand-placed head on frame ${p.frame}`}
        className="mr-1 grid h-6 w-6 shrink-0 place-items-center rounded-lg text-neutral-600
                   hover:bg-rose-400/20 hover:text-rose-300 disabled:pointer-events-none
                   disabled:opacity-0">
        ×
      </button>
    </li>
  );
});

/**
 * Mark this frame as a point of the swing.
 *
 * Hidden until the row is hovered (or the frame carries a stage, or the menu is open), because
 * most frames are not a stage and 396 permanently visible icons would be noise on top of the
 * thing the list is actually for.
 *
 * Picking a stage that is already somewhere else MOVES it — the old frame loses it. That rule is
 * the database's unique index on (swing, stage) rather than anything here; a swing has one top,
 * so there is no state in which two frames claim it.
 */
function StagePicker({ frame, stage, setStage }: {
  frame: number;
  stage?: Stage;
  setStage: (stage: Stage, frame: number | null) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <span className="relative shrink-0">
      {/* Always present, never hover-revealed. A control that only exists once the pointer is
          over the row is one you have to already know about to find, and on a 396-row list that
          also made the rows twitch as the pointer crossed them. Subtle when empty — which is
          almost every row — and a filled, bordered square once the frame carries a stage.
          Square rather than a bare glyph so there is a real target to hit: the icon itself is
          14px, the button is 26. */}
      <button type="button" onClick={() => setOpen((o) => !o)}
        aria-haspopup="true" aria-expanded={open}
        title={stage ? `${stageLabel(stage)} — click to change` : "Mark this frame as a swing stage"}
        aria-label={`Swing stage for frame ${frame}`}
        className={`grid h-[26px] w-[26px] place-items-center rounded-md border transition
                    ${stage || open
                      ? "border-violet/50 bg-violet/15 text-violet"
                      : "border-white/[.07] text-neutral-700 hover:border-violet/40 hover:bg-violet/10 hover:text-violet group-hover/row:border-white/15"}`}>
        {/* A keyframe diamond — the shape timelines everywhere use for "a marked point in
            time", which is exactly what this is. Hollow until the frame is one. */}
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill={stage ? "currentColor" : "none"}
             stroke="currentColor" strokeWidth="2">
          <path d="M12 3 21 12 12 21 3 12Z" />
        </svg>
      </button>
      {open && (
        <>
          <button type="button" aria-hidden tabIndex={-1}
            className="fixed inset-0 z-40 cursor-default" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-1 w-44 overflow-hidden rounded-xl border
                          border-line bg-[#12141b] py-1 shadow-2xl" role="menu">
            <p className="px-2.5 py-1 text-[9px] font-bold uppercase tracking-[.14em]
                          text-neutral-600">
              Swing stage · f{frame}
            </p>
            {/* "None" first and always present: clearing is the correction you make most often
                after a mis-click, and hunting for it under eight stages would be silly. */}
            <button type="button" role="menuitem"
              onClick={() => { if (stage) setStage(stage, null); setOpen(false); }}
              className={`flex w-full items-center px-2.5 py-1.5 text-left text-[11px]
                          hover:bg-white/[.06] ${stage ? "text-neutral-400" : "text-violet"}`}>
              None
            </button>
            {STAGES.map((s) => (
              <button key={s} type="button" role="menuitem"
                onClick={() => { setStage(s, frame); setOpen(false); }}
                className={`flex w-full items-center px-2.5 py-1.5 text-left text-[11px]
                            hover:bg-white/[.06] ${s === stage ? "text-violet" : "text-neutral-300"}`}>
                {stageLabel(s)}
              </button>
            ))}
          </div>
        </>
      )}
    </span>
  );
}

/** Keeps the current frame's row visible as ←/→ walks the list past the scroll edge. */
function scrollIntoView(el: HTMLLIElement | null) {
  el?.scrollIntoView({ block: "nearest" });
}

function Step({ label, onClick, title }: { label: string; onClick: () => void; title: string }) {
  return (
    <button type="button" onClick={onClick} title={title}
      className="grid h-7 w-7 place-items-center rounded-lg border border-white/10
                 text-neutral-300 hover:border-white/25 hover:text-white">
      {label}
    </button>
  );
}
