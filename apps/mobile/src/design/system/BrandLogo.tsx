import { View, type StyleProp, type ViewStyle } from "react-native";
import Svg, {
  Circle,
  Defs,
  Ellipse,
  G,
  LinearGradient,
  Path,
  RadialGradient,
  Stop,
} from "react-native-svg";

import { useTheme } from "../../theme";
import {
  BRAND_INK,
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
 * lockup. The wordmark takes a colour (white on dark/hero, the brand ink on light — the
 * default follows the theme); the mark's colours are otherwise brand art and stay literal, so
 * the ball keeps its own highlight gradient on every surface.
 *
 * The one exception is the ink-coloured swing path — the arc that sweeps out from under the
 * ball. Painted `BRAND_INK` it vanishes into a dark surface, so on dark it draws white
 * (Taylor, 2026-08-18). The accent arc is a brand colour and never changes.
 */
function renderShape(shape: BrandShape, index: number, ink: string) {
  const fill = shape.f === BRAND_INK ? ink : shape.f;
  if (shape.t === "p") return <Path key={index} d={shape.d} fill={fill} />;
  if (shape.t === "c")
    return <Circle key={index} cx={shape.cx} cy={shape.cy} r={shape.r} fill={fill} />;
  return (
    <Ellipse key={index} cx={shape.cx} cy={shape.cy} rx={shape.rx} ry={shape.ry} fill={fill} />
  );
}

/** The mark's gradients — userSpaceOnUse, so the same defs serve the lockup and the mark. */
function BrandDefs() {
  return (
    <Defs>
      {MARK_GRADIENTS.map((g) => {
        const stops = g.stops.map((s) => (
          <Stop key={`${g.id}-${s.o}`} offset={s.o} stopColor={s.c} />
        ));
        return g.k === "radial" ? (
          <RadialGradient
            key={g.id}
            id={g.id}
            cx={g.cx}
            cy={g.cy}
            fx={g.fx}
            fy={g.fy}
            r={g.r}
            gradientTransform={g.tf}
            gradientUnits="userSpaceOnUse"
          >
            {stops}
          </RadialGradient>
        ) : (
          <LinearGradient
            key={g.id}
            id={g.id}
            x1={g.x1}
            y1={g.y1}
            x2={g.x2}
            y2={g.y2}
            gradientUnits="userSpaceOnUse"
          >
            {stops}
          </LinearGradient>
        );
      })}
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
  const t = useTheme();
  const ink = t.mode === "dark" ? "#FFFFFF" : BRAND_INK;
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel="SwingSage"
      style={[{ width: size, height: size * (73.45 / 76) }, style]}
    >
      <Svg width="100%" height="100%" viewBox={MARK_VIEWBOX}>
        <BrandDefs />
        {MARK_SHAPES.map((s, i) => renderShape(s, i, ink))}
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
  /**
   * Wordmark colour; defaults to white on dark, the brand ink on light. The mark's ink-coloured
   * swing path follows it, so forcing white over a photograph keeps the arc visible too.
   */
  color?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const wordColor = color ?? (t.mode === "dark" ? "#FFFFFF" : BRAND_INK);
  const width = height * (305.15 / 73.45);
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
        {MARK_SHAPES.map((s, i) => renderShape(s, i, wordColor))}
      </Svg>
    </View>
  );
}
