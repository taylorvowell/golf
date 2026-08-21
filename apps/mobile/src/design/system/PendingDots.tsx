import { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";

/**
 * Three dots that breathe in sequence — the system's "still waiting" mark.
 *
 * Sits in front of a waiting line so the state reads as *pending* rather than as a sentence
 * that happens to end in an ellipsis. Motion only: no percentage, no elapsed time, no attempt
 * count. A golfer acts on "is it still trying", and nothing finer than that.
 *
 * One looping value on the native driver, offset per dot — it must cost nothing behind a live
 * camera preview.
 */

const CYCLE_MS = 1200;

export interface PendingDotsProps {
  color: string;
  /** Dot diameter — the default sits on a label line. */
  size?: number;
}

export function PendingDots({ color, size = 5 }: PendingDotsProps) {
  const wave = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(wave, {
        toValue: 1,
        duration: CYCLE_MS,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    wave.setValue(0);
    loop.start();
    return () => loop.stop();
  }, [wave]);

  return (
    <View style={styles.row}>
      {[0, 1, 2].map((index) => {
        // Each dot runs the same ramp a third of a cycle behind the one before it. `modulo`
        // keeps the shifted clock monotonic across the wrap, which `interpolate` requires.
        const clock = Animated.modulo(Animated.add(wave, index / 3), 1);
        return (
          <Animated.View
            key={index}
            style={{
              width: size,
              height: size,
              borderRadius: size / 2,
              backgroundColor: color,
              opacity: clock.interpolate({
                inputRange: [0, 0.16, 0.34, 1],
                outputRange: [0.25, 1, 0.25, 0.25],
              }),
              transform: [
                {
                  scale: clock.interpolate({
                    inputRange: [0, 0.16, 0.34, 1],
                    outputRange: [0.8, 1.15, 0.8, 0.8],
                  }),
                },
              ],
            }}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 4 },
});
