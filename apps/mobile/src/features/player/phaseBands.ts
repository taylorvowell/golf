import type { Analysis } from "@swingsage/schema/contract";

import { TRACE_COLOR } from "./overlay/skeleton";
import { traceSpans } from "./overlay/model";
import type { PhaseOverrides } from "./useCorrections";
import { clampFrame, fractionToFrame, frameToFraction, type Bounds } from "./frames";

/**
 * The swing, cut into the phases it is actually made of.
 *
 * This is what the timeline strip draws, and it is **proportional to time** — a band's width is
 * its duration. That is the whole reason it earns its space: backswing against downswing, drawn to
 * scale, *is* tempo, which is the one number every golfer already knows they care about. A strip
 * of equal-width cells would look the same on a 3:1 swing and a 1:1 one.
 *
 * ## Why this is not a filmstrip
 *
 * It was one, briefly. The analyzer grew a `filmstrip.jpg` artifact, a route served it and the
 * scrubber drew twelve real frames — and the whole thing was reverted, because a strip of
 * thumbnails costs an artifact, a request, a decode and forty points of a golfer's screen to
 * answer a question one line of text answers better: the readout says `Downswing · 184`. What the
 * bar is left with is the part a name cannot give you, which is proportion.
 *
 * ## The colours are not decoration
 *
 * Backswing and downswing carry the same two colours their trace is drawn in over the picture, so
 * the band under the playhead and the line over the golfer are visibly the same thing. Nothing
 * else here is coloured: the setup and run-out are padding the analyzer added, not swing.
 */

export interface PhaseBand {
  key: "setup" | "backswing" | "downswing" | "through" | "runout";
  label: string;
  /** First frame of the band. Tapping it seeks here. */
  from: number;
  /** One past the last — `to - from` is the duration in frames. */
  to: number;
  color: string;
  /** A band the analyzer padded on, rather than a phase of the swing. Drawn quieter. */
  padding: boolean;
}

/** Neutral face for the bands that are not swing. */
const PAD_COLOR = "rgba(255,255,255,0.13)";
/** Impact to finish. The trace draws this at zero alpha, so the strip gives it its own quiet grey. */
const THROUGH_COLOR = "rgba(255,255,255,0.30)";

/**
 * The bands for one swing, or an empty list when the artifact cannot support them.
 *
 * Empty rather than approximate: an artifact with no events is a swing the analyzer could not
 * describe, and a strip that guessed at where the top of the backswing was would be a confident
 * wrong answer drawn to scale.
 */
export function phaseBands(
  analysis: Analysis | null,
  phases: PhaseOverrides | undefined,
  bounds: Bounds,
): PhaseBand[] {
  if (!analysis || bounds.last <= bounds.first) return [];
  const spans = traceSpans(analysis, phases);
  if (!spans) return [];

  const [address, top] = spans.backswing;
  const impact = spans.downswing[1];
  const finish = spans.followthrough[1];

  // Held inside the window, in order. The window is the analyzer's own `playback_window`, and an
  // event outside it (an artifact whose window was recomputed, a hand correction dragged past the
  // run-out) would otherwise produce a negative width that flexbox renders as a band of zero.
  const cut = (f: number, floor: number) =>
    Math.min(Math.max(f, floor), bounds.last);

  const a = cut(address, bounds.first);
  const t = cut(top, a);
  const i = cut(impact, t);
  const f = cut(finish, i);

  const all: PhaseBand[] = [
    { key: "setup", label: "Setup", from: bounds.first, to: a, color: PAD_COLOR, padding: true },
    { key: "backswing", label: "Backswing", from: a, to: t, color: TRACE_COLOR.backswing, padding: false },
    { key: "downswing", label: "Downswing", from: t, to: i, color: TRACE_COLOR.downswing, padding: false },
    { key: "through", label: "Through", from: i, to: f, color: THROUGH_COLOR, padding: false },
    { key: "runout", label: "Run-out", from: f, to: bounds.last, color: PAD_COLOR, padding: true },
  ];

  // A zero-width band is not drawable and would still take its share of the row's gaps. Impact and
  // mid-follow-through legitimately share a frame on a fast swing, so this is normal, not a fault.
  return all.filter((b) => b.to > b.from);
}

/** Which band the playhead is in, or `-1` when it is outside all of them. */
export function activeBand(bands: readonly PhaseBand[], frame: number): number {
  return bands.findIndex((b) => frame >= b.from && frame < b.to);
}

/**
 * How much of its true duration a padding band keeps on the scrub bar.
 *
 * The strip stays proportional WITHIN the swing — backswing against downswing is tempo, and that
 * ratio is untouched — but the analyzer's padding (setup, run-out) is compressed so the part a
 * golfer actually scrubs through takes most of the bar's width. A second of setup is worth
 * having; a second of setup owning a quarter of the screen's most valuable control is not.
 */
export const PADDING_SCRUB_WEIGHT = 0.3;

/**
 * One x↔frame mapping for every position on the transport.
 *
 * The playhead, the frame badge, the strip's band widths, the scrub fill and the touch surface
 * must all read THIS object — the moment two of them map x differently, the playhead crosses a
 * phase boundary at a visibly different instant from the picture behind it, which is the failure
 * the one-mapping rule exists to prevent. Piecewise linear: within any band, frames still map
 * evenly; only the bands' screen shares are weighted.
 */
export interface ScrubMap {
  toFraction(frame: number): number;
  toFrame(fraction: number): number;
  /** Screen weight per band, aligned with the bands array — what the strip's flex divides by. */
  weights: number[];
}

export function scrubMap(bands: readonly PhaseBand[], bounds: Bounds): ScrubMap {
  const { first, last } = bounds;

  // Nothing to weight — no artifact, or a degenerate span. The bar stays honestly linear.
  if (!bands.length || last <= first) {
    return {
      toFraction: (frame) => frameToFraction(frame, bounds),
      toFrame: (fraction) => fractionToFrame(fraction, bounds),
      weights: bands.map((b) => b.to - b.from),
    };
  }

  const weights = bands.map(
    (b) => (b.to - b.from) * (b.padding ? PADDING_SCRUB_WEIGHT : 1),
  );
  const total = weights.reduce((n, w) => n + w, 0);
  // Cumulative screen offset at each band's left edge, in weight units.
  const starts: number[] = [];
  let acc = 0;
  for (const w of weights) {
    starts.push(acc);
    acc += w;
  }

  return {
    weights,
    toFraction(frame) {
      const f = clampFrame(frame, bounds);
      for (let i = 0; i < bands.length; i++) {
        const b = bands[i];
        const lastBand = i === bands.length - 1;
        if (f < b.to || lastBand) {
          const within = Math.min(Math.max((f - b.from) / (b.to - b.from), 0), 1);
          return Math.min(Math.max((starts[i] + within * weights[i]) / total, 0), 1);
        }
      }
      return 1;
    },
    toFrame(fraction) {
      const x = Math.min(Math.max(Number.isFinite(fraction) ? fraction : 0, 0), 1) * total;
      for (let i = 0; i < bands.length; i++) {
        const lastBand = i === bands.length - 1;
        if (x < starts[i] + weights[i] || lastBand) {
          const within = Math.min(Math.max((x - starts[i]) / weights[i], 0), 1);
          const b = bands[i];
          return clampFrame(b.from + within * (b.to - b.from), bounds);
        }
      }
      return last;
    },
  };
}
