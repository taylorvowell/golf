import { Pressable, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { useTheme } from "../../theme";
import { FONT_DISPLAY } from "./typography";

/**
 * `.segmented` (mockup §05): surface2 track (radius 8, 3px padding), 36pt segments
 * (radius 5); the active segment lifts onto a surface fill with cobalt text + shadowSm.
 * Selection is fill + colour, never an outline (borderless rule).
 */
export function Segmented({
  options,
  value,
  onChange,
  style,
}: {
  options: string[];
  value: string;
  onChange: (next: string) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  return (
    <View
      accessibilityRole="tablist"
      style={[
        {
          flexDirection: "row",
          gap: 3,
          padding: 3,
          borderRadius: 8,
          backgroundColor: t.surface2,
        },
        style,
      ]}
    >
      {options.map((option) => {
        const active = option === value;
        return (
          <Pressable
            key={option}
            accessibilityRole="tab"
            accessibilityLabel={option}
            accessibilityState={{ selected: active }}
            onPress={() => onChange(option)}
            hitSlop={6}
            style={[
              {
                flex: 1,
                minHeight: 36,
                borderRadius: 5,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: active ? t.surface : "transparent",
              },
              active ? t.shadowSm : null,
            ]}
          >
            <Text
              style={{
                color: active ? t.cobalt : t.muted,
                fontFamily: FONT_DISPLAY.black,
                fontSize: 9,
                textTransform: "uppercase",
              }}
            >
              {option}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
