import { useEffect, useState } from "react";
import { Animated, Easing, StyleSheet, View, useWindowDimensions } from "react-native";

import { useAppTheme } from "../../theme";

/**
 * A one-shot confetti burst falling from the top edge, played behind the celebration toast.
 *
 * Core `Animated` on the native driver — a two-second flourish does not justify reanimated's
 * APK weight (the dependency rule in `.claude/rules/react-native.md`). Each piece rides ONE
 * progress value; fall, sway, spin and fade are all interpolations of it, so the whole burst
 * is `PIECE_COUNT` native-driven nodes and zero JS work per frame.
 *
 * The component removes its own views when the last piece lands (`done` → null) — the parent
 * only decides when a burst STARTS (remount via `key`), never has to know when it ended.
 */

const PIECE_COUNT = 40;

interface Piece {
  x: number;
  fall: number;
  drift: number;
  size: number;
  color: string;
  delay: number;
  duration: number;
  spin: number;
  round: boolean;
}

function makePieces(colors: string[], width: number, height: number): Piece[] {
  return Array.from({ length: PIECE_COUNT }, (_, i) => ({
    x: Math.random() * width,
    fall: height * (0.45 + Math.random() * 0.4),
    drift: (Math.random() - 0.5) * 90,
    size: 6 + Math.random() * 6,
    color: colors[i % colors.length],
    delay: Math.random() * 400,
    duration: 1700 + Math.random() * 900,
    spin: (Math.random() < 0.5 ? -1 : 1) * (360 + Math.random() * 540),
    round: Math.random() < 0.3,
  }));
}

export function ConfettiBurst() {
  const t = useAppTheme();
  const { width, height } = useWindowDimensions();
  // Frozen at mount, deliberately: a dimension change mid-burst (fold, split-screen) must not
  // re-randomise pieces whose animations are already running — they'd visibly teleport. The
  // parent remounts this component per toast (key), which is where freshness comes from.
  const [{ pieces, progress }] = useState(() => {
    const made = makePieces([t.cobalt, t.aqua, t.lavender, t.good], width, height);
    return { pieces: made, progress: made.map(() => new Animated.Value(0)) };
  });
  const [done, setDone] = useState(false);

  useEffect(() => {
    const burst = Animated.parallel(
      pieces.map((p, i) =>
        Animated.timing(progress[i], {
          toValue: 1,
          duration: p.duration,
          delay: p.delay,
          // Accelerating fall — linear confetti reads as floating dust, not a drop.
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
      ),
    );
    burst.start(({ finished }) => {
      if (finished) setDone(true);
    });
    return () => burst.stop();
    // One-shot by design: pieces/progress are stable for this mount (remount = new burst).
  }, []);

  if (done) return null;

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.layer]}>
      {pieces.map((p, i) => (
        <Animated.View
          key={i}
          style={{
            position: "absolute",
            left: p.x,
            top: -24,
            width: p.size,
            height: p.round ? p.size : p.size * 1.7,
            borderRadius: p.round ? p.size : 2,
            backgroundColor: p.color,
            opacity: progress[i].interpolate({
              inputRange: [0, 0.7, 1],
              outputRange: [1, 1, 0],
            }),
            transform: [
              {
                translateY: progress[i].interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, p.fall],
                }),
              },
              {
                // A multi-stop zig-zag stands in for a sine sway — interpolate can't do trig.
                translateX: progress[i].interpolate({
                  inputRange: [0, 0.25, 0.5, 0.75, 1],
                  outputRange: [0, p.drift, -p.drift * 0.6, p.drift * 0.8, p.drift * 0.2],
                }),
              },
              {
                rotate: progress[i].interpolate({
                  inputRange: [0, 1],
                  outputRange: ["0deg", `${p.spin}deg`],
                }),
              },
            ],
          }}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  // Below the toast (9000), above everything else.
  layer: { zIndex: 8999 },
});
