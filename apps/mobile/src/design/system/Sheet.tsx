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

  /**
   * What the panel shows — frozen for the slide-out.
   *
   * A caller's state has almost always moved on by the time the exit animation runs: the row that
   * was being confirmed is `null`, the list it was reading is empty, the branch it lived in has
   * changed. Rendering live props through the exit therefore rewrites the panel in front of the
   * golfer — `Delete Swing 3?` became the fallback `Delete this swing?` and a three-answer
   * confirmation collapsed to two, mid-dismissal. The sheet replays whatever it was showing the
   * last time `visible` was true instead, so a panel on its way out never changes its mind.
   */
  const latched = useRef({ title, subtitle, titleIcon, accessory, children });
  if (visible) latched.current = { title, subtitle, titleIcon, accessory, children };
  const shown = visible
    ? { title, subtitle, titleIcon, accessory, children }
    : latched.current;

  // Mounted outlives `visible` — the panel has to still exist while it slides away, so the
  // caller can treat `visible` as plain boolean state.
  const [mounted, setMounted] = useState(visible);
  const [height, setHeight] = useState(0);


  const { height: screenHeight } = useWindowDimensions();

  /**
   * Whether the content is taller than the room the panel has — and why a sheet that fits carries
   * NO `ScrollView` at all rather than a disabled one.
   *
   * An Android `ScrollView` takes taps away from the controls inside it by two independent routes,
   * and disabling scrolling only closes one of them:
   *   - **Native.** `onInterceptTouchEvent` sets `mIsBeingDragged = !mScroller.isFinished()` on the
   *     touch DOWN, cancelling the press to stop a scroll that was not moving. `scrollEnabled`
   *     does gate this one.
   *   - **JavaScript.** `ScrollView._handleStartShouldSetResponderCapture` claims the gesture in
   *     the CAPTURE phase — before any descendant is offered it — while the view counts as
   *     animating, or to spend the tap dismissing a keyboard. `scrollEnabled` does not gate this
   *     one at all, and the prop that would (`onStartShouldSetResponderCapture`) is overwritten by
   *     ScrollView's own handler, so it cannot be turned off from outside.
   *
   * Both produce the same thing on glass: the row lights up under the finger and then nothing
   * happens, and the NEXT tap works — "I have to tap into the card first". A confirmation with
   * three answers has nothing to scroll, so the only reliable fix is not to have a ScrollView.
   *
   * Overflow is read off the PANEL, not the content: the panel is capped at `maxHeightFraction`,
   * so a panel measuring at its cap is one whose content did not fit. Unmeasured counts as
   * overflowing, because a long list rendered in a plain View would be clipped with no way out.
   */
  const heightCap = screenHeight * maxHeightFraction;
  const overflows = height <= 0 || height >= heightCap - 1;
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

  /**
   * The panel is moving under its own animation — and while it is, IT must not take presses.
   *
   * The failure this guards (caught in a Pressability signal trace, 2026-08-22): a tap lands on a
   * row while the entrance spring is still running. The responder is granted and `pressIn` fires,
   * but Pressability measures the row's press rect ASYNCHRONOUSLY after the grant — by which time
   * the panel has travelled further up, so the stored rect is where the row is GOING, not where
   * the finger is. The finger's first micro-move then reads as LEAVE_PRESS_RECT, and the release
   * fires no `onPress`. On glass: the row lights up, nothing happens, the second tap works —
   * exactly "I have to tap into the card first". A busy JS thread widens the race, which is why
   * screens with video underneath were worst.
   *
   * So while any settle animation runs, a guard absorbs the panel's touches, and the spring is
   * given rest thresholds so "running" ends when the motion stops being visible (~200ms) rather
   * than trailing sub-pixel for most of a second. A tap during flight does nothing — which is
   * honest — and the tap after it lands on a panel whose geometry is true.
   *
   * A counter, not a boolean: a settle can interrupt a settle (expand while entering), and the
   * guard must drop only when the LAST animation ends.
   */
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
        // Rest when the motion stops being VISIBLE. The defaults (0.001px) keep the spring
        // "running" for most of a second after the eye says it stopped, and the whole time the
        // in-flight guard above would be holding the panel's touches hostage.
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
      if (!finished) return;
      setMounted(false);
      // Reset only once the panel is really gone. Doing it the moment `visible` flipped opened a
      // window in which a re-layout mid-exit — which is ordinary, because a caller that clears
      // its data as it closes changes the panel's content — re-ran the ENTRANCE below and
      // sprang the sheet back onto the screen, half-dismissed and stuck there.
      opened.current = false;
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



  const onPanelLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const h = e.nativeEvent.layout.height;
      if (h <= 0) return;
      setHeight(h);
      // A layout that arrives while the panel is on its way out must not be read as an entrance.
      if (!visible) return;
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
    [restHeightFraction, screenHeight, settle, translate, visible],
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

  // Rendered the moment `visible` turns true, NOT one commit later once the effect above has
  // flipped `mounted`. Waiting cost a real bug: the Modal opens its own window, and until that
  // window exists every touch is dispatched to the SCREEN BEHIND — so a tap that arrived while
  // the sheet was still coming up fired a control on the host instead, and the golfer's next tap
  // was the first one the sheet ever saw. That reads as "buttons need two taps". `mounted` still
  // outlives `visible` on the way out; it just no longer gates the way in.
  if (!visible && !mounted) return null;

  const expandable = detents.length > 1;

  return (
    <>
      {/* The tap-through guard, and the reason it exists.
       *
       * A `Modal` opens its OWN window, and that window is not added — nor wired to the input
       * dispatcher — until a frame or two after React has mounted it. Every touch that lands in
       * that gap is delivered to the window UNDERNEATH: the host screen. So a golfer who opened
       * this sheet and reached straight for an answer fired whatever host control happened to sit
       * behind the row (measured: the delete sheet's rows sit over the session dock, and the tap
       * opened the swing log instead), and the tap that finally reached the sheet was their
       * SECOND one. That is the whole of "buttons need two taps".
       *
       * This absorbs those taps in the host tree, where they are actually being delivered. It
       * mounts in the same commit `visible` turns true — the earliest moment anything can — and a
       * bare View is not touchable in React Native, so it claims the responder explicitly. */}
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
              {shown.title ? (
                <View style={styles.titleRow}>
                  {shown.titleIcon}
                  <View style={styles.titleText}>
                    <Text style={styles.title}>{shown.title}</Text>
                    {shown.subtitle ? (
                      <Text style={styles.subtitle}>{shown.subtitle}</Text>
                    ) : null}
                  </View>
                  {shown.accessory}
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
              {scrolls && overflows ? (
                <ScrollView
                  style={styles.scroll}
                  contentContainerStyle={styles.scrollContent}
                  showsVerticalScrollIndicator={false}
                  // The two knobs that DO close the JS capture route, for the panels that have to
                  // scroll: `handled` stops the tap being spent dismissing a keyboard, and the
                  // pan-responder opt-out stops the view claiming a gesture a control asked for.
                  keyboardShouldPersistTaps="handled"
                  disableScrollViewPanResponder
                >
                  {shown.children}
                </ScrollView>
              ) : (
                <View style={[styles.scroll, styles.scrollContent]}>{shown.children}</View>
              )}
            </AppTheme>

            {/* The in-flight guard — absorbs the panel's touches while it moves; see above. It
                sits over everything, including the header, because a drag started against a
                moving panel has the same stale-geometry problem a press does. */}
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
