import { View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";

import { useTheme } from "../../theme";

/**
 * `.stick-thumb` (Progress mockup): the little stick-figure tile — 56px (48 compact),
 * cobalt/aqua-tinted gradient-ish bed, and an svg figure whose stroke colours are the
 * mockup's literal palette (joints #F7C948, bones #2DF0FB, accent #67E08A, trace #8AF7FD /
 * #5CF4FC — data-display constants, the same standing as the overlay's web-parity colours).
 * Path data comes per-instance: each focus area shows its own pose.
 */
export interface StickFigure {
  /** Bone polylines (SVG path data in a 42×42 space). */
  bones?: string[];
  /** Accent strokes (the highlighted limb). */
  accents?: string[];
  /** Dashed club/hand trace. */
  traces?: string[];
  /** Solid secondary trace. */
  traces2?: string[];
  /** Joint dots. */
  joints?: Array<{ x: number; y: number }>;
  /** Ground line. */
  ground?: string;
}

export const STICK = {
  joint: "#F7C948",
  bone: "#2DF0FB",
  accent: "#67E08A",
  trace: "#8AF7FD",
  trace2: "#5CF4FC",
} as const;

export function StickThumb({
  figure,
  size = 56,
  style,
}: {
  figure: StickFigure;
  size?: 56 | 48 | number;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const svgSize = (42 / 56) * size;
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: 12,
          alignItems: "center",
          justifyContent: "center",
          // .stick-thumb bed: cobalt 16% → aqua 10% (flattened to the midpoint tint).
          backgroundColor:
            t.mode === "dark" ? "rgba(31,169,239,0.20)" : "rgba(13,148,219,0.13)",
        },
        style,
      ]}
    >
      <Svg width={svgSize} height={svgSize} viewBox="0 0 42 42">
        {figure.ground != null && (
          <Path
            d={figure.ground}
            stroke="rgba(255,255,255,0.16)"
            strokeWidth={1.4}
            strokeLinecap="round"
            fill="none"
          />
        )}
        {figure.traces?.map((d) => (
          <Path
            key={d}
            d={d}
            stroke={STICK.trace}
            strokeWidth={2.1}
            strokeLinecap="round"
            strokeDasharray="2 4"
            opacity={0.95}
            fill="none"
          />
        ))}
        {figure.traces2?.map((d) => (
          <Path
            key={d}
            d={d}
            stroke={STICK.trace2}
            strokeWidth={2.2}
            strokeLinecap="round"
            opacity={0.95}
            fill="none"
          />
        ))}
        {figure.bones?.map((d) => (
          <Path
            key={d}
            d={d}
            stroke={STICK.bone}
            strokeWidth={2.6}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        ))}
        {figure.accents?.map((d) => (
          <Path
            key={d}
            d={d}
            stroke={STICK.accent}
            strokeWidth={2.3}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        ))}
        {figure.joints?.map((joint) => (
          <Circle
            key={`${joint.x},${joint.y}`}
            cx={joint.x}
            cy={joint.y}
            r={2}
            fill={STICK.joint}
          />
        ))}
      </Svg>
    </View>
  );
}
