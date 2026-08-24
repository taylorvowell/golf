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
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BLACK } from "../../theme/palette";
import { DECK } from "./tokens";

/**
 * A panel that comes up from the bottom edge, over whatever is already on screen.
 *
 * This is Deck's answer to "where does secondary content live on a screen whose primary content
 * fills the viewport". The swing player is the first case and will not be the last: the picture is
 * the page, so the overlay switches, the swing's numbers and the comparison picker cannot be
 * *below* anything — there is no below. They come up over it and go away again.
 *
 * ## It has two heights, and your thumb chooses
 *
 * A sheet tall enough to hold a scrollable list covers the swing; a sheet short enough to leave the
 * swing visible cannot hold one. So it has both: it opens **half-height**, drags up to full, drags
 * back down to half, and drags down again to close. The detents are computed from the content —
 * a panel with little in it has only one height and simply closes on a downward drag, because
 * offering an "expand" that reveals nothing is a gesture that appears broken.
 *
 * Releasing snaps to whichever detent the throw was *aimed* at, not the one it happened to stop
 * nearest: the release position is projected forward by the fling velocity first. Without that, a
 * fast flick that has only travelled 20pt snaps back where it came from and the sheet feels stuck.
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
 * Drag is `PanResponder`, from React Native itself. `react-native-gesture-handler` is deliberately
 * excluded from autolinking (D47), and the gesture here is one axis with one decision at the end.
 */

export interface DeckSheetProps {
  visible: boolean;
  /** Called for every dismissal — backdrop, drag, hardware back, or the close cap. */
  onClose: () => void;
  title?: string;
  /** A short line under the title. For saying what this panel is *for*, not for instructions. */
  subtitle?: string;
  /** Sits opposite the title, in the drag header. A segmented control, a count, a reset. */
  accessory?: ReactNode;
  children: ReactNode;
  /**
   * How much of the screen the panel may take at full height.
   *
   * Under 1 on purpose: a sheet that reaches the top edge has become a screen, and the strip of
   * picture left showing above it is what tells a golfer they are still inside the swing.
   */
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

export function DeckSheet({
  visible,
  onClose,
  title,
  subtitle,
  accessory,
  children,
  maxHeightFraction = 0.88,
  restHeightFraction = 0.52,
  scrolls = true,
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


  /** Frozen for the slide-out: a caller's state has usually moved on by the time the panel
   *  leaves, and reading live props through the exit rewrites the panel as it dismisses. */
  const latched = useRef({ title, subtitle, accessory, children });
  if (visible) latched.current = { title, subtitle, accessory, children };
  const shown = visible ? { title, subtitle, accessory, children } : latched.current;

  // `useWindowDimensions`, never a render-time `Dimensions.get`: this app is edge-to-edge, and a
  // measurement taken once at module scope survives neither a rotation nor a fold.
  const { height: screenHeight } = useWindowDimensions();

  /** A panel that fits carries NO `ScrollView` — an Android ScrollView takes taps away from the
   *  controls inside it by two routes, and only one of them can be switched off. Read off the
   *  PANEL: capped at `maxHeightFraction`, so measuring at the cap means the content did not fit.
   *  See `design/system/Sheet.tsx` for the full account. */
  const heightCap = screenHeight * maxHeightFraction;
  const overflows = height <= 0 || height >= heightCap - 1;
  const translate = useRef(new Animated.Value(screenHeight)).current;
  /** The panel has finished coming up at least once, so layout must not re-trigger the entrance. */
  const opened = useRef(false);

  /**
   * Where the panel can rest, as `translateY` offsets. `0` is full height, and the last entry is
   * where it opens. One entry means the content is short enough that there is nothing to expand to.
   */
  const detents = useMemo(() => {
    const rest = screenHeight * restHeightFraction;
    // The 32pt margin is what stops a "drag up to reveal 20 more points" detent existing at all.
    return height > rest + 32 ? [0, height - rest] : [0];
  }, [height, restHeightFraction, screenHeight]);

  const detentsRef = useRef(detents);
  detentsRef.current = detents;
  /** The detent the panel is currently sitting at — a drag is measured from here, not from zero. */
  const resting = useRef(0);

  /** The panel absorbs its own touches while a settle animation runs — a press granted against a
   *  moving panel measures its press rect where the row is GOING, and dies as LEAVE_PRESS_RECT.
   *  Caught in a signal trace 2026-08-22; full account in `design/system/Sheet.tsx`. */
  const [inMotion, setInMotion] = useState(false);
  const motionCount = useRef(0);
  const beginMotion = useCallback(() => {
    motionCount.current += 1;
    setInMotion(true);
  }, []);
  const endMotion = useCallback(() => {
    motionCount.current = Math.max(0, motionCount.current - 1);
    if (motionCount.current === 0) setInMotion(false);
  }, []);

  const settle = useCallback(
    (to: number, velocity = 0) => {
      resting.current = to;
      beginMotion();
      Animated.spring(translate, {
        toValue: to,
        velocity,
        damping: 26,
        stiffness: 260,
        mass: 0.9,
        // Rest when motion stops being visible — the 0.001px defaults keep the guard up for
        // most of a second after the eye says the panel has stopped.
        restDisplacementThreshold: 0.4,
        restSpeedThreshold: 4,
        useNativeDriver: true,
      }).start(endMotion);
    },
    [beginMotion, endMotion, translate],
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
    // `mounted` is read, not depended on: adding it would re-run the exit every time the exit's own
    // completion flipped it, which lands the panel back on screen for a frame.
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
      // Parked at its own height first, so the entrance travels exactly the panel's height however
      // tall it turned out to be. Starting from the screen's height makes a short sheet arrive
      // late and fast.
      translate.setValue(h);
      const rest = screenHeight * restHeightFraction;
      settle(h > rest + 32 ? h - rest : 0);
    },
    [restHeightFraction, screenHeight, settle, translate],
  );

  /**
   * The backdrop reads the panel's position rather than being animated alongside it.
   *
   * That coupling is what makes the drag legible: half a drag is half a backdrop, and letting go
   * from there springs both back together. Two independent timings could not stay in step under a
   * gesture that can be reversed mid-flight. It is capped below full so the swing is never wholly
   * hidden — this panel is about the picture behind it.
   */
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
        // Only after the finger has committed to a vertical move — otherwise the responder steals
        // the first touch from the controls sitting inside the sheet's header.
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 4 && Math.abs(g.dy) > Math.abs(g.dx),
        onPanResponderMove: (_e, g) => {
          // Never above the top detent. Dragging a sheet past its own full height is a gesture with
          // nothing behind it, and allowing it exposes the gap under the panel.
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

  // Same rule as the system `Sheet`: render on `visible`, not one commit later. The Modal's
  // window has to exist before a touch lands, or that touch goes to the screen behind it.
  if (!visible && !mounted) return null;

  const expandable = detents.length > 1;

  return (
    <>
      {/* The tap-through guard — see `design/system/Sheet.tsx` for the failure it prevents: the
       * Modal's window is not receiving input yet for a frame or two after mount, so a tap aimed
       * at the sheet fires a control on the HOST screen instead, and the golfer's second tap is
       * the first one this panel ever sees. */}
      {visible ? (
        <View
          style={StyleSheet.absoluteFill}
          onStartShouldSetResponder={() => true}
          testID={testID ? `${testID}-guard` : undefined}
        />
      ) : null}
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
                // Padded for the detent, not for the visible height: when the panel is resting low,
                // its bottom edge is off screen and the content above it must still clear the
                // gesture bar once it is dragged up.
                maxHeight: screenHeight * maxHeightFraction,
                paddingBottom: 16 + insets.bottom,
                transform: [{ translateY: translate }],
              },
            ]}
          >
            {/* The whole header is the grab area, and it is deliberately tall: this is the only
                surface the drag can start from, so a thin grip line would make the gesture a
                matter of aim. */}
            <View {...pan.panHandlers} style={styles.header}>
              <View style={styles.grip} />
              {shown.title ? (
                <View style={styles.titleRow}>
                  <View style={styles.titleText}>
                    <Text style={styles.title}>{shown.title}</Text>
                    {shown.subtitle ? (
                      <Text style={styles.subtitle}>{shown.subtitle}</Text>
                    ) : null}
                  </View>
                  {shown.accessory}
                  {/* Dragging is not available to a screen reader, and neither is tapping a
                      backdrop it does not describe. This is the accessible way out — and, when the
                      sheet has two heights, the accessible way between them. */}
                  {expandable ? (
                    <Pressable
                      testID={testID ? `${testID}-expand` : undefined}
                      accessibilityRole="button"
                      accessibilityLabel={resting.current === 0 ? "Collapse" : "Expand"}
                      hitSlop={12}
                      onPress={() => settle(resting.current === 0 ? detents[1] : 0)}
                      style={({ pressed }) => [styles.headerCap, pressed && styles.headerCapPressed]}
                    >
                      <View style={styles.expandChevron} />
                    </Pressable>
                  ) : null}
                  <Pressable
                    testID={testID ? `${testID}-close` : undefined}
                    accessibilityRole="button"
                    accessibilityLabel="Close"
                    hitSlop={12}
                    onPress={onClose}
                    style={({ pressed }) => [styles.headerCap, pressed && styles.headerCapPressed]}
                  >
                    <View style={styles.closeBarA} />
                    <View style={styles.closeBarB} />
                  </Pressable>
                </View>
              ) : null}
            </View>

