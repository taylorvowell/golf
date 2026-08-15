import { View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Circle, Ellipse, G, Path } from "react-native-svg";

import { useTheme } from "../../theme";
import {
  LOGO_VIEWBOX,
  MARK_SHAPES,
  MARK_VIEWBOX,
  WORDMARK_PATHS,
  type BrandShape,
} from "./brandPaths";

/**
 * The real SwingSage lockup (`assets/brand/swingsage-logo.svg`), replacing every mockup
 * `.brandmark` placeholder. `BrandMark` is the ball-and-swoosh alone; `BrandLogo` the full
 * lockup. The wordmark takes a colour (white on dark/hero, navy on light — the default
 * follows the theme); the mark's aqua/ball colours are brand art and stay literal.
 */
function renderShape(shape: BrandShape, index: number, recolor?: (fill: string) => string) {
  const fill = recolor ? recolor(shape.f) : shape.f;
  if (shape.t === "p") return <Path key={index} d={shape.d} fill={fill} />;
  if (shape.t === "c")
    return <Circle key={index} cx={shape.cx} cy={shape.cy} r={shape.r} fill={fill} />;
  return (
    <Ellipse key={index} cx={shape.cx} cy={shape.cy} rx={shape.rx} ry={shape.ry} fill={fill} />
  );
}

export function BrandMark({
  size = 42,
  style,
}: {
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  // On light surfaces the mark's white fills would vanish — they become navy there.
  const recolor = (fill: string) =>
    fill === "#fff" && t.mode === "light" ? "#14244F" : fill;
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel="SwingSage"
      style={[{ width: size, height: size * (79.85 / 80) }, style]}
    >
      <Svg width="100%" height="100%" viewBox={MARK_VIEWBOX}>
        {MARK_SHAPES.map((shape, i) => renderShape(shape, i, recolor))}
      </Svg>
    </View>
  );
}

export function BrandLogo({
  height = 24,
  color,
  style,
}: {
  height?: number;
  /** Wordmark colour; defaults to white on dark, navy on light. */
  color?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const wordColor = color ?? (t.mode === "dark" ? "#FFFFFF" : "#14244F");
  const recolor = (fill: string) => (fill === "#fff" ? wordColor : fill);
  const width = height * (301.05 / 79.85);
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel="SwingSage"
      style={[{ width, height }, style]}
    >
      <Svg width="100%" height="100%" viewBox={LOGO_VIEWBOX}>
        <G>
          {WORDMARK_PATHS.map((d) => (
            <Path key={d.slice(0, 24)} d={d} fill={wordColor} />
          ))}
        </G>
        {MARK_SHAPES.map((shape, i) => renderShape(shape, i, recolor))}
      </Svg>
    </View>
  );
}
