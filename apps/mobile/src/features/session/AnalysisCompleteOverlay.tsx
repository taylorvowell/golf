import { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { CircleCheck } from "lucide-react-native";

import { FONT_DISPLAY } from "../../design/system/typography";
import { COLORS } from "../../theme";

/**
 * The "analysis complete" moment (§9.6): a brief, non-blocking flourish shown only when the
 * golfer is still on the swing whose analysis just finished — the report sheet slides up
 * right behind it. Fades itself in and out; the parent owns when it exists.
 */

export function AnalysisCompleteOverlay() {
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.timing(fade, { toValue: 1, duration: 240, useNativeDriver: true }),
      Animated.delay(900),
      Animated.timing(fade, { toValue: 0, duration: 320, useNativeDriver: true }),
    ]).start();
  }, [fade]);

  return (
    <View pointerEvents="none" style={styles.root} testID="analysis-complete">
      <Animated.View style={[styles.card, { opacity: fade }]}>
        <CircleCheck size={22} color={COLORS.aqua} strokeWidth={2.4} />
        <Text style={styles.text}>Analysis complete</Text>
      </Animated.View>
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
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 999,
    backgroundColor: "rgba(11,16,28,0.88)",
  },
  text: {
    color: "#FFFFFF",
    fontFamily: FONT_DISPLAY.extraBold,
    fontSize: 15,
    letterSpacing: 0.2,
  },
});
