import { memo, useMemo } from "react";
import { View } from "react-native";

import { BONES, DRAWN_CONF, HIDE_JOINT, SIDE_COLOR, sideOf, type PoseFrame } from "./pose";

/**
 * The real overlay, drawn in JS — 28 bones and their joints from a real `analysis.json`.
 *
 * This exists so the strategy comparison is run against the actual workload rather than a single
 * marker line. A strategy that pins one 2px line to the video perfectly may still fall over
 * redrawing a whole skeleton sixty times a second, and "which approach is most efficient" cannot
 * be answered by measuring the easy case.
 *
 * Drawn with plain rotated `View`s rather than SVG or Skia, deliberately: it needs no new
 * dependency, so nothing about the comparison is entangled with a library choice made mid-spike.
 * The caveat that comes with that is real and must not be lost — **if the JS strategy fails on
 * cost, this renderer is a suspect alongside the strategy itself**, and the retest is Skia before
 * concluding that JS drawing cannot keep up.
 *
 * Rules carried over from the web player, which are contract-level rather than cosmetic:
 *   - coordinates are normalized 0-1, so rendering is a multiply and nothing else
 *   - a point below MIN_CONF was treated as missing by the analyzer and must be treated as
 *     missing here; a bone with either end missing is not drawn, never guessed
 *   - keypoint ORDER is never hardcoded — names come from the artifact (see pose.ts)
 */

export interface SkeletonProps {
  frame: PoseFrame | null;
  /** Rendered video size in px; the normalized coordinates scale onto this. */
  width: number;
  height: number;
  strokeWidth?: number;
  /** Index in `keypointNames` for each name, built once by the caller. */
  index: Record<string, number>;
  /** Names in artifact order, needed to colour and filter the joint dots. */
  names: string[];
}

function SkeletonImpl({ frame, width, height, index, names, strokeWidth = 3 }: SkeletonProps) {
  const bones = useMemo(() => {
    if (!frame || width <= 0) return [];
    const out: {
      key: string;
      left: number;
      top: number;
      length: number;
      angle: string;
      color: string;
    }[] = [];

    for (const [from, to, side] of BONES) {
      const a = frame.kp[index[from]];
      const b = frame.kp[index[to]];
      // Missing means missing — and missing is confidence ZERO, the analyzer's sentinel for a
      // point it never located. Gating here at the *measurement* threshold instead was the first
      // port's bug: it deleted every joint between 0 and MIN_CONF that the web player draws.
      if (!a || !b || a[2] <= DRAWN_CONF || b[2] <= DRAWN_CONF) continue;

      const x1 = a[0] * width;
      const y1 = a[1] * height;
      const x2 = b[0] * width;
      const y2 = b[1] * height;
      const dx = x2 - x1;
      const dy = y2 - y1;
      const length = Math.hypot(dx, dy);
      if (length < 0.5) continue;

      out.push({
        key: `${from}-${to}`,
        left: x1,
        top: y1 - strokeWidth / 2,
        length,
        angle: `${Math.atan2(dy, dx)}rad`,
        color: SIDE_COLOR[side] ?? SIDE_COLOR.M,
      });
    }
    return out;
  }, [frame, width, height, index, strokeWidth]);

  // Joint dots, matching the web player: every located point except the face/finger detail it
  // hides. These are most of the element count, and therefore most of what the cost comparison
  // is actually measuring.
  const joints = useMemo(() => {
    if (!frame || width <= 0) return [];
    const r = Math.max(3, width / 190);
    const out: { key: string; left: number; top: number; size: number; color: string }[] = [];
    names.forEach((n, i) => {
      const p = frame.kp[i];
      if (!p || p[2] <= DRAWN_CONF || HIDE_JOINT.test(n)) return;
      out.push({
        key: n,
        left: p[0] * width - r,
        top: p[1] * height - r,
        size: r * 2,
        color: SIDE_COLOR[sideOf(n)] ?? SIDE_COLOR.M,
      });
    });
    return out;
  }, [frame, width, height, names]);

  if (!frame) return null;

  return (
    <View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, width, height }}>
      {bones.map((b) => (
        <View
          key={b.key}
          style={{
            position: "absolute",
            left: b.left,
            top: b.top,
            width: b.length,
            height: strokeWidth,
            backgroundColor: b.color,
            borderRadius: strokeWidth / 2,
            // Rotate about the bone's own start point, so `left`/`top` stay the joint position
            // rather than the centre of a rotated box.
            transformOrigin: "left center",
            transform: [{ rotate: b.angle }],
          }}
        />
      ))}
      {joints.map((j) => (
        <View
          key={j.key}
          style={{
            position: "absolute",
            left: j.left,
            top: j.top,
            width: j.size,
            height: j.size,
            borderRadius: j.size / 2,
            backgroundColor: j.color,
          }}
        />
      ))}
    </View>
  );
}

/**
 * Memoised on the frame object. The parent re-renders on every video frame; without this the
 * whole bone list is rebuilt even when the frame index has not actually changed, which would
 * charge the JS strategy for work it does not really do.
 */
export const Skeleton = memo(SkeletonImpl);
