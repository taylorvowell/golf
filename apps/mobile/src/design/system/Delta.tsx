import { Text, View, type StyleProp, type ViewStyle } from "react-native";

import { useTheme } from "../../theme";
import { FONT_DISPLAY } from "./typography";

/**
 * `.delta2` (mockup §05): the ▲/▼ change pill — min-height 26, radius 999, 900/9 display
 * face, good/bad colouring. The mockup's tinted hairline becomes a matching 8% tint fill
 * (borderless rule).
 */
export function Delta({
  value,
  direction,
  style,
}: {
  /** Already-formatted magnitude, e.g. "+7" / "-5". */
  value: string;
  direction: "up" | "down";
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const color = direction === "up" ? t.good : t.bad;
  const bg = direction === "up" ? "rgba(40,168,107,0.08)" : "rgba(229,87,100,0.08)";
  return (
    <View
      accessibilityLabel={`${direction === "up" ? "up" : "down"} ${value}`}
      style={[
        {
          minHeight: 26,
          paddingHorizontal: 8,
          borderRadius: 999,
          alignSelf: "flex-start",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "row",
          gap: 3,
          backgroundColor: bg,
        },
        style,
      ]}
    >
      <Text style={{ color, fontFamily: FONT_DISPLAY.black, fontSize: 9 }}>
        {direction === "up" ? "▲" : "▼"} {value}
      </Text>
    </View>
  );
}
