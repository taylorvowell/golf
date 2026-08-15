import { Text, View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Path } from "react-native-svg";

import { useTheme } from "../../theme";
import { arcPath } from "./arc";
import { FONT_DISPLAY } from "./typography";

/**
 * `.score-orb` (mockup §06): the conic score ring — `--score` percent of the circumference
 * in the score colour, the remainder in surface3, an inner surface disc, and the 900-weight
 * number. Ring thickness is the mockup's 8px inset at 92px, scaled with size.
 * Colour defaults to aqua; pass `color` for per-score colouring (good/bad bands).
 */
export function ScoreOrb({
  score,
  size = 92,
  color,
  caption,
  style,
}: {
  /** 0–100; also the rendered number. */
  score: number;
  size?: 92 | 56 | 40 | number;
  color?: string;
  caption?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const ringColor = color ?? t.aqua;
  const stroke = (8 / 92) * size;
  const r = size / 2 - stroke / 2;
  const c = size / 2;
  const fraction = Math.min(100, Math.max(0, score)) / 100;
  const fontSize = size >= 92 ? 34 : size >= 56 ? 18 : 12;

  return (
    <View
      accessibilityLabel={caption != null ? `${caption} ${score}` : `Score ${score}`}
      style={[{ width: size, height: size }, style]}
    >
      <Svg width={size} height={size}>
        {/* The track (the conic's surface-3 remainder), then the score sweep over it. */}
        <Path
          d={arcPath(c, c, r, 0, 360)}
          stroke={t.surface3}
          strokeWidth={stroke}
          fill="none"
        />
        {fraction > 0 && (
          <Path
            d={arcPath(c, c, r, 0, fraction * 360)}
            stroke={ringColor}
            strokeWidth={stroke}
            fill="none"
          />
        )}
      </Svg>
      <View
        style={{
          position: "absolute",
          inset: stroke,
          borderRadius: 999,
          backgroundColor: t.surface,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text
          style={{
            color: t.text,
            fontFamily: FONT_DISPLAY.black,
            fontSize,
            letterSpacing: -0.05 * fontSize,
          }}
        >
          {score}
        </Text>
        {caption != null && size >= 92 && (
          <Text
            style={{
              position: "absolute",
              bottom: 10,
              color: t.muted,
              fontFamily: FONT_DISPLAY.black,
              fontSize: 7,
              letterSpacing: 0.84,
              textTransform: "uppercase",
            }}
          >
            {caption}
          </Text>
        )}
      </View>
    </View>
  );
}
