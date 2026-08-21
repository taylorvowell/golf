import { Fragment, memo, useMemo } from "react";
import type { Analysis } from "@swingsage/schema/contract";

import { Dot, Line } from "./Primitives";
import type { TraceKey } from "./model";
import { simplify, type Pt } from "./paths";
import { TRACE_COLOR } from "./skeleton";
import { cutAt, type TracePiece } from "./traceSmoothing";
import { stylePiece, type StyledPiece } from "./traceStyles";

/**
 * The club-head path, revealed to the playhead — drawn in the production style chosen
 * 2026-08-19 (`traceStyles.ts`: bulge width, aquaDeep shades, silk joins).
 *
 * Three rules survive from the original renderer, and each of them is a thing this project
 * has already got wrong once:
 *
 *   * **The trace never interpolates a gap.** A run of frames the detector did not answer is a
 *     `bridge` piece and draws as a straight dashed chord. Curving it would dress absence up as
 *     data — on held-out gaps no reconstruction beat a straight line.
 *   * **The finished curve is cut, not re-smoothed.** `buildTrace` smoothed the whole segment once;
 *     `cutAt` reveals a prefix of it with the tip interpolated exactly onto the playhead. Smoothing
 *     the visible prefix instead makes the line already on screen change shape as it grows.
 *   * **Position along the swing decides the style, not confidence.** Width follows the bulge
 *     profile and colour the aquaDeep blend, both parameterised on arc length of the WHOLE
 *     path — computed here by walking the pieces in time order — and nothing dims.
 *
 * **Named divergence:** the WEB player still draws the legacy two-colour phase trace from the
 * same artifact (docs/decisions/mobile-client.md). The phase COLOURS remain exported from
 * `skeleton.ts` for the scrub bands and menu tiles, which still colour-code by phase.
 *
 * ## The cost this layer had to answer for
 *
 * D23 measured 49 keypoints as rotated `View`s. A trace is a polyline of a few hundred segments
 * and therefore a few hundred views. Two things keep that in budget, both render-time only:
 *
 *   * **`simplify` in stage pixels** removes what the display cannot resolve (endpoints exact),
 *     then the silk resample re-emits uniform ~3px strokes — short enough that the gradient is
 *     continuous, long enough that the count stays in the low hundreds.
 *   * **Whole-clip work happens once per artifact.** Only the piece the playhead is inside is
 *     recut per frame; every fully-revealed piece reuses its cached styled form.
 *
 * `costRef` carries the resulting view count out so the figure lands in the record rather than
 * being asserted. A ref rather than a callback because this is a measurement OF the render that
 * is happening: a setState here would re-render the layer it just measured.
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

/** One piece's styled geometry, computed once per artifact-and-stage. */
interface TraceEntry {
  key: TraceKey;
  tag: string;
  piece: TracePiece;
  bridge: boolean;
  /** The frame this piece finishes on. At or past it, the cached `full` form is reused. */
  lastFrame: number;
  /** Simplified stage-pixel points — the styled build's input, kept for the reveal's ratio. */
  pts: Pt[];
  /** This piece's span of the whole drawn path, by cumulative arc length. */
  t0: number;
  t1: number;
  full: StyledPiece;
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
   * Everything the playhead cannot change, once per artifact-and-stage. Pieces are walked in
   * TIME order and given their [t0,t1] span of the whole drawn path by cumulative arc length,
   * so the width bulge and colour blend read across the swing rather than restarting per
   * phase. Bridges keep their span so `t` stays continuous across a gap.
   */
  const entries = useMemo(() => {
    interface Flat {
      key: TraceKey;
      tag: string;
      piece: TracePiece;
      bridge: boolean;
      lastFrame: number;
      pts: Pt[];
    }
    const flat: Flat[] = [];
    for (const key of ["backswing", "downswing", "followthrough"] as TraceKey[]) {
      // Follow-through ships hidden (zero-alpha colour), not deleted — restoring it is one
      // colour in skeleton.ts (user directive 2026-08-08). Skipping the build entirely is the
      // view-count saving.
      if (TRACE_COLOR[key] === "rgba(255,255,255,0)") continue;
      const list = pieces[key];
      if (!list?.length) continue;
      list.forEach((piece, i) => {
        if (piece.pts.length < 2) return;
        const stage: Pt[] = piece.pts.map(([x, y]) => [x * sx, y * sy]);
        flat.push({
          key,
          tag: `trace-${key}-${i}`,
          piece,
          bridge: !!piece.bridge,
          lastFrame: piece.frames[piece.frames.length - 1] ?? -1,
          pts: simplify(stage, SIMPLIFY_PX),
        });
      });
    }
    const lens = flat.map((f) => {
      let L = 0;
      for (let i = 1; i < f.pts.length; i++) {
        L += Math.hypot(f.pts[i][0] - f.pts[i - 1][0], f.pts[i][1] - f.pts[i - 1][1]);
      }
      return L;
    });
    const total = lens.reduce((a, b) => a + b, 0) || 1;
    let acc = 0;
    const out: TraceEntry[] = flat.map((f, i) => {
      const t0 = acc / total;
      acc += lens[i];
      const t1 = acc / total;
      return {
        ...f,
        t0,
        t1,
        full: stylePiece({ pts: f.pts, bridge: f.bridge, peak, t0, t1 }),
      };
    });
    return out;
  }, [pieces, sx, sy, peak]);

  /**
   * Revealed to the playhead. Fully-passed pieces reuse their cached styled form (identity
   * stable frame to frame, so the memoized views under them skip); only the piece containing
   * the playhead pays the cut + restyle.
   */
  const runs = useMemo(() => {
    if (!grow) return entries.map((e) => ({ tag: e.tag, out: e.full }));
    const out: { tag: string; out: StyledPiece }[] = [];
    for (const e of entries) {
      if (frame >= e.lastFrame) {
        out.push({ tag: e.tag, out: e.full });
        continue;
      }
      const cut = cutAt(e.piece, frame);
      if (!cut || cut.length < 2) continue;
      const stage: Pt[] = cut.map(([x, y]) => [x * sx, y * sy]);
      const pts = simplify(stage, SIMPLIFY_PX);
      // The revealed fraction, by point share — keeps the tip's width/colour continuous with
      // what full reveal will show at this spot.
      const frac = Math.min(1, pts.length / Math.max(1, e.pts.length));
      out.push({
        tag: e.tag,
        out: stylePiece({ pts, bridge: e.bridge, peak, t0: e.t0, t1: e.t0 + (e.t1 - e.t0) * frac }),
      });
    }
    return out;
  }, [entries, grow, frame, sx, sy, peak]);

  if (costRef) {
    costRef.current = runs.reduce((n, r) => n + r.out.segs.length + r.out.dots.length, 0);
  }

  if (!(sx > 0) || !(sy > 0)) return null;

  return (
    <>
      {runs.map((r) => (
        <Fragment key={r.tag}>
          {r.out.segs.map((s, i) => (
            <Line key={`${r.tag}-l${i}`} a={s.a} b={s.b} width={s.w} color={s.color} opacity={s.opacity} />
          ))}
          {r.out.dots.map((d, i) => (
            <Dot key={`${r.tag}-d${i}`} x={d.x} y={d.y} r={d.r} color={d.color} opacity={d.opacity} />
          ))}
        </Fragment>
      ))}
    </>
  );
});
