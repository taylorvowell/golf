import { View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Circle, Path, Polygon, Rect } from "react-native-svg";

import { BRAND_ICONS, type BrandIconArt, type BrandIconName } from "./brandIconPaths";
import { useTheme } from "../../theme";

/**
 * The renderer for the supplied icon set (`brandIconPaths.ts`) — every path painted in ONE
 * caller-given colour, which is what lets the same art serve a tab (tab colour), a label
 * (text colour) or a tile. `size` is one edge — width by default, or height with
 * `sizeBy="height"` — and the other edge follows the art's own aspect, so a glyph is never
 * squashed to fit a square. Rows of mixed-aspect glyphs (the tab bar) size by height, or a
 * wide glyph reads smaller than its square neighbours.
 *
 * `BrandIcon` is the bare glyph. `BrandIconThumb` is the glyph on the Progress tiles' bed
 * (StickThumb's exact tint), for the category tiles whose supplied icon has replaced the
 * placeholder stick figure.
 */
export function BrandIcon({
  name,
  size = 21,
  sizeBy = "width",
  color,
  style,
}: {
  name: BrandIconName;
  size?: number;
  /** Which edge `size` fixes; the other follows the art's aspect. */
  sizeBy?: "width" | "height";
  color: string;
  style?: StyleProp<ViewStyle>;
}) {
  // Widened to the interface: entries without rects/circles otherwise make the union
  // reject the optional-shape reads below.
  const art: BrandIconArt = BRAND_ICONS[name];
  return (
    <Svg
      width={sizeBy === "width" ? size : size * (art.w / art.h)}
      height={sizeBy === "width" ? size * (art.h / art.w) : size}
      viewBox={`0 0 ${art.w} ${art.h}`}
      style={style}
    >
      {art.paths.map((d) => (
        <Path key={d.slice(0, 24)} d={d} fill={color} />
      ))}
      {art.rects?.map((r, i) => (
        <Rect
          key={`r${i}`}
          x={r.x}
          y={r.y}
          width={r.w}
          height={r.h}
          transform={r.tf}
          fill={color}
        />
      ))}
      {art.circles?.map((c, i) => (
        <Circle key={`c${i}`} cx={c.cx} cy={c.cy} r={c.r} fill={color} />
      ))}
      {art.polygons?.map((points, i) => (
        <Polygon key={`p${i}`} points={points} fill={color} />
      ))}
      {art.strokes?.map((s, i) => (
        <Path
          key={`s${i}`}
          d={s.d}
          stroke={color}
          strokeWidth={s.w}
          strokeLinecap={s.cap ?? "butt"}
          strokeLinejoin="round"
          fill="none"
        />
      ))}
    </Svg>
  );
}

export function BrandIconThumb({
  name,
  size = 56,
  color,
  style,
}: {
  name: BrandIconName;
  /** The bed's square size; the glyph fills ~60% of it, like StickThumb's figure. */
  size?: 56 | 48 | number;
  /** Defaults to aqua — the same voice as the stick figures' bone strokes. */
  color?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: 12,
          alignItems: "center",
          justifyContent: "center",
          // StickThumb's bed tint, verbatim — the two thumb faces must sit identically.
          backgroundColor:
            t.mode === "dark" ? "rgba(63,87,218,0.20)" : "rgba(47,70,207,0.13)",
        },
        style,
      ]}
    >
      <BrandIcon name={name} size={size * 0.58} color={color ?? t.aqua} />
    </View>
  );
}
