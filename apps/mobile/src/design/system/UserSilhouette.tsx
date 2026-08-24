import Svg, { Circle, Path } from "react-native-svg";

/**
 * The generic person — head and shoulders, solid fill — for any circular avatar with no photo
 * behind it (Taylor, 2026-08-24: the default is the silhouette, not an initial).
 *
 * Drawn on a 100-unit stage sized to be CLIPPED by the caller's circle: the shoulders run past
 * the bottom edge on purpose, which is what makes the classic placeholder read as a bust rather
 * than a floating icon. The caller owns the circle (`borderRadius` + `overflow: "hidden"`) and
 * the bed colour; this component knows only the shape.
 */
export function UserSilhouette({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" pointerEvents="none">
      <Circle cx={50} cy={38} r={17.5} fill={color} />
      {/* Shoulders: a bust whose base is wider than the stage, so the circle crops it. */}
      <Path
        d="M50 61 C 30 61 15.5 74 12.5 92 L 12.5 104 L 87.5 104 L 87.5 92 C 84.5 74 70 61 50 61 Z"
        fill={color}
      />
    </Svg>
  );
}
