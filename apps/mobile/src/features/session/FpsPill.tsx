import { StyleSheet, Text, View } from "react-native";

import { FONT_DISPLAY } from "../../design/system/typography";
import { COLORS } from "../../theme";

/**
 * The capture rate, on the capture screen and through the whole take (Taylor, 2026-08-20).
 *
 * It shows the PROBED rate — what the camera reported it will record at — never the rate the
 * app asked for. That is the whole reason this pill is allowed to exist under the
 * no-instruments rule: §2.3 forbids degrading silently, so a phone that can only manage 120
 * has to say 120 where the golfer can see it before they hit a ball. A lens that cannot
 * record a take at all says so in words rather than showing a number that means nothing.
 */
export function FpsPill({
  fps,
  highSpeed,
  recording = false,
}: {
  /** The probed rate, or null before the camera has answered. */
  fps: number | null;
  /** False when the open lens publishes no high-speed configuration (the front camera). */
  highSpeed: boolean;
  /** Live take — the pill goes red with the rest of the recording treatment. */
  recording?: boolean;
}) {
  // Nothing probed yet: render nothing rather than a placeholder that could be mistaken for
  // a reading.
  if (fps === null && highSpeed) return null;

  return (
    <View style={[styles.pill, recording && styles.recording]} testID="fps-pill">
      {highSpeed && fps ? (
        <>
          <Text style={styles.value}>{fps}</Text>
          <Text style={styles.unit}>FPS</Text>
        </>
      ) : (
        <Text style={styles.unit}>PREVIEW ONLY</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 4,
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "rgba(11,16,28,0.66)",
  },
  // Matches the REC chip's red while a take runs, so the two read as one treatment.
  recording: { backgroundColor: "rgba(224,49,68,0.82)" },
  value: {
    color: "#FFFFFF",
    fontFamily: FONT_DISPLAY.black,
    fontSize: 13,
    letterSpacing: -0.2,
  },
  unit: {
    color: COLORS.muted,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 9,
    letterSpacing: 1,
  },
});
