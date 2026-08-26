import { useEffect, useRef, type ReactNode } from "react";
import { Animated, Pressable, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "../../theme";
import { FONT_DISPLAY } from "./typography";
import { RecordButton } from "./RecordButton";

/**
 * `.wave-mini` / `.wave-preview` (mockup §10): the app's signature tab bar — a glass bar
 * whose surface bulges up under the raised circular Record button. The bump is built exactly
 * as the mockup builds it: a 126px circular rise proud of the bar plus a flatter 158×26 blend back
 * into it, both in the bar's own fill, so it renders correctly over any content colour
 * (surface on surface, no border). Glass = near-opaque theme fill (named deviation: no
 * backdrop blur).
 *
 * Each tab is a 21px glyph in a 24px box over a 7/900 label. The active colour is cobalt on
 * light and **aqua on dark** — the mockup's own override, and the one place the nav's active
 * voice is not the app's primary.
 *
 * Hiding: `hidden` slides the whole bar down (translateY + opacity, native driver). Per the
 * amended chrome rule this prop may only ever be driven from scroll state — see
 * `navVisibility.ts`.
 *
 * **The bar OVERLAYS the screen; it does not take layout space.** `BottomTabView` lays its
 * tabBar out as the last flex child of a column, so a bar that merely translates away leaves
 * its reserved height behind as a blank strip at the bottom of the screen — which is exactly
 * what it did (Taylor, 2026-08-18). `TabBar` therefore hosts this in a zero-height view and the
 * root here is absolutely positioned, so hiding the bar reveals content rather than a hole.
 * Screens pay for that by clearing `WAVE_NAV_CLEARANCE` at the bottom of their own scroll.
 *
 * The fade is what makes content passing *behind* the bar read as deliberate: a gradient from
 * transparent to the bar's own fill, so the bar has no hard top edge and the content dissolves
 * into it. It rides inside the animated group, so it leaves with the bar — a fade left behind
 * would keep hiding the content the hide was for.
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
/**
 * The raised centre section (`.base::before`) — a TRUE circle, 126 across for the clear space
 * the mockup widened it to get. Its top sits `aboveBar` above the bar's edge; the rest sinks behind
 * the bar, which is opaque, so only the dome is ever seen.
 *
 * The CSS is `126x96` + `border-radius: 50%`, which a browser draws as an ellipse. React
 * Native clamps a radius to half the SHORT side, so the same numbers came out as a stadium —
 * 30px of flat top with straight shoulders, which is what read as "curved corners, stretched
 * wide" (Taylor, 2026-08-18). One diameter, not two, is the fix: keep the width, drop the
 * ellipse.
 */
const RISE = { diameter: 126, aboveBar: 31 };
/** The wider blend from the rise back into the bar (`.base::after`), 8px below the bar's top. */
const BLEND = { width: 158, height: 26, belowBarTop: 8 };
/** The centre slot's grid column, and how far the button's own bottom sits above the row. */
const RECORD_SLOT = 86;
const RECORD_LIFT = 8;
/** `.wave-items` padding: `0 10px 10px`. */
const ROW_PAD = 10;
/** How far above the bar's top edge the fade reaches before it is fully transparent. The
 *  tallest thing in this component, so it also sets how far the bar travels when it hides —
 *  the bump and record button rise less than this. */
const FADE_ABOVE = 76;

/**
 * The fade's three stops — **the same dark ramp in both themes** (Taylor, 2026-08-18).
 *
 * A fade tinted per theme is invisible in light mode: white running into the near-white `bg`
 * has nothing to show. The dark ramp reads on both grounds, and the bottom stop is hidden
 * behind the bar anyway — only the transparent end of it is ever on screen, which is the part
 * doing the work. `#0A1A29` is the dark theme's `bgElevated`, stated literally here because
 * this is deliberately NOT theme-following; the value is a constant of the design.
 */
const FADE_STOPS = ["#0A1A2900", "#0A1A2959", "#0A1A2980"] as const;

/**
 * What a tab screen must leave clear at the bottom of its scroll, on top of its own padding
 * and the safe-area inset. The bar floats over the content, so nothing reserves this for you.
 */
export const WAVE_NAV_CLEARANCE = BAR_HEIGHT;

/**
 * A sticky bar's share of the bottom inset — CAPPED (Taylor, 2026-08-19): stacking the full
 * system inset under the row made the bar an enormous blank band over phones with on-screen
 * nav buttons. The row keeps at most this sliver above the screen's edge, plus a fixed 15px
 * resting pad (Taylor, 2026-08-19 — the row sat too tight against the screen's bottom edge);
 * the bar's fill still runs all the way down behind the system bar. One function so every
 * bottom bar (this one, `SessionNav`) moves together, and so does everything that must clear
 * them.
 */
export function navBarBottomInset(bottomInset: number): number {
  return Math.min(bottomInset, 10) + 15;
}

export function WaveNav({
  items,
  onRecord,
  hidden = false,
  recordTestID,
  centerSlot,
}: {
  /** Exactly four items — two left of Record, two right (the mockup's five slots). */
  items: WaveNavItem[];
  onRecord: () => void;
  hidden?: boolean;
  recordTestID?: string;
  /**
   * Replaces the raised Record button — the INSTRUCTOR shell's Broadcast door is the first
   * user (architecture §4a: Broadcast is the instructor's one-tap act the way Record is the
   * golfer's). The geometry (slot width, lift) stays this bar's; only the control swaps, so
   * the two shells' bars stay one system. When set, `onRecord`/`recordTestID` are unused.
   */
  centerSlot?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const t = useTheme();
  // The mockup's dark override paints every nav surface bgElevated. Light is PURE white,
  // not near-opaque (Taylor, 2026-08-18): at 0.98 the footage and the page underneath ghosted
  // through the bar and the two bars read as slightly different whites over different grounds.
  const fill = t.mode === "dark" ? t.bgElevated : "#FFFFFF";
  // Active tab: cobalt on light, AQUA on dark — the mockup's own dark override, and the one
  // place the nav's active voice is not the app's primary.
  const activeColor = t.mode === "dark" ? t.aqua : t.cobalt;

  const slide = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(slide, {
      toValue: hidden ? 1 : 0,
      duration: 280,
      useNativeDriver: true,
    }).start();
  }, [hidden, slide]);

  const totalHeight = BAR_HEIGHT + navBarBottomInset(insets.bottom);

  const item = (entry: WaveNavItem) => {
    const color = entry.active ? activeColor : t.muted;
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
        {/* No pressed bed here — Taylor tried one (2026-08-19) and cut it; the tab switching
            is the feedback. */}
        {/* `.wave-icon` — a 24px box holding a 21px glyph, so glyphs of differing aspect all
            sit on the same baseline instead of shifting the label under them. */}
        <View style={{ width: 24, height: 24, alignItems: "center", justifyContent: "center" }}>
          {entry.icon(color)}
        </View>
        {/* The label is DRAWN, not just announced (Taylor, 2026-08-18). 7/900 with the
            mockup's 0.025em tracking — tiny on purpose; the glyph is what is read at a
            glance and the word is what settles which glyph it was. */}
        <Text
          numberOfLines={1}
          style={{
            color,
            fontFamily: FONT_DISPLAY.black,
            fontSize: 7,
            // Taller than the font size on purpose: Android clips a glyph to its line box, so
            // lineHeight 7 shaved the descenders off g/y/p in the labels.
            lineHeight: 10,
            letterSpacing: 0.175,
          }}
        >
          {entry.label}
        </Text>
      </Pressable>
    );
  };

  return (
    <Animated.View
      // `box-none`, not `auto`: the container is now taller than the bar so the fade has real
      // space, and an `auto` container would swallow every touch in that transparent band.
      pointerEvents={hidden ? "none" : "box-none"}
      style={{
        // Absolute, NOT a flex child: see the note at the top of this file — a laid-out bar
        // leaves a blank strip behind when it slides away.
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        // The fade is INSIDE the box rather than overflowing it. Android does not honour
        // `overflow: visible` reliably, so a gradient drawn past the container's top edge is a
        // gradient that may simply not be there — which is how the first version of this
        // rendered nothing at all.
        height: totalHeight + FADE_ABOVE,
        justifyContent: "flex-end",
        transform: [
          {
            translateY: slide.interpolate({
              inputRange: [0, 1],
              // The full box, so nothing of the fade is left banded across the bottom edge
              // while the group is on its way out.
              outputRange: [0, totalHeight + FADE_ABOVE],
            }),
          },
        ],
        opacity: slide.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
      }}
    >
      {/* The fade, FIRST so everything else paints over it. It fills the container: transparent
          at the top, solid at the bottom where the bar hides it anyway. Never a touch target —
          the content it covers is still the content underneath. */}
      <LinearGradient
        pointerEvents="none"
        colors={FADE_STOPS}
        locations={[0, 0.62, 1]}
        style={{ position: "absolute", left: 0, right: 0, bottom: 0, top: 0 }}
      />
      {/* The bar surface. */}
      <View style={{ height: totalHeight, backgroundColor: fill }} />
      {/* The bump: circle + flatter ellipse in the same fill (`.base::before/::after`).
          The circle is CENTRED on the record button (Taylor 2026-08-14: it sat too high and
          read as a halo above the button instead of the surface bulging around it). The
          button's centre sits 6px above the bar top — see the slot row's geometry below. */}
      <View
        pointerEvents="none"
        style={{
          // Top edge `aboveBar` above the bar's top, so the bottom lands a diameter lower.
          bottom: totalHeight + RISE.aboveBar - RISE.diameter,
          position: "absolute",
          alignSelf: "center",
          width: RISE.diameter,
          height: RISE.diameter,
          borderRadius: RISE.diameter / 2,
          backgroundColor: fill,
        }}
      />
      <View
        pointerEvents="none"
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
      {/* The five slots, riding over the surface. */}
      <View
        style={{
          position: "absolute",
          left: ROW_PAD,
          right: ROW_PAD,
          bottom: navBarBottomInset(insets.bottom) + ROW_PAD,
          flexDirection: "row",
          alignItems: "flex-end",
        }}
      >
        {item(items[0])}
        {item(items[1])}
        <View style={{ width: RECORD_SLOT, alignItems: "center", marginBottom: RECORD_LIFT }}>
          {centerSlot ?? <RecordButton compact onPress={onRecord} testID={recordTestID} />}
        </View>
        {item(items[2])}
        {item(items[3])}
      </View>
    </Animated.View>
  );
}
