import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Animated,
  Dimensions,
  Easing,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { DECK } from "./tokens";

/**
 * A panel that comes up from the bottom edge, over whatever is already on screen.
 *
 * This is Deck's answer to "where does secondary content live on a screen whose primary content
 * fills the viewport". The swing player is the first case and will not be the last: the picture is
 * the page, so the overlay switches, the swing's numbers and the development instruments cannot be
 * *below* anything — there is no below. They come up over it and go away again.
 *
 * ## Why a `Modal` rather than an absolutely-positioned view
 *
 * Three things come free and are each individually annoying to get right by hand:
 *
 *   * **The Android hardware back button closes it.** `onRequestClose` is the only supported hook
 *     for that, and a sheet that swallows back-to-dismiss trains a golfer to back out of the whole
 *     screen instead.
 *   * **It escapes its parent's clipping and stacking.** The player's chrome is a stack of
 *     absolutely-positioned layers with their own z-order; a sheet mounted inside it would have to
 *     win against all of them forever.
 *   * **It covers the status bar** (`statusBarTranslucent`), so a tall sheet is a page rather than
 *     a panel with a strip of video peeking over its top edge.
 *
 * ## Why it animates itself
 *
 * `animationType="slide"` exists and is not used: it cannot be interrupted, and it gives no way to
 * couple the backdrop to the panel. Here the backdrop's opacity is *derived from the panel's
 * position*, so dragging the sheet halfway down fades the picture back in by half — the gesture
 * shows you what letting go will do, which is the entire difference between a sheet that feels
 * physical and one that feels like a screen transition.
 *
 * Drag-to-dismiss is `PanResponder`, from React Native itself. `react-native-gesture-handler` is
 * deliberately excluded from autolinking (D47), and the gesture here is one axis with one decision
 * at the end of it.
 */

export interface DeckSheetProps {
  visible: boolean;
  /** Called for every dismissal — backdrop, drag, hardware back, or the close cap. */
  onClose: () => void;
  title?: string;
  /** A short line under the title. For saying what this panel is *for*, not for instructions. */
  subtitle?: string;
  children: ReactNode;
  /**
   * How much of the screen the panel may take before its content starts scrolling.
   *
   * Under 1 on purpose: a sheet that reaches the top edge has become a screen, and the strip of
   * picture left showing above it is what tells a golfer they are still inside the swing.
   */
  maxHeightFraction?: number;
  testID?: string;
}

/** How far down you must drag before letting go dismisses instead of springing back. */
const DISMISS_DISTANCE = 88;
/** …or how fast you must flick, regardless of distance. A flick is an intention. */
const DISMISS_VELOCITY = 0.6;

