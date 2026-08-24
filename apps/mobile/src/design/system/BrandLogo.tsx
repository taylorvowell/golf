import { useId } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Stop } from "react-native-svg";

import { useTheme } from "../../theme";
import {
  BRAND_INK,
  INK_ON_LIGHT,
  LOGO_RATIO,
  LOGO_VIEWBOX,
  MARK_RATIO,
  MARK_SHAPES,
  MARK_SPAN,
  MARK_VIEWBOX,
  SLAB_FILL,
  SWING_FILL,
  SWING_STOPS,
  SWING_STOPS_ON_LIGHT,
  WORDMARK_PATHS,
  type BrandShape,
} from "./brandPaths";

/**
 * The real SwingSage lockup (`assets/brand/swingsage-logo.svg`), replacing every mockup
 * `.brandmark` placeholder. `BrandMark` is the figure-and-slabs alone; `BrandLogo` the full
 * lockup. The wordmark takes a colour (white on dark/hero, the brand ink on light — the
 * default follows the theme); the accent is brand art and stays literal on every surface.
 *
 * The ink-coloured figure follows the wordmark rather than staying literal: painted
 * `BRAND_INK` it vanishes into a dark surface, so on dark it draws white (Taylor, 2026-08-18).
 *
 * The swing arc is the other resolved fill — a left-to-right ramp across the scheme's anchors
 * rather than one colour. **The same ramp on every surface**: it does NOT swap by theme the way
 * the ink does, because the ink is legibility and the arc is identity (see `brandPaths.ts`).
 *
 * **`SwingGradient` is exported, and anything drawing the swoosh must use it rather than building
 * an equivalent.** A second hand-written ramp is how the loaders ended up almost-but-not-quite the
 * lockup's; one definition is the only way that stays true.
 *
 * **The id is per instance, not module-scoped.** react-native-svg keeps ONE global registry of
 * gradient ids, so a shared constant means the last component to mount defines the gradient every
 * earlier one is still referencing — a `BrandMark` beside a `BrandLogo`, or a lockup beside a
 * loader, silently repaints whichever lost. `useId` gives each mount its own.
 */
export function useSwingGradientId() {
  return `brand-swing-${useId()}`;
}

export function SwingGradient({
  id,
  x2,
  stops = SWING_STOPS,
}: {
  id: string;
  x2: number;
  /** Which ramp. Light surfaces pass `SWING_STOPS_ON_LIGHT`; everything else takes the default. */
  stops?: readonly { offset: string; color: string }[];
}) {
  return (
    <Defs>
      {/* User-space so the ramp spans the ARTWORK, not each path's own box — per-path units would
          give every piece of the arc its own private gradient and lose the sweep. */}
      <LinearGradient
        id={id}
        x1="0"
        y1="0"
        x2={x2}
        y2="0"
        gradientUnits="userSpaceOnUse"
      >
        {stops.map((s) => (
          <Stop key={s.offset} offset={s.offset} stopColor={s.color} />
        ))}
      </LinearGradient>
    </Defs>
  );
}

function renderShape(
  shape: BrandShape,
  index: number,
  parts: { figure: string; slab: string },
  swingId: string,
) {
  /** `"swing"` is a request for the arc's gradient — the golfer takes it on a light surface. */
  const resolve = (v: string) => (v === "swing" ? `url(#${swingId})` : v);
  const fill =
    shape.f === BRAND_INK
      ? resolve(parts.figure)
      : shape.f === SLAB_FILL
        ? resolve(parts.slab)
        : shape.f === SWING_FILL
          ? `url(#${swingId})`
          : shape.f;
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
  const dark = t.mode === "dark";
  const swingId = useSwingGradientId();
  // Light: the golfer rides the arc's ramp. Dark: it is white, because that ramp's deep end would
  // sink into the ground.
  const parts = { figure: dark ? "#FFFFFF" : "swing", slab: SLAB_FILL };
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel="SwingSage"
      style={[{ width: size, height: size * MARK_RATIO }, style]}
    >
      <Svg width="100%" height="100%" viewBox={MARK_VIEWBOX}>
        <SwingGradient
          id={swingId}
          x2={MARK_SPAN}
          stops={dark ? SWING_STOPS : SWING_STOPS_ON_LIGHT}
        />
        {MARK_SHAPES.map((s, i) => renderShape(s, i, parts, swingId))}
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
   * figure follows it, so forcing white over a photograph keeps the figure visible too.
   */
  color?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const wordColor = color ?? (t.mode === "dark" ? "#FFFFFF" : INK_ON_LIGHT);
  const swingId = useSwingGradientId();
  // A caller forcing white is over a photo or a hero, which is a dark ground whatever the theme
  // says — so the ramp and the figure follow the wordmark's colour, not the theme's.
  const onDark = wordColor === "#FFFFFF";
  const parts = { figure: onDark ? wordColor : "swing", slab: SLAB_FILL };
  const width = height * LOGO_RATIO;
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel="SwingSage"
      style={[{ width, height }, style]}
    >
      <Svg width="100%" height="100%" viewBox={LOGO_VIEWBOX}>
        <SwingGradient
          id={swingId}
          x2={MARK_SPAN}
          stops={onDark ? SWING_STOPS : SWING_STOPS_ON_LIGHT}
        />
        <G>
          {WORDMARK_PATHS.map((d) => (
            <Path key={d.slice(0, 24)} d={d} fill={wordColor} />
          ))}
        </G>
        {MARK_SHAPES.map((s, i) => renderShape(s, i, parts, swingId))}
      </Svg>
    </View>
  );
}
