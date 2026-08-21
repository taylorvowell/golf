import { useEffect, useRef, useState } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";

import { FONT_DISPLAY } from "../../design/system/typography";
import { playCountdownTick } from "./useRecordSounds";

/**
 * The delayed-start countdown (§9.5): a number big enough to read from the ball, several
 * steps from a phone on a stand. Ticks once per second from `seconds`, calls `onDone` when
 * it crosses zero. The component owns its own interval — nothing above it re-renders per
 * tick — and cleans it up on unmount, so an aborted countdown (stop pressed, screen left)
 * never fires a stale `onDone`.
 */

export interface CountdownOverlayProps {
  seconds: number;
  onDone: () => void;
}

export function CountdownOverlay({ seconds, onDone }: CountdownOverlayProps) {
  const [remaining, setRemaining] = useState(seconds);
  const pulse = useRef(new Animated.Value(0)).current;
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    setRemaining(seconds);
    const started = Date.now();
    const tick = setInterval(() => {
      const left = seconds - Math.floor((Date.now() - started) / 1000);
      if (left <= 0) {
        clearInterval(tick);
        onDoneRef.current();
        return;
      }
      setRemaining(left);
    }, 250);
    return () => clearInterval(tick);
  }, [seconds]);

  // A soft scale-in on every number change — legibility first, spectacle nowhere.
  useEffect(() => {
    pulse.setValue(0);
    Animated.timing(pulse, { toValue: 1, duration: 220, useNativeDriver: true }).start();
  }, [pulse, remaining]);

  // The final 3-2-1 gets a quiet tick (then the record cue lands from the mode change), so
  // the golfer at the ball can time the start without watching the screen. Longer delays are
  // silent until 3 — the tick means "now", not "still waiting". The number shown AT MOUNT is
  // skipped: the click-acknowledgment tone already sounded for that instant, and two tones at
  // once read as a glitch. Deduped per number so the seconds-reset effect can't double-fire.
  const ticked = useRef<number | null>(null);
  useEffect(() => {
    if (remaining === seconds) return;
    if (remaining <= 3 && remaining >= 1 && ticked.current !== remaining) {
      ticked.current = remaining;
      playCountdownTick();
    }
  }, [remaining, seconds]);

  return (
    <View pointerEvents="none" style={styles.root} testID="countdown-overlay">
      <Animated.Text
        style={[
          styles.number,
          {
            opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }),
            transform: [
              { scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1.18, 1] }) },
            ],
          },
        ]}
      >
        {remaining}
      </Animated.Text>
      <Text style={styles.hint}>Get set…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  number: {
    color: "#FFFFFF",
    fontFamily: FONT_DISPLAY.black,
    fontSize: 148,
    lineHeight: 158,
    letterSpacing: -4,
  },
  hint: {
    color: "rgba(255,255,255,0.72)",
    fontFamily: FONT_DISPLAY.extraBold,
    fontSize: 16,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginTop: -6,
  },
});
