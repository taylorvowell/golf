import type { StyleProp, ViewStyle } from "react-native";
import { Text, View } from "react-native";
import { Image } from "expo-image";

import { FONT_DISPLAY } from "../../design/system/typography";
import { useTheme } from "../../theme";
import type { Coach } from "./coaches";

/**
 * A coach's portrait as a circle. One component so the settings picker, the Coach hero and
 * every future coach appearance crop and size the art identically.
 *
 * **A coach without art still draws.** Portraits are bundled with `require`, which resolves at
 * BUNDLE time — so a missing file is not a gap in the UI, it is a Metro 500 that takes the whole
 * app down. Making the art optional here is what lets the roster carry a coach whose picture is
 * still being made; the initial stands in, and the app keeps launching.
 */
export function CoachAvatar({
  coach,
  size = 56,
  style,
}: {
  coach: Coach;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  return (
    <View
      style={[
        { width: size, height: size, borderRadius: size / 2, overflow: "hidden", backgroundColor: t.surface2 },
        style,
      ]}
    >
      {coach.portrait ? (
        <Image
          source={coach.portrait}
          style={{ width: "100%", height: "100%" }}
          contentFit="cover"
          cachePolicy="memory-disk"
          accessibilityLabel={`${coach.name}, AI coach`}
        />
      ) : (
        <View
          style={{ width: "100%", height: "100%", alignItems: "center", justifyContent: "center" }}
          accessible
          accessibilityLabel={`${coach.name}, AI coach`}
        >
          <Text
            style={{
              color: t.text,
              fontFamily: FONT_DISPLAY.black,
              // Tracks the circle so one component serves a 28pt row and a 96pt hero.
              fontSize: size * 0.4,
            }}
          >
            {coach.name.slice(0, 1)}
          </Text>
        </View>
      )}
    </View>
  );
}
