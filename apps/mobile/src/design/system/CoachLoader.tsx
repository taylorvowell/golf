import { useEffect, useRef } from "react";
import { Animated, Easing, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Defs, LinearGradient as SvgGradient, Path, Stop } from "react-native-svg";

import { arcPath } from "./arc";
import { BrandIcon } from "./BrandIcon";

/**
 * The AI coach's loader (Taylor, 2026-08-19): the coach glyph centred with a shine sweeping
 * across it, orbited by a spinning gradient arc — a comet tail, deliberately swing-path-like:
 * bright aqua at the head fading through cobalt to nothing behind.
 *
 * Fixed dark on purpose: it loads the footage-facing surfaces (stance, deep analysis), which
 * are pinned dark, so the palette is the overlay world's — aqua/cobalt on near-black — not
 * theme tokens.
 *
 * Two independent loops, both native-driver: the ring rotates (2s/turn, linear — a hitch in a
 * spinner reads as a hang), and the shine strip sweeps the icon tile every ~2.6s with a rest
 * between passes so it reads as a glint, not a strobe.
 */
export function CoachLoader({ size = 128 }: { size?: number }) {
  const spin = useRef(new Animated.Value(0)).current;
  const shine = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const spinLoop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 2000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    const shineLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(shine, {
          toValue: 1,
          duration: 1100,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.delay(1500),
        Animated.timing(shine, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    spinLoop.start();
    shineLoop.start();
    return () => {
      spinLoop.stop();
      shineLoop.stop();
    };
  }, [shine, spin]);

  const stroke = Math.max(4, size * 0.045);
  const r = size / 2 - stroke / 2;
  const c = size / 2;
  const tile = size * 0.5;

  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      {/* The orbit: a 300° arc stroked with an aqua→cobalt→transparent ramp, spun as one.
          The gradient runs across the bounding box, which along a mostly-open arc reads as
          the comet's bright head trailing off — the swing-path look. */}
      <Animated.View
        style={{
          position: "absolute",
          width: size,
          height: size,
          transform: [
            {
              rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }),
            },
          ],
        }}
      >
        <Svg width={size} height={size}>
          <Defs>
            <SvgGradient id="coach-loader-tail" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor="#2DF0FB" stopOpacity="1" />
              <Stop offset="0.55" stopColor="#0D94DB" stopOpacity="0.8" />
              <Stop offset="1" stopColor="#0D94DB" stopOpacity="0" />
            </SvgGradient>
          </Defs>
          {/* A faint full track under the comet, so the orbit reads as a path, not a shard. */}
          <Path
            d={arcPath(c, c, r, 0, 360)}
            stroke="rgba(255,255,255,0.07)"
            strokeWidth={stroke}
            fill="none"
          />
          <Path
            d={arcPath(c, c, r, 0, 300)}
            stroke="url(#coach-loader-tail)"
            strokeWidth={stroke}
            strokeLinecap="round"
            fill="none"
          />
        </Svg>
      </Animated.View>

      {/* The coach, with the shine sweeping across its tile. */}
      <View
        style={{
          width: tile,
          height: tile,
          borderRadius: tile / 2,
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          backgroundColor: "rgba(255,255,255,0.06)",
        }}
      >
        <BrandIcon name="coach" size={tile * 0.56} color="#FFFFFF" />
        <Animated.View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: -tile * 0.25,
            width: tile * 0.55,
            height: tile * 1.5,
            transform: [
              {
                translateX: shine.interpolate({
                  inputRange: [0, 1],
                  outputRange: [-tile, tile],
                }),
              },
              { rotate: "22deg" },
            ],
          }}
        >
          <LinearGradient
            colors={["rgba(255,255,255,0)", "rgba(255,255,255,0.35)", "rgba(255,255,255,0)"]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={{ flex: 1 }}
          />
        </Animated.View>
      </View>
    </View>
  );
}
