import Svg, { Path } from "react-native-svg";

import { CAPTURE_POSES } from "./capturePoses";

/**
 * One of Taylor's capture-pose outlines (`capturePoses.ts`), stroked in the caller's
 * colour. The same art serves two sizes — the full-screen alignment guide and the 20px
 * view-switcher icon — which is why the stroke is `non-scaling`: it is given in screen
 * pixels and holds its weight at any scale, where the art's authored width (5 viewBox
 * units) would vanish at icon size and read fat at full screen.
 *
 * The box contains the art (`xMidYMid meet`) — an outline cropped at the wrists is worse
 * than one with margins.
 */

export interface PoseOutlineProps {
  pose: "dtl" | "face_on";
  width: number;
  height: number;
  color: string;
  /** Screen-pixel stroke weight (non-scaling). Ignored in `fill` mode. */
  strokeWidth?: number;
  /** Solid silhouette instead of the stroked outline — the view switcher's icons. */
  fill?: boolean;
}

export function PoseOutline({
  pose,
  width,
  height,
  color,
  strokeWidth = 3,
  fill = false,
}: PoseOutlineProps) {
  const art = CAPTURE_POSES[pose];
  return (
    <Svg
      width={width}
      height={height}
      viewBox={art.viewBox}
      preserveAspectRatio="xMidYMid meet"
      pointerEvents="none"
    >
      {fill ? (
        <Path d={art.d} fill={color} stroke="none" />
      ) : (
        <Path
          d={art.d}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeMiterlimit={10}
          vectorEffect="non-scaling-stroke"
        />
      )}
    </Svg>
  );
}
