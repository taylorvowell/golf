import { View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Stop } from "react-native-svg";

import { useTheme } from "../../theme";
import {
  LOGO_VIEWBOX,
  MARK_GRADIENTS,
  MARK_SHAPES,
  MARK_VIEWBOX,
  WORDMARK_PATHS,
  type BrandShape,
} from "./brandPaths";

/**
 * The real SwingSage lockup (`assets/brand/swingsage-logo.svg`), replacing every mockup
 * `.brandmark` placeholder. `BrandMark` is the ball-and-swoosh alone; `BrandLogo` the full
 * lockup. The wordmark takes a colour (white on dark/hero, the brand charcoal on light — the
 * default follows the theme); the mark's colours are brand art and stay literal — its charcoal
 * disc plate is what keeps the white ball readable on light surfaces, so nothing is recoloured.
 */
function renderShape(shape: BrandShape, index: number) {
  if (shape.t === "p") return <Path key={index} d={shape.d} fill={shape.f} />;
  if (shape.t === "c")
    return <Circle key={index} cx={shape.cx} cy={shape.cy} r={shape.r} fill={shape.f} />;
  return (
    <Ellipse key={index} cx={shape.cx} cy={shape.cy} rx={shape.rx} ry={shape.ry} fill={shape.f} />
  );
}

/** The swoosh gradients — userSpaceOnUse, so the same defs serve the lockup and the mark. */
function BrandDefs() {
  return (
    <Defs>
      {MARK_GRADIENTS.map((g) => (
        <LinearGradient
          key={g.id}
          id={g.id}
          x1={g.x1}
          y1={g.y1}
          x2={g.x2}
          y2={g.y2}
          gradientUnits="userSpaceOnUse"
        >
          {g.stops.map((s) => (
            <Stop key={`${g.id}-${s.o}`} offset={s.o} stopColor={s.c} />
          ))}
        </LinearGradient>
      ))}
    </Defs>
  );
}

export function BrandMark({
  size = 42,
  style,
}: {
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel="SwingSage"
      style={[{ width: size, height: size * (79.85 / 80) }, style]}
    >
      <Svg width="100%" height="100%" viewBox={MARK_VIEWBOX}>
        <BrandDefs />
        {MARK_SHAPES.map(renderShape)}
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
  /** Wordmark colour; defaults to white on dark, the brand charcoal on light. */
  color?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const wordColor = color ?? (t.mode === "dark" ? "#FFFFFF" : "#282828");
  const width = height * (301.05 / 79.85);
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel="SwingSage"
      style={[{ width, height }, style]}
    >
      <Svg width="100%" height="100%" viewBox={LOGO_VIEWBOX}>
        <BrandDefs />
        <G>
          {WORDMARK_PATHS.map((d) => (
            <Path key={d.slice(0, 24)} d={d} fill={wordColor} />
          ))}
        </G>
        {MARK_SHAPES.map(renderShape)}
      </Svg>
    </View>
  );
}
