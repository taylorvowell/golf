import { memo } from "react";
import type { Club } from "@swingsage/schema/contract";

import { Dot, Line, Ring, Segments } from "./Primitives";
import { dashSegments } from "./paths";

/**
 * The club on this frame: the shaft, the butt just above the hands, and a ring on the head.
 *
 * A ring rather than a dot, because the head is a few pixels across and a filled marker would
 * cover the exact pixels a golfer is checking it against. The shaft draws **dashed and dimmed
 * below `conf 0.35`** — the same value the analyzer treats as the floor — so a weak solve looks
 * weak instead of looking identical to a confident one.
 *
 * Nothing here is drawn on a frame the detector had nothing to say about: a missing `shaft`,
 * `butt` or `head` is absence, and the layer omits that piece rather than reaching for the last
 * one it saw. The club is the part of this pipeline that has overstated itself three separate
 * times, so this layer abstains loudly.
 */

export interface ClubLayerProps {
  /**
   * The SELECTED solution from `selectedClub`, not `analysis.club`.
   *
   * Passed in rather than read off the artifact so there is one place the variant is chosen and
   * the trace and the shaft cannot end up drawing two different solves over the same swing — which
   * is exactly what happened on the first pass of this port.
   */
  club: Club;
  frame: number;
  w: number;
  h: number;
}

const WEAK_CONF = 0.35;

export const ClubLayer = memo(function ClubLayer({ club, frame, w, h }: ClubLayerProps) {
  const cf = club.frames?.[frame];
  if (!cf) return null;

  const stroke = Math.max(2, w / 200);
  const weak = cf.conf < WEAK_CONF;
  const shaftColor = weak ? "rgba(241,245,249,0.45)" : "#F1F5F9";

  return (
    <>
      {cf.shaft && cf.shaft.length === 2 ? (
        weak ? (
          <Segments
            tag="shaft"
            segments={dashSegments(
              [
                [cf.shaft[0][0] * w, cf.shaft[0][1] * h],
                [cf.shaft[1][0] * w, cf.shaft[1][1] * h],
              ],
              stroke * 2.6,
              stroke * 2.2,
            )}
            width={stroke}
            color={shaftColor}
          />
        ) : (
          <Line
            a={[cf.shaft[0][0] * w, cf.shaft[0][1] * h]}
            b={[cf.shaft[1][0] * w, cf.shaft[1][1] * h]}
            width={stroke}
            color={shaftColor}
          />
        )
      ) : null}

      {cf.butt ? (
        <Dot x={cf.butt[0] * w} y={cf.butt[1] * h} r={Math.max(3, w / 190)} color="#FDE68A" />
      ) : null}

      {cf.head ? (
        <Ring
          x={cf.head[0] * w}
          y={cf.head[1] * h}
          r={Math.max(6, w / 110)}
          thickness={2.5}
          color="#FB7185"
        />
      ) : null}
    </>
  );
});
