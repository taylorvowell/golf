import { useCallback, useEffect, useRef } from "react";
import { Animated, Easing, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { AppToast } from "./toast";
import { FONT_BODY, FONT_DISPLAY } from "../../design/system/typography";
import { appStyles, useAppTheme } from "../../theme";

/**
 * The app toaster — slides down under the top inset, holds a beat, slides back out.
 *
 * Deliberately NOT the bottom sheet system (Taylor): a toast interrupts nothing and asks for
 * nothing, so it must not take the surface interactions live on. Top of the screen, full width
 * inside the app's main content gutters, self-dismissing, tappable.
 *
 * The parent keys this component by toast id, so every toast mounts fresh — all animation
 * state is per-mount and there is no cross-toast bleed to reason about.
 */

const DEFAULT_DISMISS_MS = 4200;
const LEAVE_MS = 220;
/** Far enough that the card plus its radius is fully off-screen above the inset. */
const HIDDEN_Y = -160;

export function ToastCard({ toast, onDismiss }: { toast: AppToast; onDismiss: () => void }) {
  const t = useAppTheme();
  const insets = useSafeAreaInsets();
  const styles = useStyles();

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
    const timer = setTimeout(leave, toast.durationMs ?? DEFAULT_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [leave, slide, toast.durationMs]);

  const press = useCallback(() => {
    // The deep link first, then the exit — a tap must never navigate AND leave the toast up.
    toast.onPress?.();
    leave();
  }, [leave, toast]);

  const Icon = toast.icon;

  return (
    <View
      pointerEvents="box-none"
      accessibilityLiveRegion="polite"
      style={[styles.host, { top: insets.top + 14 }]}
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
          accessibilityLabel={[toast.eyebrow, toast.title, toast.detail]
            .filter(Boolean)
            .join(". ")}
          accessibilityHint={toast.onPress ? "Opens it" : "Dismisses the notification"}
          onPress={press}
          style={({ pressed }) => [styles.card, pressed && styles.pressed]}
          testID="app-toast"
        >
          <View style={styles.iconBed}>
            <Icon size={22} color={t.onDark} strokeWidth={2.2} />
          </View>
          <View style={styles.copy}>
            {toast.eyebrow ? <Text style={styles.eyebrow}>{toast.eyebrow}</Text> : null}
            <Text style={styles.title} numberOfLines={1}>
              {toast.title}
            </Text>
            {toast.detail ? (
              <Text style={styles.detail} numberOfLines={2}>
                {toast.detail}
              </Text>
            ) : null}
          </View>
          {toast.chip ? (
            <View style={styles.chipBed}>
              <Text style={styles.chip}>{toast.chip}</Text>
            </View>
          ) : null}
        </Pressable>
      </Animated.View>
    </View>
  );
}

/**
 * Themed like any app surface (light by default, dark when the golfer runs dark). Flat rules:
 * no border, no shadow — separation from the page is the elevated fill plus the gutters.
 */
const useStyles = appStyles((t) => ({
  // No alignItems here: the default (stretch) is load-bearing. Centering made the animated
  // wrapper shrink-wrap the card, so the card's own stretch had nothing to fill.
  host: {
    position: "absolute",
    left: 0,
    right: 0,
    // The app's main content gutter (Home's cards, the log's sheet) — the toast aligns with
    // the page under it, not with its own idea of a margin.
    paddingHorizontal: 16,
    zIndex: 9000,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    // `alignSelf: stretch`, never `width: "100%"` — Yoga resolves a percentage against the
    // parent's FULL width (padding included), which spills straight through the gutters.
    alignSelf: "stretch",
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 22,
    // Opaque on purpose — a translucent ground reads as a fade over busy screens.
    backgroundColor: t.bgElevated,
  },
  // Pressed is a FILL, never opacity (mobile-client register, Taylor 2026-08-19).
  pressed: { backgroundColor: t.surface2 },
  iconBed: {
    width: 42,
    height: 42,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: t.cobalt,
  },
  copy: { flex: 1, minWidth: 0, gap: 1 },
  eyebrow: {
    color: t.cobalt,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 9,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  title: { color: t.text, fontFamily: FONT_DISPLAY.extraBold, fontSize: 14, lineHeight: 18 },
  detail: {
    color: t.textSoft,
    fontFamily: FONT_BODY.regular,
    fontSize: 11.5,
    lineHeight: 15,
  },
  chipBed: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: t.aquaSoft,
  },
  chip: { color: t.aqua, fontFamily: FONT_DISPLAY.black, fontSize: 10, letterSpacing: 0.3 },
}));
