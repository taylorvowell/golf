import { useEffect, useRef, type ReactNode } from "react";
import { Animated, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "../../theme";
import { RecordButton } from "./RecordButton";
import { FONT_DISPLAY } from "./typography";

/**
 * `.wave-mini` / `.wave-preview` (mockup §10): the app's signature tab bar — a glass bar
 * whose surface bulges up under the raised circular Record button. The bump is built exactly
 * as the mockup builds it: a 96px circle proud of the bar plus a flatter 122×24 ellipse,
 * both in the bar's own fill, so it renders correctly over any content colour (surface on
 * surface, no border). Glass = near-opaque theme fill (named deviation: no backdrop blur).
 *
 * Hiding: `hidden` slides the whole bar down (translateY + opacity, native driver). Per the
 * amended chrome rule this prop may only ever be driven from scroll state — see
 * `navVisibility.ts`.
 */
export interface WaveNavItem {
  key: string;
  label: string;
  /** Renders the glyph at the given colour (lucide icon, ~21px). */
  icon: (color: string) => ReactNode;
  active?: boolean;
  onPress: () => void;
  testID?: string;
}

/** The bar's resting height, before the bottom inset — the mockup's 67px base. */
const BAR_HEIGHT = 67;
/** How far above the bar's top edge the bump + record button rise. */
const OVERHANG = 37;

export function WaveNav({
  items,
  onRecord,
  hidden = false,
  recordTestID,
}: {
  /** Exactly four items — two left of Record, two right (the mockup's five slots). */
  items: WaveNavItem[];
  onRecord: () => void;
  hidden?: boolean;
  recordTestID?: string;
}) {
  const insets = useSafeAreaInsets();
  const t = useTheme();
  // The mockup's dark override paints every nav surface bgElevated; light keeps near-opaque white.
  const fill = t.mode === "dark" ? t.bgElevated : "rgba(255,255,255,0.96)";

  const slide = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(slide, {
      toValue: hidden ? 1 : 0,
      duration: 280,
      useNativeDriver: true,
    }).start();
  }, [hidden, slide]);

  const totalHeight = BAR_HEIGHT + insets.bottom;

  const item = (entry: WaveNavItem) => {
    const color = entry.active ? t.cobalt : t.muted;
    return (
      <Pressable
        key={entry.key}
        testID={entry.testID}
        accessibilityRole="tab"
        accessibilityState={{ selected: !!entry.active }}
        accessibilityLabel={entry.label}
        onPress={entry.onPress}
        hitSlop={6}
        style={{
          flex: 1,
          height: 60,
          alignItems: "center",
          justifyContent: "center",
          gap: 5,
          alignSelf: "flex-end",
        }}
      >
        <View style={{ width: 24, height: 24, alignItems: "center", justifyContent: "center" }}>
          {entry.icon(color)}
        </View>
        <Text
          style={{
            color,
            fontFamily: FONT_DISPLAY.black,
            fontSize: 7,
            letterSpacing: 0.18,
            textTransform: "uppercase",
          }}
        >
          {entry.label}
        </Text>
      </Pressable>
    );
  };

  return (
    <Animated.View
      pointerEvents={hidden ? "none" : "auto"}
      style={{
        // Layout owns only the bar itself; the bump + record button overhang above it and
        // draw over the screen's content, exactly as the mockup's absolute wave does.
        height: totalHeight,
        justifyContent: "flex-end",
        transform: [
          {
            translateY: slide.interpolate({
              inputRange: [0, 1],
              outputRange: [0, totalHeight + OVERHANG],
            }),
          },
        ],
        opacity: slide.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
      }}
    >
      {/* The bar surface. */}
      <View style={{ height: totalHeight, backgroundColor: fill }} />
      {/* The bump: circle + flatter ellipse in the same fill (`.base::before/::after`).
          The circle is CENTRED on the record button (Taylor 2026-08-14: it sat too high and
          read as a halo above the button instead of the surface bulging around it). The
          button's centre sits 6px above the bar top — see the slot row's geometry below. */}
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          bottom: totalHeight - 54,
          alignSelf: "center",
          width: 96,
          height: 96,
          borderRadius: 48,
          backgroundColor: fill,
        }}
      />
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          bottom: totalHeight - 16,
          alignSelf: "center",
          width: 122,
          height: 24,
          borderRadius: 12,
          backgroundColor: fill,
        }}
      />
      {/* The five slots, riding over the surface. */}
      <View
        style={{
          position: "absolute",
          left: 10,
          right: 10,
          bottom: insets.bottom + 6,
          flexDirection: "row",
          alignItems: "flex-end",
        }}
      >
        {item(items[0])}
        {item(items[1])}
        <View style={{ width: 78, alignItems: "center", marginBottom: BAR_HEIGHT - 47 }}>
          <RecordButton compact onPress={onRecord} testID={recordTestID} />
        </View>
        {item(items[2])}
        {item(items[3])}
      </View>
    </Animated.View>
  );
}
