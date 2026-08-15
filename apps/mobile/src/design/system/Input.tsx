import { useState } from "react";
import {
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from "react-native";

import { useTheme } from "../../theme";
import { FONT_BODY, FONT_DISPLAY } from "./typography";

/**
 * `.field` + `.input` (mockup §05): eyebrow-face label, 44pt input on a surface fill,
 * radius 7. The mockup's focus border+ring becomes the aqua shadow alone (borderless rule) —
 * on Android that is the elevation glow, which is the closest borderless read of "focused".
 */
export function Input({
  label,
  containerStyle,
  ...inputProps
}: TextInputProps & { label: string; containerStyle?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={containerStyle}>
      <Text
        style={{
          marginBottom: 7,
          color: t.muted,
          fontFamily: FONT_DISPLAY.black,
          fontSize: 9,
          letterSpacing: 0.9,
          textTransform: "uppercase",
        }}
      >
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={t.muted2}
        {...inputProps}
        onFocus={(e) => {
          setFocused(true);
          inputProps.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          inputProps.onBlur?.(e);
        }}
        style={[
          {
            minHeight: 44,
            paddingHorizontal: 12,
            borderRadius: 7,
            backgroundColor: focused && t.mode === "light" ? t.surface : t.surface,
            color: t.text,
            fontFamily: FONT_BODY.regular,
            fontSize: 12,
          },
          focused ? t.shadowAqua : t.shadowSm,
          inputProps.style,
        ]}
      />
    </View>
  );
}
