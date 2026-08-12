import { Fragment, memo } from "react";
import type { Analysis } from "@swingsage/schema/contract";

import { Dot, Line } from "./Primitives";
import { MIN_CONF, type KeypointIndex } from "./geometry";
import {
  ORIENT_PAIRS,
  ORIENT_WEAK_CONF,
  ORIENT_WEAK_SPAN,
  type OrientTrack,
} from "./model";

/**
 * Shoulder rod and hip rod — rotation, with nothing else in the frame.
 *
 * Two bars with a ball on each end, skewered through the shoulder pair and the hip pair and run
 * past the body on both sides. Long is the point: a segment that stops at the joints is two short
 * marks inside a torso, while a bar crossing the frame turns "how far has he turned, and are the
 * hips ahead of the shoulders" into an angle read at a glance.
 *
 * It reads as a solid object because it is projected like one: **length scales with the pair's
 * on-screen span**, so the bar foreshortens as the golfer turns away from the lens and stretches
 * back out as they come square. A fixed pixel length would hold it at roughly constant size through
 * the whole swing, which is exactly the flat, un-rotating look this replaced. The end balls are
 * what keep it alive when a pair goes side-on and the bar projects to a point — nothing is
 * invented, the balls sit at the ends of a rod whose direction and length are both measured.
 *
 * **Gated at `MIN_CONF`, not at the skeleton's `conf > 0`.** This reads as a measurement, and a rod
 * hung off a keypoint the analyzer treated as missing is the confident-looking fabrication this
 * product forbids. A dim bar means it is showing the last angle it could trust rather than this
 * frame's — see `orientationHold`.
 */

export interface OrientLayerProps {
  analysis: Analysis;
  idx: KeypointIndex;
  tracks: OrientTrack[];
  frame: number;
  w: number;
  h: number;
}

/**
 * How far each rod runs PAST the joint it starts from, as a multiple of that pair's on-screen span.
 *
 * 0.5, down from the 1.0 first asked for: extension is amplification, and at 1.0 a rod tip travels
 * 2.6x as far as the joint it hangs off, so the small real movements of a golfer settling over the
 * ball swung the bars around and read as the overlay running ahead of the picture.
 */
const ORIENT_EXTEND = 0.5;

/** The ball on each end, as a share of body height. */
const ORIENT_CAP = 0.011;

export const OrientLayer = memo(function OrientLayer({
  analysis,
  idx,
  tracks,
  frame,
  w,
  h,
}: OrientLayerProps) {
  const fr = analysis.pose.frames[frame];
  if (!fr) return null;

  // The 0.4 fallback mirrors the analyzer's own in `metrics._body_height`.
  const bodyPx = (analysis.metrics?.body_height_norm || 0.4) * h;
  const lw = Math.max(3, w / 220);
  const cap = Math.max(lw, bodyPx * ORIENT_CAP);

  return (
    <>
      {ORIENT_PAIRS.map(([ln, rn], pi) => {
        const a = fr.kp[idx[ln]];
        const b = fr.kp[idx[rn]];
        if (!a || !b || a[2] < MIN_CONF || b[2] < MIN_CONF) return null;
        const track = tracks[pi];
        const dir = track?.dir[frame];
        if (dir === undefined || Number.isNaN(dir)) return null;

        // Pixel space, so the bar follows its true on-screen direction. Offsetting in normalized
        // units would run short vertically and long horizontally on any non-square frame.
        const ax = a[0] * w,
          ay = a[1] * h,
          bx = b[0] * w,
          by = b[1] * h;
        const span = Math.hypot(bx - ax, by - ay);
        // LENGTH is always this frame's own, even while the direction is held: how far the bar
        // reaches is the foreshortening read, and freezing that too would stop it looking like a
        // rod in space. Only the aim is held.
        const ux = Math.cos(dir),
          uy = Math.sin(dir);
        const half = span / 2 + span * ORIENT_EXTEND;
        // Centred on the measured midpoint. While held the bar no longer runs exactly through both
        // joints — which is the honest picture, since one of them is a guess.
        const mx = (ax + bx) / 2,
          my = (ay + by) / 2;
        const p0: [number, number] = [mx - ux * half, my - uy * half];
        const p1: [number, number] = [mx + ux * half, my + uy * half];

        const weak =
          !!track.held[frame] ||
          Math.min(a[2], b[2]) < ORIENT_WEAK_CONF ||
          span < bodyPx * ORIENT_WEAK_SPAN;
        const color = weak ? "rgba(239,68,68,0.6)" : "#EF4444";

        return (
          // A Fragment, not a View: every child is absolutely positioned against the overlay, and
          // a real wrapper would establish a containing block and move all six of them.
          <Fragment key={`rod-${ln}`}>
            {/* Dark underlay then red — one red line vanishes into a red shirt on one clip and into
                shadow on the next, and the overlay cannot know which it is on. */}
            <Line a={p0} b={p1} width={lw + 2.5} color="rgba(0,0,0,0.55)" />
            <Dot x={p0[0]} y={p0[1]} r={cap + 1.6} color="rgba(0,0,0,0.55)" />
            <Dot x={p1[0]} y={p1[1]} r={cap + 1.6} color="rgba(0,0,0,0.55)" />
            <Line a={p0} b={p1} width={lw} color={color} />
            <Dot x={p0[0]} y={p0[1]} r={cap} color={color} />
            <Dot x={p1[0]} y={p1[1]} r={cap} color={color} />
          </Fragment>
        );
      })}
    </>
  );
});

