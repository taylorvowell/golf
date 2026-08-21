import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Pressable, View } from "react-native";
import { Menu } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BrandLogo } from "./BrandLogo";
import { headerLatchStep } from "./navVisibility";
import { useTheme } from "../../theme";

/**
 * The app's persistent top chrome (Taylor 2026-08-17): the SwingSage lockup left, the profile
 * door right, identical on every tab. Each tab pads its scroll by `APP_HEADER_BAR` + the top
 * inset, so the content starts exactly at the bar's lower edge.
 *
 * **It slides fully out, and the content is a floor under that slide** (Taylor, 2026-08-18).
 * Two inputs, and the bar takes whichever hides it more:
 *
 *   * The LATCH — the driver. Once the screen is `SLIDE_AFTER_BAR_HEIGHTS` of this bar past the
 *     top, it animates all the way out, so it is only ever fully in or fully out rather than
 *     parked half on screen. Under that buffer it has not committed: the bar is still there,
 *     merely pushed by the content, so a short drag that settles again costs nothing.
 *   * `chromePx` — the floor. The bar is ALSO pushed by the scroll offset, at `PARALLAX` times
 *     the content's speed, so it lifts away slightly rather than being glued to it. If the
 *     content ever gets ahead of the animation — a fling the JS scroll callback cannot keep up
 *     with, or simply the first frames of the slide — the push has already moved the bar clear.
 *     This is the "just in case" half; on its own it would leave the bar partly visible, which
 *     is why it is a floor and not the driver.
 *
 * The latch's two thresholds are deliberately different, and that asymmetry is what makes the
 * return STICKY rather than a second animation. It engages once the screen is past the buffer,
 * so the bar goes fully out in one move. It releases only on the way back UP and only within one
 * bar-height of the top — so mid-page the bar stays gone however you drag, and the last stretch
 * of the return is the content carrying the bar back down with it.
 *
 * Summing them and clamping is what "whichever is further" costs here — `Animated` has no `max`,
 * and a sum clamped to the height is never LESS than either input, which is the property that
 * matters. Overshoot past the height is off screen and free.
 *
 * `hero` puts it on the dark hero screens (Swing Log, Progress): white wordmark. The bar has
 * NO ground of its own (Taylor 2026-08-17): it is transparent at every scroll position, so
 * the screen's own surface always shows through it.
 */

/** The bar's content height, below the top inset. Screens pad their scroll by inset + this. */
export const APP_HEADER_BAR = 56;

/**
 * How far the screen must leave the top before the bar commits to sliding out, **in multiples of
 * the bar's own height** (Taylor, 2026-08-18).
 *
 * Bar-relative rather than a fraction of the window, because the buffer is about this bar: it is
 * "let the content push it part of the way off before committing", which is a fixed relationship
 * to the bar's height and nothing at all to do with how tall the phone is. A window fraction
 * gave a 48px-status-bar phone and a short one different behaviour for no reason.
 */
const SLIDE_AFTER_BAR_HEIGHTS = 0.3;

/**
 * How much faster than the content the bar leaves — a slight parallax (Taylor, 2026-08-18).
 *
 * Keep it just above 1. The point is a little lift, not a race: at 1 the bar is glued to the
 * content, and much above it the bar visibly outruns the page and stops reading as attached to
 * it. The side benefit is margin — the bar is always slightly AHEAD of the content's edge, so a
 * frame the JS scroll callback drops during a fling costs clearance rather than an overlap.
 */
const PARALLAX = 1.15;



export function AppHeader({
  hero = false,
  chromePx,
  onProfile,
  bell,
  profileTestID = "open-profile",
}: {
  hero?: boolean;
  /** This screen's scroll offset, from its own `useChromeScroll()`. Per screen and not from
   *  context: screens keep their own scroll positions, and a shared offset drew a returning
   *  screen's header over its own content. */
  chromePx: Animated.Value;
  /**
   * The profile door. OMIT it to seal the header — session mode does that while a session is
   * running, because leaving mid-session is what "End session" is for and a door that silently
   * does nothing is worse than no door.
   */
  onProfile?: () => void;
  /**
   * The notifications door (§29) — a SLOT rather than a callback, because the bell carries the
   * unread count and the count comes from a feature store. The design system stays a leaf: it
   * owns where the bell sits (left of the profile door, same cluster), never what it knows.
   *
   * Same rule as the profile door: omitting it seals the bell, which is what session mode wants
   * — an inbox opened mid-swing is a golfer who stopped recording.
   */
  bell?: ReactNode;
  profileTestID?: string;
}) {
  const insets = useSafeAreaInsets();
  const t = useTheme();
  const height = insets.top + APP_HEADER_BAR;
  const slideAfter = height * SLIDE_AFTER_BAR_HEIGHTS;

  // The latch is derived here rather than in `navVisibility` because both of its thresholds are
  // this bar's own height, which the provider has no way to know.
  const [latched, setLatched] = useState(false);
  const last = useRef(0);
  useEffect(() => {
    const id = chromePx.addListener(({ value }) => {
      const previous = last.current;
      last.current = value;
      setLatched((was) => headerLatchStep(was, value, previous, { slideAfter, barHeight: height }));
    });
    return () => chromePx.removeListener(id);
  }, [chromePx, height, slideAfter]);

  const slide = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(slide, {
      toValue: latched ? 1 : 0,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [latched, slide]);

  const translateY = Animated.add(
    slide.interpolate({ inputRange: [0, 1], outputRange: [0, height] }),
    chromePx.interpolate({
      inputRange: [0, height / PARALLAX],
      outputRange: [0, height],
      extrapolate: "clamp",
    }),
  ).interpolate({ inputRange: [0, height], outputRange: [0, -height], extrapolate: "clamp" });

  return (
    <Animated.View
      // Always `box-none`: once it has been pushed off there is nothing left to press, and
      // gating this on a flag would reintroduce a threshold the rest of it does not have.
      pointerEvents="box-none"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height,
        transform: [{ translateY }],
      }}
    >
      <View
        style={{
          position: "absolute",
          left: 18,
          right: 18,
          bottom: 7,
          height: 42,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <BrandLogo height={26} color={hero ? "#FFFFFF" : undefined} />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        {bell}
        {onProfile ? (
        <Pressable
          testID={profileTestID}
          accessibilityRole="button"
          accessibilityLabel="Profile and settings"
          onPress={onProfile}
          hitSlop={8}
          style={({ pressed }) => [
            {
              width: 34,
              height: 34,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 17,
              // Pressed is the round grey bed — a fill, never opacity. White-alpha on the
              // hero screens because the glyph sits over footage there, not a themed surface.
              backgroundColor: pressed
                ? hero
                  ? "rgba(255,255,255,0.22)"
                  : t.pressBed
                : "transparent",
            },
          ]}
        >
          {/* Bare glyph, no bed (Taylor, 2026-08-19) — ink matches the wordmark beside it:
              white on the hero screens, the text ink elsewhere. */}
          <Menu size={22} color={hero ? "#FFFFFF" : t.text} strokeWidth={2.4} />
        </Pressable>
        ) : null}
        </View>
      </View>
    </Animated.View>
  );
}
