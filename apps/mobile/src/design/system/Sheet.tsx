import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Animated,
  Easing,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from "react-native";
import { ChevronDown, X } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppTheme, useAppTheme, type Theme } from "../../theme";
import { FONT_BODY, FONT_DISPLAY } from "./typography";

/**
 * The system bottom sheet: a panel that comes up from the bottom edge, over whatever is
 * already on screen.
 *
 * This is `DeckSheet`'s mechanics re-expressed on the design system's tokens — the D61 Deck
 * absorption. The behaviours that took three designs to get right survive unchanged, because
 * each one guards a failure:
 *
 *   - **`Modal`, not an absolutely-positioned view** — the Android hardware back button
 *     (`onRequestClose` is its only supported hook), escaping the host screen's stacking
 *     order, and covering the status bar all come free.
 *   - **It animates itself** (`animationType="none"`): `slide` cannot be interrupted, and the
 *     backdrop's opacity is derived from the panel's position so half a drag is half a
 *     backdrop — the gesture shows what letting go will do.
 *   - **Two detents, computed from the content**: opens half-height when the content is tall
 *     enough to have two heights, else one height that closes on a downward drag — an
 *     "expand" that reveals 20 more points is a gesture that appears broken.
 *   - **Release snaps to the detent the throw was aimed at** — position projected forward by
 *     fling velocity; without it a fast flick that travelled 20pt springs back and feels stuck.
 *   - **Closed means unmounted** — a hidden sheet must not keep its controls in the
 *     accessibility tree; `mounted` outlives `visible` only long enough to slide away.
 *
 * Flat rule: the panel separates from the scene by fill + the dimmed backdrop, never a cast
 * shadow (the one deliberate divergence from `DeckSheet`, whose slab shadow predates the rule).
 * Drag is `PanResponder` — gesture-handler is excluded from autolinking (D47).
 */

export interface SheetProps {
  visible: boolean;
  /** Called for every dismissal — backdrop, drag, hardware back, or the close cap. */
  onClose: () => void;
  title?: string;
  /** Sits immediately before the title — a mark that names the panel faster than the word does. */
  titleIcon?: ReactNode;
  /** A short line under the title — what this panel is for, not instructions. */
  subtitle?: string;
  /** Sits opposite the title in the drag header — a segmented control, a count, a reset. */
  accessory?: ReactNode;
  children: ReactNode;
  /** How much of the screen the panel may take at full height (a sheet that reaches the top
   * edge has become a screen). */
  maxHeightFraction?: number;
  /** The height it opens at, when its content is tall enough to have two. */
  restHeightFraction?: number;
  /** The content scrolls itself — the sheet must not wrap it in a second ScrollView. */
  scrolls?: boolean;
  testID?: string;
}

/** How far past the lowest detent a throw must be aimed before it dismisses instead of snapping. */
const DISMISS_OVERSHOOT = 70;
/** How far a fling is projected past where the finger let go. */
const FLING_PROJECTION_MS = 140;

