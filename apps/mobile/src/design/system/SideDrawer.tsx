import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import {
  Animated,
  BackHandler,
  PanResponder,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "../../theme";

/**
 * A panel that slides in from the right over the screen that opened it, on a dimmed ground.
 *
 * Three ways out, because a drawer with only a button is a drawer people get stuck in: the
 * host's own close control, a tap on the dimmed strip beside it, and a drag to the right.
 * The drag is `PanResponder` from React Native core rather than `react-native-gesture-handler`
 * — that package is deliberately unlinked on Android (`react-native.config.js`), and one
 * horizontal dismiss does not justify relinking it.
 *
 * **One `Animated.Value` in pixels drives everything** (0 = open, panel width = shut), so the
 * scrim dims by exactly as much as the panel has covered — mid-drag included, on the native
 * driver. Interpolating two clocks against each other is how a half-dragged sheet ends up
 * darker than a closed one.
 *
 * The panel floats: a gap above and below the safe area, flush to the right edge, so only its
 * left corners are rounded. Closing is animated *then* reported — `onClosed` pops the route,
 * so calling it first would tear the panel off screen mid-slide.
 */

/** Close the drawer, then run `then` once it is off screen (e.g. navigate somewhere). */
export type DrawerClose = (then?: () => void) => void;

const OPEN_MS = 300;
const CLOSE_MS = 210;
/** Past this fraction of the panel's width, the release lets go rather than springing back. */
const DISMISS_FRACTION = 0.32;
/** …or a flick this fast, however short. */
const DISMISS_VELOCITY = 0.5;
/** The dimmed app underneath. Fixed, not themed: it is shade, not a surface. */
const SCRIM = "rgba(5,10,22,0.62)";

export function SideDrawer({
  onClosed,
  widthRatio = 0.86,
  gap = 10,
  testID,
  children,
}: {
  /** The drawer is off screen — pop the route. Never called before the slide finishes. */
  onClosed: () => void;
  /** Share of the screen the panel takes. The remainder is the tappable dimmed strip. */
  widthRatio?: number;
  /** Space above and below the panel, past the safe area. */
  gap?: number;
  testID?: string;
  /** Render-prop so the host's rows can close the drawer before they navigate. */
  children: (close: DrawerClose) => ReactNode;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const panelWidth = Math.round(width * widthRatio);

  const x = useRef(new Animated.Value(panelWidth)).current;
  // Latched: a flick that lands while the close timing is already running must not start a
  // second one, or `onClosed` pops twice and takes the screen below with it.
  const closing = useRef(false);

  useEffect(() => {
    Animated.timing(x, {
      toValue: 0,
      duration: OPEN_MS,
      useNativeDriver: true,
    }).start();
  }, [x]);

  const close = useCallback<DrawerClose>(
    (then) => {
      if (closing.current) return;
      closing.current = true;
      Animated.timing(x, {
        toValue: panelWidth,
        duration: CLOSE_MS,
        useNativeDriver: true,
      }).start(() => {
        onClosed();
        then?.();
      });
    },
    [x, panelWidth, onClosed],
  );

  // Android's back gesture closes the drawer the same way the X does, rather than popping the
  // route out from under the animation.
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      close();
      return true;
    });
    return () => sub.remove();
  }, [close]);

  const settle = useCallback(() => {
    Animated.spring(x, {
      toValue: 0,
      useNativeDriver: true,
      speed: 18,
      bounciness: 0,
    }).start();
  }, [x]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        // Claimed only once the finger is clearly travelling right, so the panel's own
        // scrolling still wins every vertical drag.
        onMoveShouldSetPanResponder: (_e, g) =>
          g.dx > 10 && Math.abs(g.dx) > Math.abs(g.dy) * 1.6,
        // Rightward only: dragging left would peel the panel off its own edge.
        onPanResponderMove: (_e, g) => x.setValue(Math.max(0, g.dx)),
        onPanResponderRelease: (_e, g) => {
          if (g.dx > panelWidth * DISMISS_FRACTION || g.vx > DISMISS_VELOCITY) {
            close();
            return;
          }
          settle();
        },
        onPanResponderTerminate: settle,
      }),
    [x, panelWidth, close, settle],
  );

  const scrimOpacity = useMemo(
    () => x.interpolate({ inputRange: [0, panelWidth], outputRange: [1, 0] }),
    [x, panelWidth],
  );

  return (
    <View style={StyleSheet.absoluteFill} testID={testID}>
      <Animated.View
        style={[StyleSheet.absoluteFill, { backgroundColor: SCRIM, opacity: scrimOpacity }]}
      >
        <Pressable
          testID={testID ? `${testID}-scrim` : undefined}
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={() => close()}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>

      <Animated.View
        {...pan.panHandlers}
        style={[
          {
            position: "absolute",
            right: 0,
            top: insets.top + gap,
            bottom: insets.bottom + gap,
            width: panelWidth,
            borderTopLeftRadius: 28,
            borderBottomLeftRadius: 28,
            backgroundColor: t.bgElevated,
            overflow: "hidden",
            transform: [{ translateX: x }],
          },
        ]}
      >
        {children(close)}
      </Animated.View>
    </View>
  );
}
