import { StyleSheet, View } from "react-native";
import Svg, { Circle, Defs, RadialGradient, Stop } from "react-native-svg";

/**
 * The hero cards' corner glows, detached from the hero (Taylor, 2026-08-19): very subtle
 * radial washes — aqua off the top-right, cobalt off the bottom-left — over whatever ground
 * the host paints. Used by the analysis loading screens so their dark ground carries the same
 * light as the Swing Log / Progress heroes, at about half the strength (a loading screen is a
 * waiting room, not a headline).
 *
 * Fixed colours on purpose: it dresses the pinned-dark footage surfaces, never a themed page.
 */
const GLOW = 460;

export function GlowBackdrop() {
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: "hidden" }]}>
      <Svg
        width={GLOW}
        height={GLOW}
        style={{ position: "absolute", right: -GLOW * 0.37, top: -GLOW * 0.3 }}
      >
        <Defs>
          <RadialGradient id="glow-aqua" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor="#42CBCE" stopOpacity={0.13} />
            <Stop offset="0.66" stopColor="#42CBCE" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={GLOW / 2} cy={GLOW / 2} r={GLOW / 2} fill="url(#glow-aqua)" />
      </Svg>
      <Svg
        width={GLOW}
        height={GLOW}
        style={{ position: "absolute", left: -GLOW * 0.4, bottom: -GLOW * 0.35 }}
      >
        <Defs>
          <RadialGradient id="glow-cobalt" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor="#2F46CF" stopOpacity={0.16} />
            <Stop offset="0.7" stopColor="#2F46CF" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={GLOW / 2} cy={GLOW / 2} r={GLOW / 2} fill="url(#glow-cobalt)" />
      </Svg>
    </View>
  );
}
