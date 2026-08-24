import { Text, View, type StyleProp, type ViewStyle } from "react-native";

import { useTheme, type Theme } from "../../theme";
import { FONT_DISPLAY } from "./typography";

/**
 * `.tag2` (mockup §05): min-height 24, radius 4, 900/8/+9% uppercase. `compact` is the
 * swing-row metric variant (`.swing-copy .tag2`): min-height 17, font 6. The color-mix
 * fills become fixed rgba tints over the theme surface — named here, never inline.
 */
export type TagVariant = "latest" | "best" | "good" | "issue" | "neutral" | "count";

function fills(t: Theme, variant: TagVariant) {
  switch (variant) {
    case "latest": // .tag-latest — the one solid tag
      return { bg: t.cobalt, fg: t.onDark };
    case "count": // the session's swing count — solid navy, one step deeper than cobalt
      return { bg: t.heroMid, fg: t.onDark };
    case "best": // .tag-best — aqua 18%
      return { bg: "rgba(45,240,251,0.18)", fg: t.mode === "dark" ? t.aqua : "#0B5E8C" };
    case "good": // .tag-good — green 14%
      return { bg: "rgba(40,168,107,0.14)", fg: t.good };
    case "issue": // .tag-issue — red 12%
      return { bg: "rgba(229,87,100,0.12)", fg: t.bad };
    case "neutral": // .tag-neutral
      return { bg: t.surface3, fg: t.textSoft };
  }
}

export function Tag({
  label,
  variant = "neutral",
  compact,
  style,
}: {
  label: string;
  variant?: TagVariant;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const f = fills(t, variant);
  return (
    <View
      style={[
        {
          minHeight: compact ? 17 : 24,
          paddingHorizontal: compact ? 5 : 8,
          borderRadius: 4,
          alignSelf: "flex-start",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: f.bg,
        },
        style,
      ]}
    >
      <Text
        style={{
          color: f.fg,
          fontFamily: FONT_DISPLAY.black,
          fontSize: compact ? 6 : 8,
          letterSpacing: compact ? 0.48 : 0.72,
          textTransform: "uppercase",
        }}
      >
        {label}
      </Text>
    </View>
  );
}
