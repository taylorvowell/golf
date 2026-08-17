import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BrandLogo } from "./BrandLogo";
import { BRAND } from "./brand";
import { useTheme } from "../../theme";
import { FONT_DISPLAY } from "./typography";

/**
 * The light-ground tab header, composed from the hero screens' top-row idiom (`.log-v2-top` /
 * `.progress-topbar`) for tabs that have no `HeroBackdrop`: brand eyebrow + display title on
 * the left, the cobalt more-circle (the profile door) on the right. `brand` swaps the text
 * block for the real lockup — Home's case, where a title saying SwingSage beside the wordmark
 * would be the repetition rule's textbook case. It owns the top inset (the tab navigator
 * draws no header).
 */
export function ScreenHeader({
  title,
  brand = false,
  onProfile,
  profileTestID = "open-profile",
}: {
  title?: string;
  brand?: boolean;
  onProfile: () => void;
  profileTestID?: string;
}) {
  const insets = useSafeAreaInsets();
  const t = useTheme();

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: brand ? "center" : "flex-start",
        justifyContent: "space-between",
        gap: 10,
        paddingHorizontal: 18,
        paddingTop: insets.top + 12,
        paddingBottom: 10,
      }}
    >
      {brand ? (
        <BrandLogo height={26} />
      ) : (
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            style={{
              color: t.aqua,
              fontFamily: FONT_DISPLAY.black,
              fontSize: 9,
              letterSpacing: 1.62,
              textTransform: "uppercase",
            }}
          >
            {BRAND}
          </Text>
          <Text
            style={{
              marginTop: 6,
              color: t.text,
              fontFamily: FONT_DISPLAY.black,
              fontSize: 30,
              lineHeight: 30,
              letterSpacing: -1.5,
            }}
          >
            {title}
          </Text>
        </View>
      )}
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
  );
}
