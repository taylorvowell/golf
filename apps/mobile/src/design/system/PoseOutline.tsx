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
  /**
   * Flip the figure for a left-handed golfer. The art was drawn right-handed; handedness is a
   * correctness requirement, not polish (root CLAUDE.md), so every surface that shows a golfer
   * their own setup passes this from the profile rather than showing a lefty a mirror image
   * of someone else.
   */
  mirrored?: boolean;
}

export function PoseOutline({
  pose,
  width,
  height,
  color,
  strokeWidth = 1,
  fill = false,
  mirrored = false,
}: PoseOutlineProps) {
  const art = CAPTURE_POSES[pose];
  // Mirror inside the art's own viewBox: scale(-1) about x=0, then slide back by the box width,
  // so the flipped figure occupies exactly the frame the placement math computed for it.
  const viewBoxWidth = Number(art.viewBox.split(" ")[2]);
  const transform = mirrored ? `translate(${viewBoxWidth}, 0) scale(-1, 1)` : undefined;
  return (
    <Svg
      width={width}
      height={height}
      viewBox={art.viewBox}
      preserveAspectRatio="xMidYMid meet"
      pointerEvents="none"
    >
      {fill ? (
        <Path d={art.d} fill={color} stroke="none" transform={transform} />
      ) : (
        <Path
          d={art.d}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeMiterlimit={10}
          vectorEffect="non-scaling-stroke"
          transform={transform}
        />
      )}
    </Svg>
  );
}
