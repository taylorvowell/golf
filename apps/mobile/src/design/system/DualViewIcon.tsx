import { View } from "react-native";
import { ArrowLeftRight } from "lucide-react-native";

import { PoseOutline } from "./PoseOutline";

/**
 * The Dual View mark: two phone frames with the angle each one films drawn inside — down the
 * line in the left handset, front view in the right — and an exchange arrow tucked between
 * them (Taylor, 2026-08-19).
 *
 * The generic two-phones glyph said "two devices"; this one says WHICH TWO PICTURES, which is
 * the whole feature. The art is the same `capturePoses` silhouette the alignment guide and the
 * view switcher draw, so the icon and the thing it promises are literally the same picture.
 *
 * Drawn from Views, not an icon font: the frames are shapes (the sanctioned border use) and the
 * poses are SVG, so the mark scales from a 13px tag to a sheet title on one `size`.
 */

export interface DualViewIconProps {
  /** Height of a phone frame — everything else is derived from it. */
  size?: number;
  color: string;
  /** Frame stroke, in screen pixels — hairline on purpose, the art inside is the subject. */
  strokeWidth?: number;
}

export function DualViewIcon({ size = 20, color, strokeWidth = 1 }: DualViewIconProps) {
  // The figure sits well inside the frame with room on every side — crowding the margins read
  // as a smudge rather than a golfer (Taylor). The frame's proportions are a handset's.
  const frameW = Math.round(size * 0.62);
  const pad = Math.max(1, size * 0.1);
  const poseW = frameW - pad * 2;
  const poseH = size - pad * 2;
  const arrow = Math.round(size * 0.72);
  const frame = {
    width: frameW,
    height: size,
    borderRadius: Math.max(2, size * 0.2),
    borderWidth: strokeWidth,
    borderColor: color,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  };

  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      <View style={frame}>
        <PoseOutline pose="dtl" width={poseW} height={poseH} color={color} fill />
      </View>
      {/* The exchange between them is the point, so it gets room rather than being tucked. */}
      <View style={{ marginHorizontal: Math.round(size * 0.06) }}>
        <ArrowLeftRight size={arrow} color={color} strokeWidth={2.4} />
      </View>
      <View style={frame}>
        <PoseOutline pose="face_on" width={poseW} height={poseH} color={color} fill />
      </View>
    </View>
  );
}
