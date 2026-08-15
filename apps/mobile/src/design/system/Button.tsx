import { useState, type ReactNode } from "react";
import {
  Pressable,
  Text,
  type AccessibilityState,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { useTheme, type Theme } from "../../theme";
import { FONT_DISPLAY } from "./typography";

/**
 * `.btn` (mockup §05): min-height 42, radius 7, 900/10/+7% uppercase display face.
 * Variants are the mockup's five plus `icon` (42×42). Pressed = translateY(1) + the pressed
 * fill — the mockup's `:active`, which reads as the button being pushed in.
 *
 * The mockup's `.btn-secondary`/`.btn-danger` hairline borders become fills (the borderless
 * rule): secondary sits on `surface` with its shadow, danger on a 9% red tint.
 */
export type ButtonVariant =
  | "primary"
  | "performance"
  | "secondary"
  | "ghost"
  | "danger"
  | "icon";

export interface ButtonProps {
  label?: string;
  /** Icon-only buttons pass children (a lucide glyph) and MUST set accessibilityLabel. */
  children?: ReactNode;
  variant?: ButtonVariant;
  onPress?: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityState?: AccessibilityState;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

function fills(t: Theme, variant: ButtonVariant, pressed: boolean) {
  switch (variant) {
    case "primary": // .btn-primary
      return {
        bg: pressed ? t.cobaltPressed : t.cobalt,
        fg: t.onDark,
        shadow: t.shadowCobalt,
      };
    case "performance": // .btn-performance — aqua fill, navy text
      return {
        bg: t.aqua,
        fg: t.mode === "dark" ? "#10204A" : t.text,
        shadow: t.shadowAqua,
      };
    case "secondary": // .btn-secondary
      return { bg: pressed ? t.surface2 : t.surface, fg: t.text, shadow: t.shadowSm };
    case "ghost": // .btn-ghost
      return { bg: pressed ? t.surface2 : "transparent", fg: t.textSoft, shadow: null };
    case "danger": // .btn-danger — 9% red fill, red text
      return {
        bg: pressed ? "rgba(229,87,100,0.16)" : "rgba(229,87,100,0.09)",
        fg: t.bad,
        shadow: null,
      };
    case "icon": // .btn-icon — glass square
      return { bg: pressed ? t.surface2 : t.glass, fg: t.text, shadow: t.shadowSm };
  }
}

export function Button({
  label,
  children,
  variant = "primary",
  onPress,
  disabled,
  accessibilityLabel,
  accessibilityState,
  style,
  testID,
}: ButtonProps) {
  const t = useTheme();
  // Finger-down visual only — latched state is the caller's business (DeckButton's lesson).
  const [pressed, setPressed] = useState(false);
  const f = fills(t, variant, pressed);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!disabled, ...accessibilityState }}
      disabled={disabled}
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      hitSlop={variant === "icon" ? 6 : undefined}
      testID={testID}
      style={[
        {
          minHeight: 42,
          borderRadius: 7,
          paddingHorizontal: variant === "icon" ? 0 : 15,
          width: variant === "icon" ? 42 : undefined,
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "row",
          gap: 8,
          alignSelf: "flex-start",
          backgroundColor: f.bg,
          opacity: disabled ? 0.45 : 1,
          transform: [{ translateY: pressed ? 1 : 0 }],
        },
        f.shadow,
        style,
      ]}
    >
      {children}
      {label != null && (
        <Text
          style={{
            color: f.fg,
            fontFamily: FONT_DISPLAY.black,
            fontSize: 10,
            letterSpacing: 0.7,
            textTransform: "uppercase",
          }}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}