            {scrolls && overflows ? (
              <ScrollView
                style={styles.scroll}
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                disableScrollViewPanResponder
              >
                {shown.children}
              </ScrollView>
            ) : (
              <View style={[styles.scroll, styles.scrollContent]}>{shown.children}</View>
            )}

            {/* In-flight guard — see the note at `inMotion`. */}
            {inMotion ? (
              <View
                style={StyleSheet.absoluteFill}
                onStartShouldSetResponder={() => true}
                testID={testID ? `${testID}-inflight-guard` : undefined}
              />
            ) : null}
          </Animated.View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  backdropFill: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: BLACK },
  panel: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: DECK.glass.sheet,
    borderTopLeftRadius: DECK.radius.slab,
    borderTopRightRadius: DECK.radius.slab,
    paddingHorizontal: 18,
    paddingTop: 10,
    boxShadow: DECK.shadow.slab,
  },
  header: { paddingBottom: 4 },
  grip: {
    alignSelf: "center",
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.22)",
  },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 14 },
  titleText: { flex: 1, gap: 2 },
  title: { color: DECK.label.onFace, fontSize: 17, fontWeight: "700", letterSpacing: -0.3 },
  subtitle: { color: DECK.label.caption, fontSize: 12, lineHeight: 16 },
  headerCap: {
    width: 32,
    height: 32,
    borderRadius: DECK.radius.cap,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: DECK.glass.key,
  },
  headerCapPressed: { opacity: 0.6 },
  expandChevron: {
    width: 9,
    height: 9,
    marginTop: 3,
    borderLeftWidth: 1.8,
    borderBottomWidth: 1.8,
    borderColor: DECK.label.caption,
    transform: [{ rotate: "135deg" }],
  },
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
  // `flexShrink` so the content gives way to `maxHeight` rather than pushing the panel past it.
  scroll: { flexShrink: 1 },
  scrollContent: { paddingTop: 14, paddingBottom: 4, gap: 14 },
});
