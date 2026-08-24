import { View } from "react-native";
import { Image } from "expo-image";

import { UserSilhouette } from "../../design/system";
import { useAuthenticatedImage } from "../../platform/useAuthenticatedImage";
import { themedStyles, useTheme } from "../../theme";
import { useAuth } from "../auth/AuthProvider";
import { useAvatarUrl } from "./useProfile";

/**
 * The signed-in golfer's face, or the generic silhouette.
 *
 * Three sources, in order: a photo uploaded through the profile (an app-relative path — resolved
 * against the API base WITH the bearer token, like every media URL), the sign-in provider's
 * public photo URL (Google), and the silhouette disc. The uploaded photo wins because it is the
 * one the golfer chose; the silhouette — never an initial, never a broken-image glyph — is the
 * default face of an account with no photo at all (Taylor, 2026-08-24).
 */
export function Avatar({ size }: { size: number }) {
  const { avatarUrl: providerUrl } = useAuth();
  const uploadedUrl = useAvatarUrl();
  const t = useTheme();
  const styles = useStyles();
  const radius = size / 2;

  const chosen = uploadedUrl ?? providerUrl;
  const isAbsolute = chosen != null && /^https?:\/\//i.test(chosen);
  // Hook order must not depend on which source won — a null path is the hook's own "off" state.
  const authed = useAuthenticatedImage(chosen != null && !isAbsolute ? chosen : null);
  const source = isAbsolute ? { uri: chosen } : authed;

  if (chosen != null && source) {
    return (
      <Image
        source={source}
        // The view can be recycled across accounts and across photo revisions — without the key,
        // a recycled view shows its previous bitmap until the new source decodes.
        recyclingKey={chosen}
        style={{ width: size, height: size, borderRadius: radius, backgroundColor: t.surface }}
        contentFit="cover"
        cachePolicy="disk"
        accessibilityIgnoresInvertColors
      />
    );
  }

  return (
    <View style={[styles.fallback, { width: size, height: size, borderRadius: radius }]}>
      <UserSilhouette size={size} color={t.muted} />
    </View>
  );
}

// The blue-family quiet pair (Taylor, 2026-08-24: subtle, aligned with the blue theme): the
// blue-tinted surface as the bed, the blue-grey muted ink as the figure — both semantic tokens,
// so the disc keeps its place in the ramp in either theme.
const useStyles = themedStyles((t) => ({
  fallback: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    backgroundColor: t.surfaceBlue,
  },
}));
