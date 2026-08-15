import { Text, View, type StyleProp, type ViewStyle } from "react-native";

import { useTheme } from "../../theme";
import { FONT_DISPLAY } from "./typography";

/**
 * `.meta-chip` (mockup §01) and `.progress-top-chip` (Progress hero). The meta chip sits on
 * light surfaces; `translucent` is the dark-hero variant — near-black glass pill with white
 * text, radius 999 (the mockup's backdrop blur is dropped per the named deviation; the fill
 * is already 48% ink so the difference is minimal).
 */
export function Chip({
  label,
  translucent,
  style,
}: {
  label: string;
  translucent?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  return (
    <View
      style={[
        translucent
          ? {
              minHeight: 28,
              paddingHorizontal: 10,
              borderRadius: 999,
              backgroundColor: "rgba(7,16,31,0.48)",
            }
          : {
              minHeight: 30,
              paddingHorizontal: 10,
              borderRadius: 5,
              backgroundColor: t.surface,
              ...t.shadowSm,
            },
        { alignSelf: "flex-start", alignItems: "center", justifyContent: "center" },
        style,
      ]}
    >
      <Text
        style={{
          color: translucent ? t.onDark : t.muted,
          fontFamily: translucent ? FONT_DISPLAY.black : FONT_DISPLAY.extraBold,
          fontSize: translucent ? 8 : 10,
          letterSpacing: translucent ? 0.64 : 0.7,
          textTransform: "uppercase",
        }}
      >
        {label}
      </Text>
    </View>
  );
}
