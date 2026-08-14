import { StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";

import { useAuth } from "../auth/AuthProvider";
import { COLORS } from "../../theme";

/**
 * The signed-in golfer's face, or their initial.
 *
 * Google accounts carry a public photo URL in the session's metadata; email accounts do not.
 * The fallback is the first letter of the address in a violet disc — never a broken-image glyph
 * and never an empty circle, because this is the tap target for the whole profile surface and it
 * has to read as "you" at 34 px.
 */
export function Avatar({ size }: { size: number }) {
  const { email, avatarUrl } = useAuth();
  const radius = size / 2;

  if (avatarUrl) {
    return (
      <Image
        source={{ uri: avatarUrl }}
        style={{ width: size, height: size, borderRadius: radius, backgroundColor: COLORS.panel }}
        contentFit="cover"
        cachePolicy="disk"
        accessibilityIgnoresInvertColors
      />
    );
  }
  return (
    <View
      style={[
        styles.fallback,
        { width: size, height: size, borderRadius: radius },
      ]}
    >
      <Text style={[styles.initial, { fontSize: size * 0.44 }]}>
        {(email?.[0] ?? "?").toUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(139,123,255,0.18)",
  },
  initial: { color: COLORS.violet, fontWeight: "800" },
});
