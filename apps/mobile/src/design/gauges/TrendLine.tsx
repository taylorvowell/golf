import { View, type StyleProp, type ViewStyle } from "react-native";

import { COLORS } from "../../theme";

/**
 * A short score history as a polyline — dots at the points, thin rotated bars between them, the
 * newest point enlarged. `.claude/SAMPLE-afterswing.html`'s trend, extracted from the after-swing
 * summary because the home screen draws the same shape over a session's swings.
 *
 * Plain `View`s, no SVG: the segments are percent-positioned bars rotated by the slope, and the
 * box is wide and shallow, so the small-angle stretch error is invisible at 3px thickness. It
 * lives in `design/gauges` with the meters because it is a score reading, not a control.
 */

export interface TrendLineProps {
  /** Scores oldest → newest. Fewer than two points draws nothing — a dot is not a trend. */
  history: number[];
  height?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

export function TrendLine({
  history,
  height = 44,
  color = COLORS.violet,
  style,
  accessibilityLabel,
}: TrendLineProps) {
  if (history.length < 2) return null;
  const lo = Math.min(...history);
  const hi = Math.max(...history);
  const span = Math.max(1, hi - lo);
  // Positions in a unit box; the render maps x onto the measured width via percentages.
  const points = history.map((s, i) => ({
    x: i / (history.length - 1),
    y: 1 - (s - lo) / span,
  }));

  return (
    <View
      style={[{ height, alignSelf: "stretch" }, style]}
      accessibilityLabel={
        accessibilityLabel ?? `Score trend across ${history.length} swings`
      }
    >
      {points.slice(0, -1).map((p, i) => {
        const q = points[i + 1];
        const dx = (q.x - p.x) * 100;
        const midX = ((p.x + q.x) / 2) * 100;
        const midY = ((p.y + q.y) / 2) * (height - 8) + 4;
        const angle = Math.atan2((q.y - p.y) * (height - 8), (q.x - p.x) * 320);
        return (
          <View
            key={`s${i}`}
            style={{
              position: "absolute",
              left: `${midX - dx / 2}%`,
              width: `${dx}%`,
              top: midY - 1.5,
              height: 3,
              borderRadius: 1.5,
              backgroundColor: color,
              transform: [{ rotate: `${(angle * 180) / Math.PI}deg` }],
            }}
          />
        );
      })}
      {points.map((p, i) => {
        const last = i === points.length - 1;
        const r = last ? 5 : 3.5;
        return (
          <View
            key={`p${i}`}
            style={{
              position: "absolute",
              left: `${p.x * 100}%`,
              marginLeft: -r,
              top: p.y * (height - 8) + 4 - r,
              width: r * 2,
              height: r * 2,
              borderRadius: r,
              backgroundColor: COLORS.bg,
              borderWidth: 2.5,
              borderColor: color,
            }}
          />
        );
      })}
    </View>
  );
}
