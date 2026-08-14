import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import {
  Animated,
  BackHandler,
  Easing,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from "react-native";

import { ChevronGlyph, DECK } from "../../design/deck";

/**
 * The after-swing summary — a panel that is UP by default and gets out of the way.
 *
 * `DeckSheet` is deliberately not reused, because the two are opposite objects. A `DeckSheet` is
 * transient: a `Modal` you summon over the picture and dismiss, gone when closed. This panel is
 * the after-swing screen's *resting state* — it is showing before the golfer touches anything,
 * the dock's controls must stay reachable underneath it (a `Modal` would swallow them), and
 * "closed" means "parked below, one gesture away", not "unmounted". What it keeps from
 * `DeckSheet` is the physics: drag from the header, velocity-projected release, spring to the
 * detent the throw was aimed at.
 *
 * ## The drag starts from the header
 *
 * A JS responder cannot reliably wrestle a vertical pull away from a native `ScrollView` on
 * Android, and the library that can (`react-native-gesture-handler`) is deliberately excluded
 * (D47) — measured here: a capture-phase PanResponder over the content never received the
 * gesture. So the drag surface is the grip header, DeckSheet's proven pattern, and the chevron,
 * the dock's tab, hardware back and the play cap are the other four ways down.
 *
 * ## Clipped, not unmounted
 *
 * The closed panel sits translated past its own bottom edge inside an `overflow: hidden` wrapper,
 * so nothing shows and nothing intercepts, but the content keeps its state (scroll position, the
 * mini player's decoder) and reopening is instant. The wrapper is `box-none`, so the video and
 * the transport behind it stay tappable while the sheet is away.
 */

export interface SummarySheetProps {
  open: boolean;
  /** Every open/close, whatever caused it — drag, fling, hardware back, the collapse cap. */
  onOpenChange: (open: boolean) => void;
  /** Video left showing above the open panel — the strip that says "you are still on the swing". */
  topOffset: number;
  /** The dock's height. The panel rests on the dock, never behind it. */
  bottomOffset: number;
  children: ReactNode;
  testID?: string;
}

/** How far a fling is projected past where the finger let go — DeckSheet's constant. */
const FLING_PROJECTION_MS = 140;
/** How much of its height the panel must be thrown past before release closes it. */
const CLOSE_FRACTION = 0.3;

export function SummarySheet({
  open,
  onOpenChange,
  topOffset,
  bottomOffset,
  children,
  testID,
}: SummarySheetProps) {
  /**
   * Parked far offscreen until the first layout, so the entrance is one slide up from below
   * rather than a flash of panel at the wrong place. 9999 over `screenHeight` because the wrapper
   * clips — any value past the panel's own height is simply "not visible".
   */
  const translate = useRef(new Animated.Value(9999)).current;
  const openRef = useRef(open);
  const heightRef = useRef(0);
  const measured = useRef(false);

  const settle = useCallback(
    (to: number, velocity = 0) => {
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

  // Mirror written in an effect, never the render body — the PanResponder callbacks read it.
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    if (!measured.current) return;
    if (open) settle(0);
    else {
      Animated.timing(translate, {
        toValue: heightRef.current,
        duration: 220,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }
  }, [open, settle, translate]);

  /** Hardware back closes the panel before it leaves the screen — the sheet idiom, kept even
   *  though there is no `Modal` here to provide it. */
  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onOpenChange(false);
      return true;
    });
    return () => sub.remove();
  }, [open, onOpenChange]);

  const onPanelLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const h = e.nativeEvent.layout.height;
      if (h <= 0) return;
      // The ref, not state: nothing draws from the height — it is the drag's coordinate system,
      // and a rotation re-fires this layout with the new value anyway.
      heightRef.current = h;
      if (!openRef.current && measured.current) translate.setValue(h);
      if (measured.current) return;
      measured.current = true;
      // The entrance travels exactly the panel's height, from parked-below to wherever it opens.
      translate.setValue(h);
      if (openRef.current) settle(0);
    },
    [settle, translate],
  );

  const release = useCallback(
    (dy: number, vy: number) => {
      const from = openRef.current ? 0 : heightRef.current;
      const projected = from + dy + vy * FLING_PROJECTION_MS;
      const shouldOpen = projected < heightRef.current * CLOSE_FRACTION;
      if (shouldOpen !== openRef.current) onOpenChange(shouldOpen);
      // Settled here as well as in the effect: when the decision matches the current state the
      // effect sees no change and would leave the panel wherever the finger dropped it.
      if (shouldOpen) settle(0, vy);
      else settle(heightRef.current, vy);
    },
    [onOpenChange, settle],
  );

  const pan = useMemo(
    () =>
      PanResponder.create({
        // The header claims a committed vertical move outright.
        onMoveShouldSetPanResponder: (_e, g) =>
          Math.abs(g.dy) > 4 && Math.abs(g.dy) > Math.abs(g.dx),
        onPanResponderMove: (_e, g) => {
          const from = openRef.current ? 0 : heightRef.current;
          translate.setValue(Math.max(0, from + g.dy));
        },
        onPanResponderRelease: (_e, g) => release(g.dy, g.vy),
        onPanResponderTerminate: () => settle(openRef.current ? 0 : heightRef.current),
      }),
    [release, settle, translate],
  );

  return (
    <View
      style={[styles.clip, { top: topOffset, bottom: bottomOffset }]}
      pointerEvents="box-none"
      testID={testID}
    >
      <Animated.View
        onLayout={onPanelLayout}
        // A closed panel is clipped out of sight, but Android still routes taps by layout bounds
        // in some stacks — `none` makes the parked panel untouchable outright.
        pointerEvents={open ? "auto" : "none"}
        style={[styles.panel, { transform: [{ translateY: translate }] }]}
      >
        <View {...pan.panHandlers} style={styles.header}>
          <View style={styles.grip} />
          {/* Dragging is not available to a screen reader; this is the accessible way down. */}
          <Pressable
            testID={testID ? `${testID}-collapse` : undefined}
            accessibilityRole="button"
            accessibilityLabel="Hide summary"
            hitSlop={12}
            onPress={() => onOpenChange(false)}
            style={({ pressed }) => [styles.headerCap, pressed && styles.headerCapPressed]}
          >
            <ChevronGlyph size={9} color={DECK.label.caption} direction="down" />
          </Pressable>
        </View>

        <View style={styles.body}>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
        </View>

      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  clip: {
    position: "absolute",
    left: 0,
    right: 0,
    overflow: "hidden",
  },
  panel: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    // Solid rather than DeckSheet's glass: this panel carries a page of reading, and the swing
    // moving behind translucency would sit exactly underneath the text it competes with.
    backgroundColor: DECK.ground,
    borderTopLeftRadius: DECK.radius.slab,
    borderTopRightRadius: DECK.radius.slab,
    paddingHorizontal: 18,
    paddingTop: 10,
    boxShadow: DECK.shadow.slab,
  },
  header: {
    paddingBottom: 6,
    alignItems: "center",
  },
  grip: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.22)",
  },
  headerCap: {
    position: "absolute",
    right: 0,
    top: 2,
    width: 32,
    height: 32,
    borderRadius: DECK.radius.cap,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: DECK.glass.key,
  },
  headerCapPressed: { opacity: 0.6 },
  body: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { paddingTop: 12, paddingBottom: 20, gap: 16 },
});
