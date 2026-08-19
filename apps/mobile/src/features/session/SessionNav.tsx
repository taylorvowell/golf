import { useEffect, useRef, type ReactNode } from "react";
import { Animated, Pressable, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FONT_DISPLAY } from "../../design/system/typography";
import { useTheme } from "../../theme";

/**
 * Session mode's sticky bar (Taylor, step-03 iteration): the SAME construction as the main
 * tab bar — glass bar, circular rise proud of it, blend ellipse, gradient fade above — with
 * the record button in the raised centre, BIGGER than the main menu's (it is the screen's
 * one §41-critical control).
 *
 * The record button is ALWAYS at the exact horizontal centre of the screen (Taylor):
 * the side items live in two `flex: 1` half-rows around a fixed centre slot, so an
 * asymmetric item count (post-swing's first recording has no Previous slot) redistributes
 * within its own half and never pushes the button off centre.
 *
 * `sidesHidden` fades the halves out and drops their touches — during countdown and
 * recording only the stop shows (Taylor). The bump geometry scales up from WaveNav's
 * (126→140 rise) because the button it wraps is bigger.
 */

export interface SessionNavItem {
  key: string;
  label: string;
  /** Renders the glyph at the given colour (lucide icon, ~24px — bigger than the tab bar's). */
  icon: (color: string) => ReactNode;
  active?: boolean;
  disabled?: boolean;
  onPress: () => void;
  testID?: string;
}

const BAR_HEIGHT = 67;
const RISE = { diameter: 140, aboveBar: 38 };
const BLEND = { width: 172, height: 26, belowBarTop: 8 };
const RECORD_SLOT = 100;
const ROW_PAD = 10;
const FADE_ABOVE = 76;
/** The tab bar's dark ramp, verbatim — this bar must read as the same family. */
const FADE_STOPS = ["#0B152800", "#0B152859", "#0B152880"] as const;

export function SessionNav({
  leftItems,
  rightItems,
  center,
  sidesHidden = false,
}: {
  leftItems: SessionNavItem[];
  rightItems: SessionNavItem[];
  /** The raised centre — the session record/stop button. */
  center: ReactNode;
  sidesHidden?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const t = useTheme();
  // Session mode is pinned dark, so this resolves the tab bar's dark fill.
  const fill = t.mode === "dark" ? t.bgElevated : "rgba(255,255,255,0.98)";
  const activeColor = t.mode === "dark" ? t.aqua : t.cobalt;

  const fade = useRef(new Animated.Value(sidesHidden ? 0 : 1)).current;
  useEffect(() => {
    Animated.timing(fade, {
      toValue: sidesHidden ? 0 : 1,
      duration: 160,
      useNativeDriver: true,
    }).start();
  }, [fade, sidesHidden]);

  const totalHeight = BAR_HEIGHT + insets.bottom;

  const item = (entry: SessionNavItem) => {
    const color = entry.active ? activeColor : t.muted;
    return (
      <Pressable
        key={entry.key}
        testID={entry.testID}
        accessibilityRole="button"
        accessibilityState={{ selected: !!entry.active, disabled: !!entry.disabled }}
        accessibilityLabel={entry.label}
        disabled={entry.disabled || sidesHidden}
        onPress={entry.onPress}
        hitSlop={6}
        style={{
          flex: 1,
          height: 62,
          alignItems: "center",
          justifyContent: "center",
          gap: 5,
          alignSelf: "flex-end",
          opacity: entry.disabled ? 0.5 : 1,
        }}
      >
        {/* A 28px box holding a ~24px glyph — bigger than the tab bar's, per Taylor. */}
        <View style={{ width: 28, height: 28, alignItems: "center", justifyContent: "center" }}>
          {entry.icon(color)}
        </View>
        <Text
          numberOfLines={1}
          style={{
            color,
            fontFamily: FONT_DISPLAY.black,
            fontSize: 8,
            lineHeight: 8,
            letterSpacing: 0.2,
          }}
        >
          {entry.label}
        </Text>
      </Pressable>
    );
  };

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        // The fade lives INSIDE the box — Android does not reliably honour overflow: visible.
        height: totalHeight + FADE_ABOVE,
        justifyContent: "flex-end",
      }}
    >
      {/* The bar's whole GROUND — fade, surface, bump, blend — fades out while armed
          (Taylor, step-03 iteration): during countdown/recording only the stop button
          floats over the picture, and the surface returns when recording ends. */}
      <Animated.View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          opacity: fade,
        }}
      >
        <LinearGradient
          colors={FADE_STOPS}
          locations={[0, 0.62, 1]}
          style={{ position: "absolute", left: 0, right: 0, bottom: 0, top: 0 }}
        />
        <View
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: totalHeight,
            backgroundColor: fill,
          }}
        />
        {/* The bump — circle centred on the record button, plus the flatter blend. */}
        <View
          style={{
            position: "absolute",
            bottom: totalHeight + RISE.aboveBar - RISE.diameter,
            alignSelf: "center",
            width: RISE.diameter,
            height: RISE.diameter,
            borderRadius: RISE.diameter / 2,
            backgroundColor: fill,
          }}
        />
        <View
          style={{
            position: "absolute",
            bottom: totalHeight - BLEND.belowBarTop - BLEND.height,
            alignSelf: "center",
            width: BLEND.width,
            height: BLEND.height,
            borderRadius: BLEND.height / 2,
            backgroundColor: fill,
          }}
        />
      </Animated.View>
      {/* Two flex halves around a fixed centre slot — the centring guarantee. */}
      <View
        style={{
          position: "absolute",
          left: ROW_PAD,
          right: ROW_PAD,
          bottom: insets.bottom + ROW_PAD,
          flexDirection: "row",
          alignItems: "flex-end",
        }}
        pointerEvents="box-none"
      >
        <Animated.View
          pointerEvents={sidesHidden ? "none" : "box-none"}
          style={{ flex: 1, flexDirection: "row", opacity: fade }}
        >
          {leftItems.map(item)}
        </Animated.View>
        <View style={{ width: RECORD_SLOT, alignItems: "center", marginBottom: 6 }}>
          {center}
        </View>
        <Animated.View
          pointerEvents={sidesHidden ? "none" : "box-none"}
          style={{ flex: 1, flexDirection: "row", opacity: fade }}
        >
          {rightItems.map(item)}
        </Animated.View>
      </View>
    </View>
  );
}

/** What a session screen must keep clear above the bottom edge for this bar. */
export const SESSION_NAV_CLEARANCE = BAR_HEIGHT;
