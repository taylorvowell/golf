import { memo, useMemo } from "react";
import type { Analysis } from "@swingsage/schema/contract";

import { Segments } from "./Primitives";
import type { TraceKey } from "./model";
import { dashSegments, polylineSegments, simplify, type Pt, type Segment } from "./paths";
import { TRACE_COLOR } from "./skeleton";
import { cutAt, type TracePiece } from "./traceSmoothing";

/**
 * The club-head path, revealed to the playhead.
 *
 * Three rules survive the port from the web player intact, and each of them is a thing this
 * project has already got wrong once:
 *
 *   * **The trace never interpolates a gap.** A run of frames the detector did not answer is a
 *     `bridge` piece and draws as a straight dashed chord. Curving it would dress absence up as
 *     data — on held-out gaps no reconstruction beat a straight line.
 *   * **The finished curve is cut, not re-smoothed.** `buildTrace` smoothed the whole segment once;
 *     `cutAt` reveals a prefix of it with the tip interpolated exactly onto the playhead. Smoothing
 *     the visible prefix instead makes the line already on screen change shape as it grows.
 *   * **Phase decides the style, not confidence.** The backswing is dashed and the downswing solid,
 *     and nothing dims. Bridges are dashed too, which is a coincidence of style, so `piece.bridge`
 *     is not consulted for the dash — only for the fact that it is a straight chord already.
 *
 * ## The cost this layer had to answer for
 *
 * D23 measured 49 keypoints as rotated `View`s. It never measured a **trace**, which is a polyline
 * of a hundred-plus segments and therefore a hundred-plus more views. Two things keep that in
 * budget, both render-time only and neither touching `analysis.json`:
 *
 *   * **`simplify` in stage pixels.** The smoothing filters subdivide for a canvas — Catmull-Rom
 *     emits eight points per span — and on a phone most of that is finer than a pixel. RDP at
 *     `SIMPLIFY_PX` removes what the display cannot resolve and preserves both endpoints exactly.
 *   * **Dashing is cheaper than not dashing.** A dashed run emits one view per dash rather than one
 *     per sample, so the backswing costs less than the downswing over the same distance.
 *
 * `costRef` carries the resulting view count out so the figure lands on screen and in the record
 * rather than being asserted. A ref rather than a callback because this is a measurement OF the
 * render that is happening: a setState here would re-render the layer it just measured.
 */

export interface TraceLayerProps {
  analysis: Analysis;
  pieces: Record<TraceKey, TracePiece[]>;
  frame: number;
  /** Reveal up to the playhead. Off draws the finished path — useful once, misleading while scrubbing. */
  grow: boolean;
  w: number;
  h: number;
  /** Written during render with the number of views this layer just drew. Never read by it. */
  costRef?: { current: number };
}

/**
 * How far the drawn line may move, in stage pixels, to save a view.
 *
 * Below one pixel it cannot be seen at all; 0.6 leaves headroom on a 3x-density screen where a
 * layout pixel is a third of a physical one. Raising this is the first lever if a future clip
 * proves expensive — and it is a lever with a stated, bounded cost, unlike dropping points by count.
 */
const SIMPLIFY_PX = 0.6;

/** Follow-through first, so the long faint tail sits behind the two segments a coach reads. */
const DRAW_ORDER: TraceKey[] = ["followthrough", "backswing", "downswing"];

/** How much heavier the downswing draws than the backswing. */
const DOWNSWING_WEIGHT = 1.25;

interface TraceRun {
  key: TraceKey;
  tag: string;
  segments: Segment[];
  width: number;
}

/** One piece's frame-independent geometry, plus its finished form, computed once per artifact. */
interface TraceEntry {
  key: TraceKey;
  tag: string;
  dashed: boolean;
  width: number;
  piece: TracePiece;
  /** The frame this piece finishes on. At or past it, `cutAt` returns the whole polyline. */
  lastFrame: number;
  /** The fully-revealed run — reused verbatim for every frame at or past `lastFrame`. */
  full: TraceRun;
}

