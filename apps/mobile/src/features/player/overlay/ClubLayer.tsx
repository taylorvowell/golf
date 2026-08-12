import { memo } from "react";
import type { Club } from "@swingsage/schema/contract";

import type { HeadMarks } from "../useCorrections";
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
  /** Hand-placed heads. One on this frame wins over the solved position. */
  marks?: HeadMarks;
  w: number;
  h: number;
}

const WEAK_CONF = 0.35;

export const ClubLayer = memo(function ClubLayer({ club, frame, marks, w, h }: ClubLayerProps) {
  const cf = club.frames?.[frame];
  if (!cf) return null;

  const stroke = Math.max(2, w / 200);
  const mark = marks?.get(frame);
  // A placed head is a correction, not a detection: it is never dimmed for low confidence, because
  // the confidence being reported belongs to the answer it replaced.
  const weak = !mark && cf.conf < WEAK_CONF;
  const shaftColor = weak ? "rgba(241,245,249,0.45)" : "#F1F5F9";
  // The shaft is re-drawn from the grip to the placed head, so the club stays one rigid body
  // attached to the hands rather than a line pointing at where the detector used to think it was.
  const shaftEnd: [number, number] | null = mark
    ? [mark[0] * w, mark[1] * h]
    : cf.shaft?.length === 2
      ? [cf.shaft[1][0] * w, cf.shaft[1][1] * h]
      : null;
  const head = mark ?? cf.head;

  return (
    <>
      {cf.shaft && cf.shaft.length === 2 && shaftEnd ? (
        weak ? (
          <Segments
            tag="shaft"
            segments={dashSegments(
              [[cf.shaft[0][0] * w, cf.shaft[0][1] * h], shaftEnd],
              stroke * 2.6,
              stroke * 2.2,
            )}
            width={stroke}
            color={shaftColor}
          />
        ) : (
          <Line
            a={[cf.shaft[0][0] * w, cf.shaft[0][1] * h]}
            b={shaftEnd}
            width={stroke}
            color={shaftColor}
          />
        )
      ) : null}

      {cf.butt ? (
        <Dot x={cf.butt[0] * w} y={cf.butt[1] * h} r={Math.max(3, w / 190)} color="#FDE68A" />
      ) : null}

      {/* Green once it is yours, rose while it is still the analyzer's — the same pairing the web
          player uses, so "what the pipeline thinks" reads the same in both. */}
      {head ? (
        <Ring
          x={head[0] * w}
          y={head[1] * h}
          r={Math.max(6, w / 110)}
          thickness={2.5}
          color={mark ? "#34D399" : "#FB7185"}
        />
      ) : null}
    </>
  );
});
