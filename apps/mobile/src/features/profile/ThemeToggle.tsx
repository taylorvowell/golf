import { useEffect, useRef } from "react";
import { Animated, Pressable, View } from "react-native";
import { Moon, Sun, SunMoon } from "lucide-react-native";

import { useTheme, useThemePreference, type ThemePreference } from "../../theme";

const SLOT = 38;
const PAD = 4;
const ICON = 17;

const CHOICES: Array<{ value: ThemePreference; label: string; Icon: typeof Sun }> = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "Automatic", Icon: SunMoon },
];

/**
 * The appearance switch — a three-stop pill that lived in the profile's bottom-right corner.
 *
 * **Currently unmounted.** The app is pinned to light (`ThemeProvider`), so there is no choice
 * to offer; this is kept whole, with its dark styling, as the control to re-mount if the theme
 * choice comes back.
 *
 * Icons only: sun, moon, and the sun/moon pair for "follow the phone". A cobalt thumb slides
 * under the chosen stop, so the control reads as one switch rather than three buttons — and
 * selection stays fill + colour, never an outline (borderless rule).
 */
export function ThemeToggle() {
  const t = useTheme();
  const { preference, set } = useThemePreference();
  // Until the stored value resolves, sit on Automatic — the mode the app is already rendering.
  const index = Math.max(
    0,
    CHOICES.findIndex((c) => c.value === (preference ?? "system")),
  );

  const slide = useRef(new Animated.Value(index)).current;
  // Animated in an effect, not in render: a render React discards must not leave the thumb
  // travelling to a position that was never committed.
  useEffect(() => {
    Animated.spring(slide, {
      toValue: index,
      useNativeDriver: true,
      speed: 18,
      bounciness: 4,
    }).start();
  }, [index, slide]);

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel="Appearance"
      style={{
        alignSelf: "flex-end",
        flexDirection: "row",
        padding: PAD,
        borderRadius: (SLOT + PAD * 2) / 2,
        backgroundColor: t.surface2,
      }}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: "absolute",
            top: PAD,
            left: PAD,
            width: SLOT,
            height: SLOT,
            borderRadius: SLOT / 2,
            backgroundColor: t.cobalt,
            transform: [
              {
                translateX: slide.interpolate({
                  inputRange: [0, CHOICES.length - 1],
                  outputRange: [0, SLOT * (CHOICES.length - 1)],
                }),
              },
            ],
          },
        ]}
      />
      {CHOICES.map((choice, i) => {
        const active = i === index;
        return (
          <Pressable
            key={choice.value}
            testID={`appearance-${choice.value}`}
            accessibilityRole="radio"
            accessibilityLabel={choice.label}
            accessibilityState={{ selected: active, checked: active }}
            hitSlop={8}
            onPress={() => set(choice.value)}
            style={{
              width: SLOT,
              height: SLOT,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <choice.Icon size={ICON} color={active ? t.onDark : t.muted} strokeWidth={2.2} />
          </Pressable>
        );
      })}
    </View>
  );
}
