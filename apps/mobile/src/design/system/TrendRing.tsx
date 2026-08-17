import { Text, View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Path } from "react-native-svg";

import { useTheme } from "../../theme";
import { arcPath } from "./arc";
import { FONT_DISPLAY } from "./typography";

/**
 * `.trend-ring` (Progress hero): ScoreRing's dark-ground sibling for a NON-score reading —
 * a big value ("+8") over an uppercase caption ("Net gain"), aqua sweep on a white-12%
 * track. The sweep fraction is the caller's, separately from the value, because the number
 * shown (a delta) and the level swept (where the averages sit) are different real
 * quantities; `fraction: null` draws the track alone — the abstaining state, never a canned
 * sweep. (The mockup's conic-gradient becomes an arc stroke — the declared primitive.)
 */
export function TrendRing({
  value,
  caption,
  fraction,
  size = 92,
  style,
}: {
  /** Already-formatted reading, e.g. "+8" — or "—" while abstaining. */
  value: string;
  caption: string;
  /** 0–1 sweep, or null for track-only (no data to sweep to). */
  fraction: number | null;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const stroke = (10 / 92) * size;
  const r = size / 2 - stroke / 2;
  const c = size / 2;
  const clamped = fraction === null ? 0 : Math.min(1, Math.max(0, fraction));

  return (
    <View
      accessibilityLabel={`${caption} ${value}`}
      style={[
        { width: size, height: size, alignItems: "center", justifyContent: "center" },
        style,
      ]}
    >
      <Svg width={size} height={size} style={{ position: "absolute" }}>
        <Path
          d={arcPath(c, c, r, 0, 360)}
          stroke="rgba(255,255,255,0.12)"
          strokeWidth={stroke}
          fill="none"
        />
        {clamped > 0 && (
          <Path
            d={arcPath(c, c, r, 0, clamped * 360)}
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
        {value}
      </Text>
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
        {caption}
      </Text>
    </View>
  );
}
