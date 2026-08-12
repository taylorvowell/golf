import { memo } from "react";
import { View } from "react-native";

import type { Segment } from "./paths";

/**
 * The three shapes a plain-`View` overlay can make.
 *
 * There is no canvas here and no Skia (D23, D36) — every stroke is a `View`, so the whole renderer
 * reduces to a rotated rectangle, a circle, and a ring. Keeping that in one file is what stops the
 * layers from each inventing their own transform, which is how a skeleton and a club trace end up
 * a pixel apart on the same frame.
 *
 * **Rotation in React Native is about a view's centre**, so every line is positioned by its
 * midpoint rather than by its start. Placing it at the start and rotating would swing it away from
 * the joint it belongs to, and the error grows with the length of the bone — which is why it looks
 * like a pose problem rather than a transform problem.
 */

export interface LineProps {
  a: readonly [number, number];
  b: readonly [number, number];
  width: number;
  color: string;
  opacity?: number;
}

export const Line = memo(function Line({ a, b, width, color, opacity }: LineProps) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  // A zero-length line is not a dot: it would render as a `width`-square rotated block. Two
  // keypoints on top of each other is a real case on a foreshortened foot.
  if (!(len > 0.01)) return null;

  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: (a[0] + b[0]) / 2 - len / 2,
        top: (a[1] + b[1]) / 2 - width / 2,
        width: len,
        height: width,
        borderRadius: width / 2,
        backgroundColor: color,
        opacity,
        transform: [{ rotate: `${Math.atan2(dy, dx)}rad` }],
      }}
    />
  );
});

export interface DotProps {
  x: number;
  y: number;
  r: number;
  color: string;
  opacity?: number;
}

export const Dot = memo(function Dot({ x, y, r, color, opacity }: DotProps) {
  if (!(r > 0)) return null;
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: x - r,
        top: y - r,
        width: r * 2,
        height: r * 2,
        borderRadius: r,
        backgroundColor: color,
        opacity,
      }}
    />
  );
});

export interface RingProps extends DotProps {
  thickness: number;
}

/** An outlined circle — the club head, which must not cover the pixels it is pointing at. */
export const Ring = memo(function Ring({ x, y, r, color, thickness, opacity }: RingProps) {
  if (!(r > 0)) return null;
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: x - r,
        top: y - r,
        width: r * 2,
        height: r * 2,
        borderRadius: r,
        borderWidth: thickness,
        borderColor: color,
        opacity,
      }}
    />
  );
});

export interface SegmentsProps {
  segments: readonly Segment[];
  width: number;
  color: string;
  opacity?: number;
  /** Distinguishes one run's views from another's in the tree. Not user-visible. */
  tag: string;
}

/** A list of segments as lines. One `View` each — this is where the frame budget goes. */
export const Segments = memo(function Segments({
  segments,
  width,
  color,
  opacity,
  tag,
}: SegmentsProps) {
  return (
    <>
      {segments.map((s, i) => (
        <Line key={`${tag}-${i}`} a={s.a} b={s.b} width={width} color={color} opacity={opacity} />
      ))}
    </>
  );
});
