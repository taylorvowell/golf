import { useEffect, useRef } from "react";
import { Animated, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BrandLogo } from "./BrandLogo";
import { useNavVisibility } from "./navVisibility";
import { useTheme } from "../../theme";

/**
 * The app's persistent top chrome (Taylor 2026-08-17): the SwingSage lockup left, the profile
 * door right, identical on every tab. It floats over the screen's own content — each tab pads
 * its scroll by `APP_HEADER_BAR` + the top inset — and slides away/back on the shared
 * `navVisibility` flag, the same scroll-driven clock as the wave bar below. Per the chrome
 * rule, scroll position is the only thing allowed to move it.
 *
 * `hero` puts it on the dark hero screens (Swing Log, Progress): white wordmark. The bar has
 * NO ground of its own (Taylor 2026-08-17): it is transparent at every scroll position, so
 * the screen's own surface always shows through it.
 */

/** The bar's content height, below the top inset. Screens pad their scroll by inset + this. */
export const APP_HEADER_BAR = 56;

export function AppHeader({
  hero = false,
  onProfile,
  profileTestID = "open-profile",
}: {
  hero?: boolean;
  onProfile: () => void;
  profileTestID?: string;
}) {
  const insets = useSafeAreaInsets();
  const t = useTheme();
  const { hidden } = useNavVisibility();
  const height = insets.top + APP_HEADER_BAR;

  const slide = useRef(new Animated.Value(hidden ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(slide, {
      toValue: hidden ? 1 : 0,
      duration: 280,
      useNativeDriver: true,
    }).start();
  }, [hidden, slide]);

  return (
    <Animated.View
      pointerEvents={hidden ? "none" : "box-none"}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height,
        transform: [
          { translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [0, -height] }) },
        ],
        opacity: slide.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
      }}
    >
      <View
        style={{
          position: "absolute",
          left: 18,
          right: 18,
          bottom: 7,
          height: 42,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <BrandLogo height={26} color={hero ? "#FFFFFF" : undefined} />
        <Pressable
          testID={profileTestID}
          accessibilityRole="button"
          accessibilityLabel="Profile and settings"
          onPress={onProfile}
          hitSlop={8}
          style={({ pressed }) => [
            {
              width: 42,
              height: 42,
              borderRadius: 21,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: pressed ? t.cobaltPressed : t.cobalt,
              // The dev-client bubble pins to the top-right and swallows taps; release keeps
              // the corner (the gated layout accommodation, not an instrument).
              marginRight: __DEV__ ? 56 : 0,
            },
            t.shadowCobalt,
          ]}
        >
          <View style={{ flexDirection: "row", gap: 3.5 }}>
            <View style={{ width: 3.5, height: 3.5, borderRadius: 2, backgroundColor: t.onDark }} />
            <View style={{ width: 3.5, height: 3.5, borderRadius: 2, backgroundColor: t.onDark }} />
            <View style={{ width: 3.5, height: 3.5, borderRadius: 2, backgroundColor: t.onDark }} />
          </View>
        </Pressable>
      </View>
    </Animated.View>
  );
}
