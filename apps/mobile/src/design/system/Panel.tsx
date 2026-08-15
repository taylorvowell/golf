import { Text, View, type StyleProp, type ViewProps, type ViewStyle } from "react-native";

import { useTheme } from "../../theme";
import { FONT_BODY, FONT_DISPLAY } from "./typography";

/**
 * `.panel` / `.progress-block` (mockup §07): the standard information surface — surface
 * fill, radius 11 (`card`) or 14 (`feature`, the mockup's hero radius), shadowSm by default.
 * `PanelHead` is `.panel-head`'s label + muted meta row without the hairline (borderless).
 */
export function Panel({
  radius = "card",
  elevated,
  style,
  ...rest
}: ViewProps & { radius?: "card" | "feature"; elevated?: boolean }) {
  const t = useTheme();
  return (
    <View
      {...rest}
      style={[
        {
          borderRadius: radius === "feature" ? 14 : 11,
          padding: 14,
          backgroundColor: t.surface,
        },
        elevated ? t.shadowMd : t.shadowSm,
        style,
      ]}
    />
  );
}

/** `.panel-head` — 900/10..11 uppercase label left, muted meta right. */
export function PanelHead({
  label,
  meta,
  style,
}: {
  label: string;
  meta?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  return (
    <View
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          marginBottom: 12,
        },
        style,
      ]}
    >
      <Text
        style={{
          color: t.text,
          fontFamily: FONT_DISPLAY.black,
          fontSize: 10,
          letterSpacing: 1,
          textTransform: "uppercase",
        }}
      >
        {label}
      </Text>
      {meta != null && (
        <Text style={{ color: t.textSoft, fontFamily: FONT_BODY.regular, fontSize: 11 }}>
          {meta}
        </Text>
      )}
    </View>
  );
}
