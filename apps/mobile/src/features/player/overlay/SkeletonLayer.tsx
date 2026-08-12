import { memo } from "react";
import type { Analysis } from "@swingsage/schema/contract";

import { Dot, Line } from "./Primitives";
import type { KeypointIndex } from "./geometry";
import { BONES, HIDE_JOINT, SIDE_COLOR } from "./skeleton";

/**
 * The stick figure: 28 bones and the joints they connect.
 *
 * **Gated at `conf > 0`, not at `MIN_CONF`.** This is the drawing bar, and it is deliberately
 * lower than the measurement bar the angles and orientation rods are held to — a skeleton that
 * deleted every joint the analyzer would not measure from is mostly gone on the far side of a
 * down-the-line swing. Nothing here reads as a number, so drawing a low-confidence limb is showing
 * what the model saw rather than asserting a measurement. The two bars are separate on purpose and
 * collapsing them breaks one or the other.
 *
 * Bone list and colours come from `skeleton.ts`, mirroring the analyzer; indices come from the
 * artifact's own `keypoint_names`. **No literal keypoint index appears anywhere**, which is what
 * lets the analyzer append a derived joint without silently desyncing this renderer.
 */

export interface SkeletonLayerProps {
  analysis: Analysis;
  idx: KeypointIndex;
  frame: number;
  w: number;
  h: number;
}

/**
 * Mobile omits the pinky→index knuckle line (D22) and reads the hands as wrist angle instead. The
 * web player keeps it; the divergence is deliberate rather than an incomplete port, so it is
 * filtered here by name rather than by editing the shared bone table.
 */
const OMIT_BONE = new Set(["left_pinky|left_index", "right_pinky|right_index"]);

export const SkeletonLayer = memo(function SkeletonLayer({
  analysis,
  idx,
  frame,
  w,
  h,
}: SkeletonLayerProps) {
  const fr = analysis.pose.frames[frame];
  if (!fr) return null;

  const kp = fr.kp;
  const stroke = Math.max(2, w / 160);
  const r = Math.max(2.5, w / 190);

  return (
    <>
      {BONES.map(([a, b, side]) => {
        if (OMIT_BONE.has(`${a}|${b}`)) return null;
        const pa = kp[idx[a]];
        const pb = kp[idx[b]];
        if (!pa || !pb || pa[2] <= 0 || pb[2] <= 0) return null;
        return (
          <Line
            key={`bone-${a}-${b}`}
            a={[pa[0] * w, pa[1] * h]}
            b={[pb[0] * w, pb[1] * h]}
            width={stroke}
            color={SIDE_COLOR[side]}
          />
        );
      })}

      {analysis.pose.keypoint_names.map((n, i) => {
        const p = kp[i];
        // Face detail adds clutter without coaching value, and the hand landmarks are hidden as
        // joints while their connecting bone still draws — three dots read as noise where a line
        // reads as forearm roll.
        if (!p || p[2] <= 0 || HIDE_JOINT.test(n)) return null;
        const side = n.startsWith("left_") ? "L" : n.startsWith("right_") ? "R" : "M";
        return <Dot key={`joint-${n}`} x={p[0] * w} y={p[1] * h} r={r} color={SIDE_COLOR[side]} />;
      })}
    </>
  );
});
