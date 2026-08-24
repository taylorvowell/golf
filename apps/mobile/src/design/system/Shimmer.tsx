import { useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

import { useTheme } from "../../theme";

/**
 * A light sweeping across a surface — the system's "this is being worked on" mark.
 *
 * It is the alternative to painting a busy row in a loud fill: the card keeps the list's own
 * surface and its ordinary ink, so it still reads as the swing it is about to become, and the
 * MOTION is what says the pipeline is running. A colour can only say "different"; a sweep says
 * "in progress", which is the actual claim.
 *
 * The band is a fraction of the measured width and rides the native driver as a transform — the
 * one property that can, since a width or a `left` would be rejected outright beside it
 * (`.claude/rules/react-native.md`). Nothing animates until the layout pass reports a width, so
 * the first sweep starts where it is meant to rather than snapping in from zero.
 */

const SWEEP_MS = 1600;
/** The gap between sweeps: the band spends this share of the cycle off the right-hand edge. */
const REST = 0.35;

export interface ShimmerProps {
  /** Matches the parent's radius so the sweep is clipped to the card's shape. */
  radius?: number;
  /** Override the highlight — defaults to the theme's own (near-white on light, a lift on dark). */
  color?: string;
}

export function Shimmer({ radius = 10, color }: ShimmerProps) {
  const t = useTheme();
  const [width, setWidth] = useState(0);
  const travel = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (width === 0) return;
    const loop = Animated.loop(
      Animated.timing(travel, {
        toValue: 1,
        duration: Math.round(SWEEP_MS / (1 - REST)),
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    travel.setValue(0);
    loop.start();
    return () => loop.stop();
  }, [travel, width]);

  const band = Math.max(48, width * 0.45);
  const highlight = color ?? (t.mode === "dark" ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.85)");

  return (
    <View
      pointerEvents="none"
      onLayout={(e) => {
        const w = Math.round(e.nativeEvent.layout.width);
        setWidth((prev) => (prev === w ? prev : w));
      }}
      style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: "hidden" }]}
    >
      {width > 0 ? (
        <Animated.View
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            width: band,
            transform: [
              {
                translateX: travel.interpolate({
                  inputRange: [0, 1],
                  // Off the left edge, across, and off the right — then it waits out `REST`
                  // beyond the edge, which is what makes this a pulse rather than a conveyor.
                  outputRange: [-band, width + band * (REST / (1 - REST)) * 2],
                }),
              },
            ],
          }}
        >
          <LinearGradient
            colors={["transparent", highlight, "transparent"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      ) : null}
    </View>
  );
}
