import { Text, View, type StyleProp, type ViewStyle } from "react-native";
import type { ReactNode } from "react";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Circle, Defs, RadialGradient, Stop } from "react-native-svg";

import { useTheme } from "../../theme";
import { FONT_BODY, FONT_DISPLAY } from "./typography";

/**
 * `.performance-card` (mockup §07): the hero gradient card — heroStart→heroMid(58%)→heroEnd,
 * radius 13, shadowLg, an aqua radial glow bleeding off the top-right corner (SVG — RN has
 * no CSS radial-gradient), white text throughout. The single dominant card per screen.
 */
export function PerformanceCard({
  eyebrow,
  title,
  body,
  actions,
  children,
  style,
}: {
  eyebrow?: string;
  title?: string;
  body?: string;
  /** The `.performance-actions` row — buttons laid out by the caller. */
  actions?: ReactNode;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  return (
    <View style={[{ borderRadius: 13, overflow: "hidden" }, t.shadowLg, style]}>
      <LinearGradient
        colors={[t.heroStart, t.heroMid, t.heroEnd]}
        locations={[0, 0.58, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ padding: 20, minHeight: 160 }}
      >
        {/* ::before — the aqua glow off the top-right corner. */}
        <Svg
          width={200}
          height={200}
          style={{ position: "absolute", right: -45, top: -50 }}
          pointerEvents="none"
        >
          <Defs>
            <RadialGradient id="glow" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor={t.aqua} stopOpacity={0.23} />
              <Stop offset="0.65" stopColor={t.aqua} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx={100} cy={100} r={100} fill="url(#glow)" />
        </Svg>
        {eyebrow != null && (
          <Text
            style={{
              color: "rgba(180,235,238,1)",
              fontFamily: FONT_DISPLAY.black,
              fontSize: 9,
              letterSpacing: 1.26,
              textTransform: "uppercase",
            }}
          >
            {eyebrow}
          </Text>
        )}
        {title != null && (
          <Text
            style={{
              marginTop: 12,
              maxWidth: 430,
              color: t.onDark,
              fontFamily: FONT_DISPLAY.black,
              fontSize: 32,
              lineHeight: 32,
              letterSpacing: -0.64,
            }}
          >
            {title}
          </Text>
        )}
        {body != null && (
          <Text
            style={{
              marginTop: 14,
              maxWidth: 450,
              color: "rgba(255,255,255,0.65)",
              fontFamily: FONT_BODY.regular,
              fontSize: 12,
              lineHeight: 19,
            }}
          >
            {body}
          </Text>
        )}
        {children}
        {actions != null && (
          <View
            style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 25 }}
          >
            {actions}
          </View>
        )}
      </LinearGradient>
    </View>
  );
}
