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
export function HeroBackdrop({
  children,
  style,
}: {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  return (
    <LinearGradient
      colors={[t.heroStart, t.heroMid, t.heroEnd]}
      locations={[0, 0.54, 1]}
      start={{ x: 0.1, y: 0 }}
      end={{ x: 0.55, y: 1 }}
      style={[{ flex: 1, overflow: "hidden" }, style]}
    >
      {/* ::before — the aqua glow off the top-right corner. */}
      <Svg
        width={270}
        height={270}
        style={{ position: "absolute", right: -100, top: -90 }}
        pointerEvents="none"
      >
        <Defs>
          <RadialGradient id="heroGlow" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={t.aqua} stopOpacity={0.25} />
            <Stop offset="0.66" stopColor={t.aqua} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={135} cy={135} r={135} fill="url(#heroGlow)" />
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
