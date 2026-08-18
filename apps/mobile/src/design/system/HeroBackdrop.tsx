import type { ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Circle, Defs, RadialGradient, Stop } from "react-native-svg";

import { useTheme } from "../../theme";

/**
 * The reusable gradient hero ground (`.log-v2-backdrop` / `.progress-top` /
 * `.report-v2-video-layer` chrome): heroStart → heroMid (54%) → heroEnd at 160°, an aqua
 * radial glow bleeding off the top-right, and the faint ring circle bottom-left. Content
 * (topbar, summary, chips) comes as children — the backdrop never knows what screen it is.
 */
/**
 * The aqua corner glow's diameter, and the only number to change to resize it — the offsets and
 * the circle derive from it, so it always bleeds off the top-right corner by the same
 * proportion. The mockup's 270 read as a small hotspot rather than a wash across the hero.
 */
const GLOW = 460;

export function HeroBackdrop({
  children,
  overscan = 0,
  style,
}: {
  children?: ReactNode;
  /**
   * How far above its box the ground should bleed, in px.
   *
   * A parallaxed backdrop sinks, uncovering its own top edge, and the fix has to be the GROUND
   * growing upward rather than the whole layer moving — the children must not shift. Negative
   * margin plus equal padding does exactly that: the painted box grows up by `overscan`, the
   * content stays where it was. It also gives the corner glow somewhere to bleed into, which
   * `overflow: hidden` was otherwise cropping flat against the top edge.
   */
  overscan?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  return (
    <LinearGradient
      colors={[t.heroStart, t.heroMid, t.heroEnd]}
      locations={[0, 0.54, 1]}
      // `start`/`end` are fractions of the box, clamped to 0..1 — the ramp cannot be stretched
      // past the hero from here. Its apparent size is the hero's size and GLOW below.
      start={{ x: 0.1, y: 0 }}
      end={{ x: 0.55, y: 1 }}
      style={[
        { flex: 1, overflow: "hidden", marginTop: -overscan, paddingTop: overscan },
        style,
      ]}
    >
      {/* ::before — the aqua glow off the top-right corner. */}
      <Svg
        width={GLOW}
        height={GLOW}
        // The mockup's -100/-90 against its 270, kept as fractions so the bleed stays put.
        style={{
          position: "absolute",
          right: -GLOW * 0.37,
          top: -GLOW * 0.333 + overscan,
        }}
        pointerEvents="none"
      >
        <Defs>
          <RadialGradient id="heroGlow" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={t.aqua} stopOpacity={0.25} />
            <Stop offset="0.66" stopColor={t.aqua} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={GLOW / 2} cy={GLOW / 2} r={GLOW / 2} fill="url(#heroGlow)" />
      </Svg>
      {/* ::after — the faint ring bottom-left (inset ring as a thick stroke). */}
      <Svg
        width={210}
        height={210}
        style={{ position: "absolute", left: -90, bottom: -120 }}
        pointerEvents="none"
      >
        <Circle
          cx={105}
          cy={105}
          r={93}
          stroke="rgba(255,255,255,0.025)"
          strokeWidth={24}
          fill="none"
        />
      </Svg>
      {children}
    </LinearGradient>
  );
}
