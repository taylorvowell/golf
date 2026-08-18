import { useEffect, useRef, useState } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

import { FONT_DISPLAY } from "../../design/system/typography";
import { COLORS } from "../../theme";

/**
 * The "you are recording" treatment (D61: "stylized… unmistakable at a glance"): a red
 * frame outline breathing slowly, a red wash bleeding in from the top and bottom edges, and
 * a REC chip with elapsed time. All of it `pointerEvents: none` and none of it near the
 * golfer — the centre of the frame stays clean because that is where the swing is.
 *
 * The outline is a border that DRAWS the shape (the sanctioned border use, like the scrub
 * thumb's ring) — it is the recording indicator itself, not surface decoration.
 */

export function RecordingFrame() {
  const breathe = useRef(new Animated.Value(0)).current;
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(breathe, { toValue: 0, duration: 900, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [breathe]);

  useEffect(() => {
    const started = Date.now();
    const tick = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 500);
    return () => clearInterval(tick);
  }, []);

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} testID="recording-frame">
      <LinearGradient
        colors={["rgba(224,49,68,0.28)", "rgba(224,49,68,0)"]}
        style={styles.washTop}
      />
      <LinearGradient
        colors={["rgba(224,49,68,0)", "rgba(224,49,68,0.22)"]}
        style={styles.washBottom}
      />
      <Animated.View
        style={[
          styles.outline,
          { opacity: breathe.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }) },
        ]}
      />
      <View style={styles.chip}>
        <Animated.View
          style={[
            styles.dot,
            { opacity: breathe.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }) },
          ]}
        />
        <Text style={styles.chipText}>{`REC ${mm}:${ss}`}</Text>
      </View>
    </View>
  );
}

const RED = COLORS.red;

const styles = StyleSheet.create({
  outline: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    margin: 8,
    borderRadius: 20,
    borderWidth: 3,
    borderColor: RED,
  },
  washTop: { position: "absolute", top: 0, left: 0, right: 0, height: 110 },
  washBottom: { position: "absolute", bottom: 0, left: 0, right: 0, height: 90 },
  chip: {
    position: "absolute",
    top: 22,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(11,16,28,0.66)",
  },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: RED },
  chipText: {
    color: "#FFFFFF",
    fontFamily: FONT_DISPLAY.black,
    fontSize: 11,
    letterSpacing: 1.1,
  },
});
