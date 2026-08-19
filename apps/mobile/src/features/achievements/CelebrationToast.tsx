import { useCallback, useEffect, useRef } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { KIND_EYEBROW, type Celebration } from "./celebration";
import { FONT_BODY, FONT_DISPLAY } from "../../design/system/typography";
import { DARK } from "../../theme";

/**
 * The celebration toaster — slides down under the top inset, holds a beat, slides back out.
 *
 * Deliberately NOT the bottom sheet system (Taylor): a celebration interrupts nothing and asks
 * for nothing, so it must not take the surface interactions live on. Top of the screen, small,
 * self-dismissing, tappable to dismiss early.
 *
 * The parent keys this component by celebration id, so every celebration mounts fresh — all
 * animation state is per-mount and there is no cross-toast bleed to reason about.
 */

const AUTO_DISMISS_MS = 4200;
const LEAVE_MS = 220;
/** Far enough that the card plus its radius is fully off-screen above the inset. */
const HIDDEN_Y = -160;

export function CelebrationToast({
  celebration,
  onDismiss,
}: {
  celebration: Celebration;
  onDismiss: () => void;
}) {
  const insets = useSafeAreaInsets();

  const slide = useRef(new Animated.Value(0)).current;
  /** The leave animation can race the auto-dismiss timer; whoever fires second must not re-run. */
  const leaving = useRef(false);

  const leave = useCallback(() => {
    if (leaving.current) return;
    leaving.current = true;
    Animated.timing(slide, {
      toValue: 0,
      duration: LEAVE_MS,
      easing: Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) onDismiss();
    });
  }, [onDismiss, slide]);

  useEffect(() => {
    Animated.spring(slide, {
      toValue: 1,
      useNativeDriver: true,
      friction: 8,
      tension: 60,
    }).start();
    const timer = setTimeout(leave, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [leave, slide]);

  const Icon = celebration.icon;
  const eyebrow = KIND_EYEBROW[celebration.kind];

  return (
    <View
      pointerEvents="box-none"
      accessibilityLiveRegion="polite"
      style={[styles.host, { top: insets.top + 6 }]}
    >
      {/* Slide only — no fade (Taylor): the card arrives and leaves at full strength. */}
      <Animated.View
        style={{
          transform: [
            { translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [HIDDEN_Y, 0] }) },
          ],
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${eyebrow}: ${celebration.title}. ${celebration.detail ?? ""}`}
          accessibilityHint="Dismisses the notification"
          onPress={leave}
          style={({ pressed }) => [styles.card, pressed && styles.pressed]}
          testID="celebration-toast"
        >
          <View style={styles.iconBed}>
            <Icon size={22} color={DARK.onDark} strokeWidth={2.2} />
          </View>
          <View style={styles.copy}>
            <Text style={styles.eyebrow}>{eyebrow}</Text>
            <Text style={styles.title} numberOfLines={1}>
              {celebration.title}
            </Text>
            {celebration.detail ? (
              <Text style={styles.detail} numberOfLines={2}>
                {celebration.detail}
              </Text>
            ) : null}
          </View>
          {celebration.points != null ? (
            <View style={styles.pointsChip}>
              <Text style={styles.points}>{`+${celebration.points} XP`}</Text>
            </View>
          ) : null}
        </Pressable>
      </Animated.View>
    </View>
  );
}

/**
 * Pinned dark in BOTH themes (Taylor, 2026-08-19) — the toast floats over arbitrary content,
 * so like chrome over footage it keeps its own light: a static sheet built from the DARK
 * theme's tokens rather than the ambient one. Flat rules: no border, no shadow.
 */
const styles = StyleSheet.create({
  host: {
    position: "absolute",
    left: 0,
    right: 0,
    paddingHorizontal: 24,
    alignItems: "center",
    zIndex: 9000,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    width: "100%",
    maxWidth: 420,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 22,
    // Opaque on purpose — a translucent ground reads as a fade over bright screens.
    backgroundColor: DARK.surface,
  },
  pressed: { opacity: 0.85 },
  iconBed: {
    width: 42,
    height: 42,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: DARK.cobalt,
  },
  copy: { flex: 1, minWidth: 0, gap: 1 },
  eyebrow: {
    color: DARK.cobalt,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 9,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  title: { color: DARK.text, fontFamily: FONT_DISPLAY.extraBold, fontSize: 14, lineHeight: 18 },
  detail: {
    color: DARK.textSoft,
    fontFamily: FONT_BODY.regular,
    fontSize: 11.5,
    lineHeight: 15,
  },
  pointsChip: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: DARK.aquaSoft,
  },
  points: { color: DARK.aqua, fontFamily: FONT_DISPLAY.black, fontSize: 10, letterSpacing: 0.3 },
});
