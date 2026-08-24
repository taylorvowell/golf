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
 * rule): secondary sits on `surface`, danger on a 9% red tint. Flat — no shadow.
 */
/**
 * `large` is the review screen's Save button expressed as a token: a 64pt full-width slab with a
 * 17pt sentence-case label. It exists so the ONE action a sheet or a screen is asking for is the
 * same object everywhere, rather than a hand-sized Pressable per surface.
 */
export type ButtonSize = "regular" | "large";

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
  size?: ButtonSize;
  onPress?: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityState?: AccessibilityState;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  /**
   * Pass `SCROLL_PRESS_DELAY_MS` when this button lives inside something that SCROLLS —
   * the house rule for every pressable in a scroller (`press.ts`): without it, a drag that
   * happens to start on the button flashes its pressed face.
   */
  pressDelayMs?: number;
}

function fills(t: Theme, variant: ButtonVariant, pressed: boolean) {
  switch (variant) {
    case "primary": // .btn-primary
      return { bg: pressed ? t.cobaltPressed : t.cobalt, fg: t.onDark };
    case "performance": // .btn-performance — aqua fill, navy text
      return { bg: t.aqua, fg: t.mode === "dark" ? "#0F2E4C" : t.text };
    case "secondary": // .btn-secondary
      return { bg: pressed ? t.surface2 : t.surface, fg: t.text };
    case "ghost": // .btn-ghost
      return { bg: pressed ? t.surface2 : "transparent", fg: t.textSoft };
    case "danger": // .btn-danger — 9% red fill, red text
      return {
        bg: pressed ? "rgba(229,87,100,0.16)" : "rgba(229,87,100,0.09)",
        fg: t.bad,
      };
    case "icon": // .btn-icon — glass square
      return { bg: pressed ? t.surface2 : t.glass, fg: t.text };
  }
}

export function Button({
  label,
  children,
  variant = "primary",
  size = "regular",
  onPress,
  disabled,
  accessibilityLabel,
  accessibilityState,
  style,
  testID,
  pressDelayMs,
}: ButtonProps) {
  const t = useTheme();
  // Finger-down visual only — latched state is the caller's business (DeckButton's lesson).
  const [pressed, setPressed] = useState(false);
  const f = fills(t, variant, pressed);
  const large = size === "large" && variant !== "icon";

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
      unstable_pressDelay={pressDelayMs}
      testID={testID}
      style={[
        {
          minHeight: large ? 64 : 42,
          borderRadius: large ? 20 : 7,
          paddingHorizontal: variant === "icon" ? 0 : 15,
          width: variant === "icon" ? 42 : undefined,
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "row",
          gap: large ? 10 : 8,
          alignSelf: large ? "stretch" : "flex-start",
          backgroundColor: f.bg,
          opacity: disabled ? 0.45 : 1,
          transform: [{ translateY: pressed ? 1 : 0 }],
        },
        style,
      ]}
    >
      {children}
      {label != null && (
        <Text
          style={
            large
              ? { color: f.fg, fontFamily: FONT_DISPLAY.black, fontSize: 17, letterSpacing: -0.2 }
              : {
                  color: f.fg,
                  fontFamily: FONT_DISPLAY.black,
                  fontSize: 10,
                  letterSpacing: 0.7,
                  textTransform: "uppercase",
                }
          }
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}