export function DeckSheet({
  visible,
  onClose,
  title,
  subtitle,
  children,
  maxHeightFraction = 0.74,
  testID,
}: DeckSheetProps) {
  const insets = useSafeAreaInsets();
  /**
   * Mounted outlives `visible` — the panel has to still exist while it slides away.
   *
   * A sheet that unmounted on `visible: false` would vanish rather than leave, and the caller
   * would have to own the exit timing to avoid it. Owning it here is what lets a caller treat
   * `visible` as plain boolean state.
   */
  const [mounted, setMounted] = useState(visible);
  const [height, setHeight] = useState(0);

  const screenHeight = Dimensions.get("window").height;
  const translate = useRef(new Animated.Value(screenHeight)).current;
  /** The panel has finished coming up at least once, so layout must not re-trigger the entrance. */
  const opened = useRef(false);

  const settle = useCallback(
    (to: number, duration: number, easing: (v: number) => number, then?: () => void) => {
      Animated.timing(translate, { toValue: to, duration, easing, useNativeDriver: true }).start(
        ({ finished }) => {
          if (finished) then?.();
        },
      );
    },
    [translate],
  );

  const slideAway = useCallback(() => {
    settle(height || screenHeight, 200, Easing.in(Easing.cubic), () => setMounted(false));
  }, [height, screenHeight, settle]);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      return;
    }
    if (mounted) slideAway();
    // `mounted` is read, not depended on: adding it would re-run the exit every time the exit's own
    // completion flipped it, which lands the panel back on screen for a frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const onPanelLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const h = e.nativeEvent.layout.height;
      if (h <= 0) return;
      setHeight(h);
      if (opened.current) return;
      opened.current = true;
      // Parked at its own height first, so the entrance travels exactly the panel's height however
      // tall it turned out to be. Starting from the screen's height makes a short sheet arrive
      // late and fast.
      translate.setValue(h);
      settle(0, 260, Easing.out(Easing.cubic));
    },
    [settle, translate],
  );

  useEffect(() => {
    if (!visible) opened.current = false;
  }, [visible]);

  /**
   * The backdrop reads the panel's position rather than being animated alongside it.
   *
   * That coupling is what makes the drag legible: half a drag is half a backdrop, and letting go
   * from there springs both back together. Two independent timings could not stay in step under a
   * gesture that can be reversed mid-flight.
   */
  const backdrop = useMemo(
    () =>
      translate.interpolate({
        inputRange: [0, Math.max(1, height || screenHeight)],
        outputRange: [1, 0],
        extrapolate: "clamp",
      }),
    [height, screenHeight, translate],
  );

  const closing = useRef(false);
  closing.current = !visible;

  const pan = useMemo(
    () =>
      PanResponder.create({
        // Only after the finger has committed to a downward move — otherwise the responder steals
        // the first touch from the controls sitting inside the sheet's header.
        onMoveShouldSetPanResponder: (_e, g) => g.dy > 4 && g.dy > Math.abs(g.dx),
        onPanResponderMove: (_e, g) => {
          // Downward only. Dragging a bottom sheet UP past its own top edge is a gesture with
          // nothing behind it, and allowing it exposes the gap under the panel.
          translate.setValue(Math.max(0, g.dy));
        },
        onPanResponderRelease: (_e, g) => {
          if (g.dy > DISMISS_DISTANCE || g.vy > DISMISS_VELOCITY) onClose();
          else settle(0, 180, Easing.out(Easing.cubic));
        },
        onPanResponderTerminate: () => settle(0, 180, Easing.out(Easing.cubic)),
      }),
    [onClose, settle, translate],
  );

  if (!mounted) return null;

  return (
    <Modal
      testID={testID}
      visible
      transparent
      // We own the motion — see the header comment. `slide` cannot be interrupted or coupled.
      animationType="none"
      statusBarTranslucent
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
              maxHeight: screenHeight * maxHeightFraction,
              paddingBottom: 16 + insets.bottom,
              transform: [{ translateY: translate }],
            },
          ]}
        >
          <View {...pan.panHandlers}>
            <View style={styles.grip} />
            {title ? (
              <View style={styles.titleRow}>
                <View style={styles.titleText}>
                  <Text style={styles.title}>{title}</Text>
                  {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
                </View>
                {/* Dragging is not available to a screen reader, and neither is tapping a
                    backdrop it does not describe. This is the accessible way out. */}
                <Pressable
                  testID={testID ? `${testID}-close` : undefined}
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                  hitSlop={12}
                  onPress={onClose}
                  style={({ pressed }) => [styles.closeCap, pressed && styles.closeCapPressed]}
                >
                  <View style={styles.closeBarA} />
                  <View style={styles.closeBarB} />
                </Pressable>
              </View>
            ) : null}
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  backdropFill: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.55)" },
  panel: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: DECK.glass.sheet,
    borderTopLeftRadius: DECK.radius.slab,
    borderTopRightRadius: DECK.radius.slab,
    borderTopWidth: 1,
    borderColor: DECK.glass.hairline,
    paddingHorizontal: 18,
    paddingTop: 10,
    boxShadow: DECK.shadow.slab,
  },
  grip: {
    alignSelf: "center",
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.22)",
  },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingTop: 14 },
  titleText: { flex: 1, gap: 2 },
  title: { color: DECK.label.onFace, fontSize: 17, fontWeight: "700", letterSpacing: -0.3 },
  subtitle: { color: DECK.label.caption, fontSize: 12, lineHeight: 16 },
  closeCap: {
    width: 32,
    height: 32,
    borderRadius: DECK.radius.cap,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: DECK.glass.key,
    borderWidth: 1,
    borderColor: DECK.glass.keyEdge,
  },
  closeCapPressed: { opacity: 0.6 },
  // An ✕ as two crossed bars — the same "no icon font, no SVG" rule the transport glyphs follow.
  closeBarA: {
    position: "absolute",
    width: 13,
    height: 1.6,
    borderRadius: 1,
    backgroundColor: DECK.label.caption,
    transform: [{ rotate: "45deg" }],
  },
  closeBarB: {
    position: "absolute",
    width: 13,
    height: 1.6,
    borderRadius: 1,
    backgroundColor: DECK.label.caption,
    transform: [{ rotate: "-45deg" }],
  },
  // `flexGrow: 0` so a short sheet hugs its content: without it the ScrollView claims the whole
  // `maxHeight` and every panel is the same tall box regardless of what is in it.
  scroll: { flexGrow: 0 },
  scrollContent: { paddingTop: 16, gap: 14 },
});
