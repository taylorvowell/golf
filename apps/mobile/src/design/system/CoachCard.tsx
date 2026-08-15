import { Text, View, type StyleProp, type ViewStyle } from "react-native";
import type { ReactNode } from "react";

import { useTheme } from "../../theme";
import { FONT_BODY, FONT_DISPLAY } from "./typography";

/**
 * `.coach-card` (mockup §08): aqua icon tile (52px, radius 8, navy glyph), aqua eyebrow,
 * strong title, soft body, and the priority tag on the right. The mockup's aqua-tinted
 * hairline+gradient becomes a 9% aqua tint fill (borderless rule).
 */
export function CoachCard({
  icon,
  eyebrow,
  title,
  body,
  right,
  style,
}: {
  /** A lucide glyph, sized ~24 by the caller. */
  icon?: ReactNode;
  eyebrow: string;
  title: string;
  body?: string;
  /** Usually a priority `Tag`. */
  right?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  return (
    <View
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          padding: 15,
          borderRadius: 10,
          backgroundColor:
            t.mode === "dark" ? "rgba(67,205,208,0.10)" : "rgba(67,205,208,0.09)",
        },
        style,
      ]}
    >
      {icon != null && (
        <View
          style={{
            width: 52,
            height: 52,
            borderRadius: 8,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: t.aqua,
          }}
        >
          {icon}
        </View>
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          style={{
            color: t.mode === "dark" ? t.aqua : "#1D7E86",
            fontFamily: FONT_DISPLAY.black,
            fontSize: 8,
            letterSpacing: 1.12,
            textTransform: "uppercase",
          }}
        >
          {eyebrow}
        </Text>
        <Text
          style={{
            marginTop: 5,
            color: t.text,
            fontFamily: FONT_DISPLAY.extraBold,
            fontSize: 15,
            lineHeight: 17,
          }}
        >
          {title}
        </Text>
        {body != null && (
          <Text
            style={{
              marginTop: 5,
              color: t.textSoft,
              fontFamily: FONT_BODY.regular,
              fontSize: 10,
              lineHeight: 15,
            }}
          >
            {body}
          </Text>
        )}
      </View>
      {right}
    </View>
  );
}
