import { Text, View } from "react-native";
import { Image } from "expo-image";

import { useAuth } from "../auth/AuthProvider";
import { themedStyles, useTheme } from "../../theme";

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
  const t = useTheme();
  const styles = useStyles();
  const radius = size / 2;

  if (avatarUrl) {
    return (
      <Image
        source={{ uri: avatarUrl }}
        style={{ width: size, height: size, borderRadius: radius, backgroundColor: t.surface }}
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

/** Lavender at 16% — the Tag pattern's named tint, not a hand-mix beside a token. */
const LAVENDER_BED = "rgba(133,141,194,0.16)";

const useStyles = themedStyles((t) => ({
  fallback: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: LAVENDER_BED,
  },
  initial: { color: t.lavender, fontWeight: "800" },
}));
