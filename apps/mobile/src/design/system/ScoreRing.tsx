import { Text, View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Path } from "react-native-svg";

import { useTheme } from "../../theme";
import { arcPath } from "./arc";
import { FONT_DISPLAY } from "./typography";

/**
 * `.trend-ring` / `.log-v2-score` (Progress + Swing Log heroes): the translucent ring that
 * sits ON DARK GRADIENT GROUNDS — aqua sweep over a white-12% track, white 900 number, an
 * aqua-tinted uppercase caption. Fixed white-alpha colours are correct here (the ground is
 * always the hero gradient, never a theme surface).
 */
export function ScoreRing({
  score,
  label,
  size = 92,
  style,
}: {
  score: number;
  label?: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const stroke = (10 / 92) * size;
  const r = size / 2 - stroke / 2;
  const c = size / 2;
  const fraction = Math.min(100, Math.max(0, score)) / 100;

  return (
    <View
      accessibilityLabel={label != null ? `${label} ${score}` : `Score ${score}`}
      style={[{ width: size, height: size, alignItems: "center", justifyContent: "center" }, style]}
    >
      <Svg width={size} height={size} style={{ position: "absolute" }}>
        <Path
          d={arcPath(c, c, r, 0, 360)}
          stroke="rgba(255,255,255,0.12)"
          strokeWidth={stroke}
          fill="none"
        />
        {fraction > 0 && (
          <Path
            d={arcPath(c, c, r, 0, fraction * 360)}
            stroke={t.aqua}
            strokeWidth={stroke}
            fill="none"
          />
        )}
      </Svg>
      <Text
        style={{
          color: t.onDark,
          fontFamily: FONT_DISPLAY.black,
          fontSize: (31 / 92) * size,
          lineHeight: (31 / 92) * size,
        }}
      >
        {score}
      </Text>
      {label != null && (
        <Text
          style={{
            marginTop: 4,
            color: "rgba(180,235,238,1)",
            fontFamily: FONT_DISPLAY.black,
            fontSize: 7,
            letterSpacing: 0.84,
            textTransform: "uppercase",
          }}
        >
          {label}
        </Text>
      )}
    </View>
  );
}
