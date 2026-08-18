import { Text, View, type StyleProp, type ViewStyle } from "react-native";

import { FONT_DISPLAY } from "./typography";
import { useTheme } from "../../theme";

/**
 * A session's name IS its date (Taylor 2026-08-17 — the derived "Morning Practice" titles are
 * gone): "Sunday, Aug 9th", with the ordinal suffix small and raised. RN nested text cannot
 * baseline-shift, so the superscript is a row aligned to the text top — the small suffix's
 * shorter line box is what lifts it.
 */

function ordinalSuffix(day: number): string {
  if (day % 100 >= 11 && day % 100 <= 13) return "th";
  switch (day % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

export function dayTitleParts(ms: number): { main: string; suffix: string } {
  const d = new Date(ms);
  const weekday = d.toLocaleDateString(undefined, { weekday: "long" });
  const month = d.toLocaleDateString(undefined, { month: "short" });
  return { main: `${weekday}, ${month} ${d.getDate()}`, suffix: ordinalSuffix(d.getDate()) };
}

/** The one-string form, for accessibility labels: "Sunday, Aug 9th". */
export function formatDayTitle(ms: number): string {
  const { main, suffix } = dayTitleParts(ms);
  return `${main}${suffix}`;
}

export function DateTitle({
  ms,
  size = 19,
  color,
  style,
}: {
  ms: number;
  size?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const ink = color ?? t.text;
  const { main, suffix } = dayTitleParts(ms);
  return (
    <View
      accessible
      accessibilityLabel={`${main}${suffix}`}
      style={[{ flexDirection: "row", alignItems: "flex-start" }, style]}
    >
      <Text style={{ color: ink, fontFamily: FONT_DISPLAY.extraBold, fontSize: size, lineHeight: size + 4 }}>
        {main}
      </Text>
      <Text
        style={{
          color: ink,
          fontFamily: FONT_DISPLAY.extraBold,
          fontSize: Math.round(size * 0.6),
          lineHeight: Math.round(size * 0.72),
          marginLeft: 1,
        }}
      >
        {suffix}
      </Text>
    </View>
  );
}
