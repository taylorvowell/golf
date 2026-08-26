import { Text, View } from "react-native";

import { FONT_DISPLAY } from "../../../design/system/typography";
import { useTheme } from "../../../theme";

/** The face stand-in every instructor surface uses until photos exist — one look, one place. */
export function InitialsDisc({ initials, size = 40 }: { initials: string; size?: number }) {
  const t = useTheme();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: t.surfaceBlue,
      }}
    >
      <Text
        style={{ color: t.aqua, fontFamily: FONT_DISPLAY.bold, fontSize: Math.round(size * 0.36) }}
      >
        {initials}
      </Text>
    </View>
  );
}