/** Scale to the stage, drop what the display cannot resolve, and cut into drawable segments. */
function toSegments(pts: Pt[], sx: number, sy: number, peak: number, dashed: boolean): Segment[] {
  const stage: Pt[] = pts.map(([x, y]) => [x * sx, y * sy]);
  const thin = simplify(stage, SIMPLIFY_PX);
  return dashed ? dashSegments(thin, peak * 1.25, peak * 2.1) : polylineSegments(thin);
}

export const TraceLayer = memo(function TraceLayer({
  analysis,
  pieces,
  frame,
  grow,
  w,
  h,
  costRef,
}: TraceLayerProps) {
  const sx = w / analysis.video.width;
  const sy = h / analysis.video.height;
  const peak = Math.max(2.5, w / 200);

  /**
   * Everything the playhead cannot change, once per artifact-and-stage.
   *
   * The scale, the RDP simplify and the dashing used to run for EVERY piece on EVERY frame —
   * O(whole path) of tuple allocations at 60Hz for output that was byte-identical the moment a
   * piece was fully revealed. A smoothed trace runs to a few thousand points (see `paths.ts`),
   * so the per-frame work has to be O(growing tip): only the one piece the playhead is inside is
   * recut below; everything else — and everything, when `grow` is off — reuses these.
   */
  const entries = useMemo(() => {
    const out: TraceEntry[] = [];
    for (const key of DRAW_ORDER) {
      // Follow-through ships at zero alpha — hidden, not deleted, so restoring it is one colour.
      // Skipping the render rather than drawing invisible views is the one place this renderer
      // diverges from the canvas for cost: on a canvas a transparent stroke is nearly free, here
      // it is a view per segment for nothing.
      if (TRACE_COLOR[key] === "rgba(255,255,255,0)") continue;
      const list = pieces[key];
      if (!list?.length) continue;
      const phaseDashed = key === "backswing";
      const width = key === "downswing" ? peak * DOWNSWING_WEIGHT : peak;

      list.forEach((piece, i) => {
        if (piece.pts.length < 2) return;
        const tag = `${key}-${i}`;
        // A bridge is already a two-point chord; dashing it is what says "nothing was measured
        // here". A measured backswing run is dashed as a phase style. Both end up dashed and the
        // reasons are different, which is why they are two conditions and not one.
        const dashed = phaseDashed || piece.bridge;
        out.push({
          key,
          tag,
          dashed,
          width,
          piece,
          lastFrame: piece.frames[piece.frames.length - 1] ?? -1,
          full: { key, tag, width, segments: toSegments(piece.pts, sx, sy, peak, dashed) },
        });
      });
    }
    return out;
  }, [pieces, sx, sy, peak]);

  /** The finished path — what `grow` off draws, with no per-frame work at all. */
  const fullRuns = useMemo(() => entries.map((e) => e.full), [entries]);

  /**
   * Revealed to the playhead. Each cached `full` keeps its identity frame to frame, so the
   * memoized `Segments` under it skips; only the piece containing the playhead pays the cut.
   */
  const grownRuns = useMemo(() => {
    if (!grow) return null;
    const out: TraceRun[] = [];
    for (const e of entries) {
      if (frame >= e.lastFrame) {
        out.push(e.full);
        continue;
      }
      const cut = cutAt(e.piece, frame);
      if (!cut || cut.length < 2) continue;
      out.push({
        key: e.key,
        tag: e.tag,
        width: e.width,
        segments: toSegments(cut, sx, sy, peak, e.dashed),
      });
    }
    return out;
  }, [entries, frame, grow, sx, sy, peak]);

  const runs = grownRuns ?? fullRuns;

  if (costRef) costRef.current = runs.reduce((n, r) => n + r.segments.length, 0);

  if (!(sx > 0) || !(sy > 0)) return null;

  return (
    <>
      {runs.map((r) => (
        <Segments
          key={r.tag}
          tag={r.tag}
          segments={r.segments}
          width={r.width}
          color={TRACE_COLOR[r.key]}
        />
      ))}
    </>
  );
});
