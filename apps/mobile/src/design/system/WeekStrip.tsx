import { Text, View, type StyleProp, type ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

import { useTheme } from "../../theme";
import { FONT_DISPLAY } from "./typography";

/**
 * `.week-strip` / `.day-chip` (mockup §01 phone): seven 52pt day chips — surface gradient at
 * rest, cobalt gradient + cobalt shadow when active, a 4px aqua dot on days with swings.
 */
export interface WeekDay {
  /** Two-letter day label, e.g. "MO". */
  label: string;
  dayOfMonth: number;
  active?: boolean;
  hasSwings?: boolean;
}

export function WeekStrip({
  days,
  style,
}: {
  days: WeekDay[];
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  return (
    <View style={[{ flexDirection: "row", gap: 6 }, style]}>
      {days.map((day) => {
        const inner = (
          <>
            <Text
              style={{
                color: day.active ? t.onDark : t.muted,
                fontFamily: FONT_DISPLAY.black,
                fontSize: 8,
              }}
            >
              {day.label}
            </Text>
            <Text
              style={{
                color: day.active ? t.onDark : t.text,
                fontFamily: FONT_DISPLAY.black,
                fontSize: 11,
              }}
            >
              {day.dayOfMonth}
            </Text>
            {day.hasSwings && (
              <View
                style={{
                  width: 4,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: day.active ? "#B4EBEE" : t.aqua,
                }}
              />
            )}
          </>
        );
        const shared: ViewStyle = {
          flex: 1,
          minHeight: 52,
          borderRadius: 7,
          alignItems: "center",
          justifyContent: "center",
          gap: 4,
        };
        return day.active ? (
          <LinearGradient
            key={day.label + day.dayOfMonth}
            colors={[t.cobalt, t.cobaltPressed]}
            style={{ ...shared, ...t.shadowCobalt }}
          >
            {inner}
          </LinearGradient>
        ) : (
          <View
            key={day.label + day.dayOfMonth}
            style={{ ...shared, backgroundColor: t.surface, ...t.shadowSm }}
          >
            {inner}
          </View>
        );
      })}
    </View>
  );
}