export function Sheet({
  visible,
  onClose,
  title,
  titleIcon,
  subtitle,
  accessory,
  children,
  maxHeightFraction = 0.88,
  restHeightFraction,
  scrolls = true,
  testID,
}: SheetProps) {
  const t = useAppTheme();
  const styles = stylesFor(t);
  const insets = useSafeAreaInsets();

  // Mounted outlives `visible` — the panel has to still exist while it slides away, so the
  // caller can treat `visible` as plain boolean state.
  const [mounted, setMounted] = useState(visible);
  const [height, setHeight] = useState(0);

  const { height: screenHeight } = useWindowDimensions();
  const translate = useRef(new Animated.Value(screenHeight)).current;
  /** The panel has finished coming up at least once — layout must not re-trigger the entrance. */
  const opened = useRef(false);

  /**
   * Rest offsets for `translateY`: `0` is full height; the last entry is where it opens.
   *
   * **Sheets open FULLY unless a caller asks for a lower rest** (Taylor, 2026-08-18). A second
   * detent parks the panel translated DOWN by `height - rest`, which puts its bottom padding —
   * and its last control — off the bottom of the screen. That is why "add padding at the bottom"
   * kept appearing to do nothing: the padding was there, below the screen edge. The panel is
   * already capped at `maxHeightFraction` and scrolls inside, so opening at its natural height
   * is the honest default; `restHeightFraction` is now opt-in for a genuinely long list.
   */
  const detents = useMemo(() => {
    if (restHeightFraction === undefined) return [0];
    const rest = screenHeight * restHeightFraction;
    // The 32pt margin is what stops a "drag up to reveal 20 more points" detent existing.
    return height > rest + 32 ? [0, height - rest] : [0];
  }, [height, restHeightFraction, screenHeight]);

  const detentsRef = useRef(detents);
  detentsRef.current = detents;
  /** The detent the panel currently rests at — a drag is measured from here, not from zero. */
  const resting = useRef(0);

  const settle = useCallback(
    (to: number, velocity = 0) => {
      resting.current = to;
      Animated.spring(translate, {
        toValue: to,
        velocity,
        damping: 26,
        stiffness: 260,
        mass: 0.9,
        useNativeDriver: true,
      }).start();
    },
    [translate],
  );

  const slideAway = useCallback(() => {
    Animated.timing(translate, {
      toValue: height || screenHeight,
      duration: 200,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setMounted(false);
    });
  }, [height, screenHeight, translate]);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      return;
    }
    if (mounted) slideAway();
    // `mounted` is read, not depended on: adding it would re-run the exit every time the
    // exit's own completion flipped it, landing the panel back on screen for a frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    if (!visible) opened.current = false;
  }, [visible]);

  const onPanelLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const h = e.nativeEvent.layout.height;
      if (h <= 0) return;
      setHeight(h);
      if (opened.current) return;
      opened.current = true;
      // Parked at its own height first, so the entrance travels exactly the panel's height —
      // starting from the screen's height makes a short sheet arrive late and fast.
      translate.setValue(h);
      if (restHeightFraction === undefined) {
        settle(0);
        return;
      }
      const rest = screenHeight * restHeightFraction;
      settle(h > rest + 32 ? h - rest : 0);
    },
    [restHeightFraction, screenHeight, settle, translate],
  );

  // The backdrop reads the panel's position rather than being animated alongside it — two
  // independent timings cannot stay in step under a gesture that can reverse mid-flight.
  // Capped below full so the scene behind is never wholly hidden.
  const backdrop = useMemo(
    () =>
      translate.interpolate({
        inputRange: [0, Math.max(1, height || screenHeight)],
        outputRange: [0.72, 0],
        extrapolate: "clamp",
      }),
    [height, screenHeight, translate],
  );

  const pan = useMemo(
    () =>
      PanResponder.create({
        // Only after the finger commits to a vertical move — otherwise the responder steals
        // the first touch from controls inside the sheet's header.
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 4 && Math.abs(g.dy) > Math.abs(g.dx),
        onPanResponderMove: (_e, g) => {
          // Never above the top detent — dragging past full height exposes the gap under the panel.
          translate.setValue(Math.max(0, resting.current + g.dy));
        },
        onPanResponderRelease: (_e, g) => {
          const stops = detentsRef.current;
          const lowest = stops[stops.length - 1];
          const projected = resting.current + g.dy + g.vy * FLING_PROJECTION_MS;
          if (projected > lowest + DISMISS_OVERSHOOT) {
            onClose();
            return;
          }
          const nearest = stops.reduce((a, b) =>
            Math.abs(b - projected) < Math.abs(a - projected) ? b : a,
          );
          settle(nearest, g.vy);
        },
        onPanResponderTerminate: () => settle(resting.current),
      }),
    [onClose, settle, translate],
  );

  if (!mounted) return null;

  const expandable = detents.length > 1;

  return (
    <Modal
      testID={testID}
      visible
      transparent
      // We own the motion — `slide` cannot be interrupted or coupled to the backdrop.
      animationType="none"
      statusBarTranslucent
      // Both, or neither works: a Modal opens its OWN window, and without these it is laid out
      // inside the system bars rather than edge to edge — so the navigation-bar strip under the
      // panel paints the platform default (white) instead of the sheet, and the app looks like
      // it stops short of the bottom of the screen. `navigationBarTranslucent` is ignored unless
      // `statusBarTranslucent` is also set (RN).
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.fill}>
        <Animated.View style={[styles.backdropFill, { opacity: backdrop }]}>
          <Pressable
            testID={testID ? `${testID}-backdrop` : undefined}
            accessibilityRole="button"
            accessibilityLabel="Close"
            style={styles.fill}
            onPress={onClose}
          />
        </Animated.View>

        <Animated.View
          onLayout={onPanelLayout}
          style={[
            styles.panel,
            {
              // Padded for the detent, not the visible height: resting low, the bottom edge is
              // off screen and dragged-up content must still clear the gesture bar.
              maxHeight: screenHeight * maxHeightFraction,
              paddingBottom: 16 + insets.bottom,
              transform: [{ translateY: translate }],
            },
          ]}
        >
          {/* The whole header is the grab area, deliberately tall — a thin grip line would
              make the gesture a matter of aim. */}
          <View {...pan.panHandlers} style={styles.header}>
            <View style={styles.grip} />
            {title ? (
              <View style={styles.titleRow}>
                {titleIcon}
                <View style={styles.titleText}>
                  <Text style={styles.title}>{title}</Text>
                  {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
                </View>
                {accessory}
                {/* Dragging is not available to a screen reader — this is the accessible way
                    between the two heights, and the cap below the accessible way out. */}
                {expandable ? (
                  <Pressable
                    testID={testID ? `${testID}-expand` : undefined}
                    accessibilityRole="button"
                    accessibilityLabel={resting.current === 0 ? "Collapse" : "Expand"}
                    hitSlop={12}
                    onPress={() => settle(resting.current === 0 ? detents[1] : 0)}
                    style={({ pressed }) => [styles.headerCap, pressed && styles.pressed]}
                  >
                    <ChevronDown
                      size={15}
                      color={t.muted}
                      strokeWidth={2.5}
                      style={{ transform: [{ rotate: resting.current === 0 ? "0deg" : "180deg" }] }}
                    />
                  </Pressable>
                ) : null}
                <Pressable
                  testID={testID ? `${testID}-close` : undefined}
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                  hitSlop={12}
                  onPress={onClose}
                  style={({ pressed }) => [styles.headerCap, pressed && styles.pressed]}
                >
                  <X size={15} color={t.muted} strokeWidth={2.5} />
                </Pressable>
              </View>
            ) : null}
          </View>

          {/* The content reads the APP's theme even when the host screen is pinned dark — a
              slide-in is an app surface, not a control over footage (Taylor, 2026-08-18). */}
          <AppTheme>
            {scrolls ? (
              <ScrollView
                style={styles.scroll}
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
              >
                {children}
              </ScrollView>
            ) : (
              <View style={[styles.scroll, styles.scrollContent]}>{children}</View>
            )}
          </AppTheme>
        </Animated.View>
      </View>
    </Modal>
  );
}

