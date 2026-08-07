"use client";

import { useMemo, useRef } from "react";
import type { Player } from "@/lib/usePlayer";
import { phaseSegments, type PhaseFrames } from "@/lib/swingPhases";

const SPEEDS = [0.1, 0.25, 0.5, 1];

/**
 * The scrub strip and transport buttons, lifted out of `SwingStage`.
 *
 * Separate from the picture so that side-by-side comparison has **one** control driving both
 * videos rather than a control per pane. That was the point of the split: two scrubbers with a
 * lock between them made the relationship a thing to manage; one scrubber makes it a fact.
 * The reference follows by pose alignment (see `lib/swingSync.ts`), so there is nothing for a
 * second transport to do that this one doesn't already say.
 *
 * Everything here drives the USER's player. The comparison pane never has its own transport.
 */
export default function SwingTransport({ player, phases }: {
  player: Player;
  /** The corrected phase boundaries. The strip is the main place a correction shows, so it reads
   * these rather than `analysis.phases` — that list is fixed at whatever the analyzer decided. */
  phases?: PhaseFrames | null;
}) {
  const { videoRef, frame, playing, speed, setSpeed, loop, looping, setLooping,
          seek, jumpTo, toggle, fps, win } = player;
  const [w0, w1] = win;

  /**
   * Scrub segments. The sample hardcodes six proportional blocks; these are the real spans
   * between events, plus the approach and the held finish so the segments cover exactly the
   * playable window the cursor is positioned against.
   */
  /**
   * Scrub segments: the five parts of a swing, from the corrected boundaries.
   *
   * Built from `lib/swingPhases.ts` rather than from `analysis.phases`, which is the analyzer's
   * own eight-event split and cannot move. Five segments rather than eight because these are the
   * spans a golfer names — approach, backswing, downswing, follow through, finish — and each one
   * is a thing the picture looks different during.
   *
   * Impact no longer gets a carved-out sliver of its own: it is the boundary between downswing
   * and follow through, so it is already on the strip as the edge between those two, and a
   * four-frame segment between them was a click target for something that is an instant.
   */
  const segments = useMemo(() => {
    if (!phases) return null;
    const out = phaseSegments(phases, [w0, w1]);
    return out.length ? out.map((s) => ({
      key: s.key, tip: s.label, from: s.from, to: s.to, loopable: true,
    })) : null;
  }, [phases, w0, w1]);

  const span = Math.max(1, w1 - w0);
  const cursorPct = ((frame - w0) / span) * 100;

  /**
   * The strip does two jobs on one row: drag anywhere to scrub, click a segment to loop it.
   * `moved` decides which the user meant, on pointer**up** — `setPointerCapture` retargets the
   * eventual `click` to the strip rather than the segment button under the pointer, so those
   * buttons' own handlers can't be trusted to fire.
   */
  const stripRef = useRef<HTMLDivElement>(null);
  const dragFrom = useRef<number | null>(null);
  const moved = useRef(0);
  const DRAG_SLOP = 4;

  const frameAtX = (clientX: number) => {
    const r = stripRef.current?.getBoundingClientRect();
    if (!r?.width) return frame;
    return w0 + Math.round(((clientX - r.left) / r.width) * span);
  };

  const onStripDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragFrom.current = e.clientX;
    moved.current = 0;
  };
  const onStripMove = (e: React.PointerEvent) => {
    if (dragFrom.current === null) return;
    const wasDragging = moved.current > DRAG_SLOP;
    moved.current = Math.max(moved.current, Math.abs(e.clientX - dragFrom.current));
    if (moved.current > DRAG_SLOP) {
      if (!wasDragging) { videoRef.current?.pause(); player.setLoop(null); }
      seek(frameAtX(e.clientX));
    }
  };
  const onStripUp = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    // A click puts the playhead where you clicked and stops there. It used to start looping
    // whichever phase segment sat under the pointer, which meant you could not simply *look*
    // at a frame without the video running away from it. `jumpTo` pauses, drops any loop and
    // seeks — the three things "put the marker here" should mean.
    if (moved.current <= DRAG_SLOP) jumpTo(frameAtX(e.clientX));
    dragFrom.current = null;
  };

  return (
    <div className="stage-transport mt-3">
      <div ref={stripRef} className="segmented-scrub"
           onPointerDown={onStripDown} onPointerMove={onStripMove}
           onPointerUp={onStripUp} onPointerCancel={onStripUp}>
        <div className="scrub-segments">
          {segments ? segments.map((s) => {
            const on = frame >= s.from && frame <= s.to;
            const looped = loop?.[0] === s.from && loop?.[1] === s.to;
            return (
              <button key={s.key} type="button"
                style={{ flexGrow: Math.max(1, s.to - s.from) }}
                data-tip={`${s.tip} · ${((s.to - s.from) / fps).toFixed(2)}s`}
                // Keyboard path (Enter/Space on a focused segment). Pointer clicks are decided
                // by the strip's own onStripUp — pointer capture retargets the eventual `click`
                // away from this button. Both do the same thing: move the playhead, don't play.
                onClick={() => jumpTo(s.from)}
                className={`scrub-segment ${on ? "active" : ""}
                            ${looped ? "outline-2 outline-offset-1 outline-acid/60" : ""}`}
                aria-label={`${s.tip} — frames ${s.from} to ${s.to}, click to loop`} />
            );
          }) : <span className="scrub-segment flex-1" />}
        </div>
        <span className="scrub-cursor" style={{ left: `${cursorPct}%` }} />
        {/* Keyboard path only — pointer events are handled by the strip above. */}
        <input className="scrub-input" aria-label="Swing frame scrubber" type="range"
               min={w0} max={w1} value={frame}
               onChange={(e) => jumpTo(+e.target.value)} />
        <span className="scrub-focus-ring" aria-hidden />
      </div>

      <div className="mt-2 flex items-center gap-2 sm:gap-3">
        <button type="button" onClick={toggle} aria-label="Play or pause swing"
          className="transport-circle bg-white text-canvas shadow-[0_12px_35px_rgba(255,255,255,.16)]">
          <svg className={`h-7 w-7 ${playing ? "" : "translate-x-0.5"}`} viewBox="0 0 24 24" fill="currentColor">
            {playing ? <path d="M6 5h4v14H6zM14 5h4v14h-4z" /> : <path d="M8 5v14l11-7z" />}
          </svg>
        </button>

        <button type="button" onClick={() => jumpTo(frame - 1)} title="Back one frame (←)"
          aria-label="Back one frame"
          className="transport-circle-sm border border-white/14 bg-black/25 text-neutral-300
                     hover:border-white/30 hover:text-white">
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="m14 6-6 6 6 6" /><path d="M17 5v14" strokeWidth="1.6" opacity=".5" />
          </svg>
        </button>
        <button type="button" onClick={() => jumpTo(frame + 1)} title="Forward one frame (→)"
          aria-label="Forward one frame"
          className="transport-circle-sm border border-white/14 bg-black/25 text-neutral-300
                     hover:border-white/30 hover:text-white">
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="m10 6 6 6-6 6" /><path d="M7 5v14" strokeWidth="1.6" opacity=".5" />
          </svg>
        </button>

        <button type="button" onClick={() => setLooping(!looping)} aria-label="Toggle loop"
          title={looping ? "A selected range repeats" : "A selected range plays once"}
          className={`transport-circle-sm border ${looping
            ? "border-acid/50 bg-acid/10 text-acid"
            : "border-white/20 bg-black/35 text-white opacity-45"}`}>
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M17 2l4 4-4 4" />
            <path d="M3 11V9a3 3 0 0 1 3-3h18M7 22l-4-4 4-4" />
            <path d="M21 13v2a3 3 0 0 1-3 3H3" />
          </svg>
        </button>

        <div className="speed-selector" aria-label="Playback speed">
          {SPEEDS.map((s) => (
            <button key={s} type="button" onClick={() => setSpeed(s)}
              className={`speed-button ${speed === s ? "active" : ""}`}>{s}×</button>
          ))}
        </div>
      </div>
    </div>
  );
}