/**
 * Built from the APP theme, not the ambient one — `themedStyles` reads context, so inside a
 * `FixedDarkTheme` pin it would paint the panel dark. Cached on theme identity for the same
 * reason `themedStyles` is: there are only ever two `Theme` objects.
 */
const STYLE_CACHE = new Map<Theme, ReturnType<typeof makeStyles>>();

function stylesFor(t: Theme) {
  let sheet = STYLE_CACHE.get(t);
  if (!sheet) {
    sheet = makeStyles(t);
    STYLE_CACHE.set(t, sheet);
  }
  return sheet;
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    fill: { flex: 1 },
    backdropFill: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: "#000000",
    },
    panel: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: t.bgElevated,
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      paddingHorizontal: 18,
      paddingTop: 10,
    },
    header: { paddingBottom: 4 },
    grip: {
      alignSelf: "center",
      width: 38,
      height: 4,
      borderRadius: 2,
      backgroundColor: t.surface3,
    },
    titleRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 14 },
    titleText: { flex: 1, gap: 2 },
    title: {
      color: t.text,
      fontFamily: FONT_DISPLAY.extraBold,
      fontSize: 17,
      letterSpacing: -0.3,
    },
    subtitle: { color: t.muted, fontFamily: FONT_BODY.regular, fontSize: 12, lineHeight: 16 },
    headerCap: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: t.surface2,
    },
    pressed: { opacity: 0.6 },
    // `flexShrink` so the content gives way to `maxHeight` rather than pushing the panel past it.
    scroll: { flexShrink: 1 },
    // Room under the last row (Taylor, 2026-08-18). Modest on purpose: the panel's own
    // `16 + insets.bottom` does the real work of clearing the gesture bar, and that only
    // started reporting a true inset once the Modal was made edge-to-edge above — before
    // that `insets.bottom` was 0 inside the sheet's window, which is what put the last
    // control on the gesture bar in the first place.
    scrollContent: { paddingTop: 14, paddingBottom: 24, gap: 14 },
  });
