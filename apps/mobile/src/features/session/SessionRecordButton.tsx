import { Pressable, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

import { FONT_DISPLAY } from "../../design/system/typography";
import { useAppTheme } from "../../theme";

/**
 * The session record control: the home bar's Record button in red.
 *
 * Same size and same position as the main menu's raised `+` (Taylor, 2026-08-18 — it used to be
 * deliberately larger, "the one control that must dominate the screen"; matching the shell won).
 * Every number here is `RecordButton`'s compact geometry, and `SessionNav`'s bump is `WaveNav`'s
 * — change one and the two bars stop reading as the same bar. `stop` latches it into the white
 * square.
 */

export interface SessionRecordButtonProps {
  stop: boolean;
  label: string;
  onPress: () => void;
  testID?: string;
}

const SIZE = 58; // RecordButton's `compact` size, verbatim.
/** The ring and the stop square, as fractions of the face — they scaled with the old 74. */
const RING = Math.round(SIZE * 0.7);
const STOP = Math.round(SIZE * 0.32);

export function SessionRecordButton({ stop, label, onPress, testID }: SessionRecordButtonProps) {
  // The bar under this control wears the app's light fill (see `SessionNav`), so the two
  // colours that used to read against a dark bar have to come from the theme: a white-on-white
  // label is invisible, and a white glass halo has nothing to sit on.
  const t = useAppTheme();
  return (
    <View style={styles.slot}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        testID={testID}
        style={({ pressed }) => [
          styles.halo,
          { backgroundColor: t.surface2 },
          pressed && styles.pressed,
        ]}
      >
        <LinearGradient
          colors={stop ? ["#3A4358", "#2B3345"] : ["#F0546A", "#E03144"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.face}
        >
          {stop ? <View style={styles.stopSquare} /> : <View style={styles.ring} />}
        </LinearGradient>
      </Pressable>
      <Text style={[styles.label, { color: t.muted }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  slot: { alignItems: "center", gap: 5 },
  halo: {
    width: SIZE + 12,
    height: SIZE + 12,
    borderRadius: (SIZE + 12) / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  face: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  // The ring and the square DRAW the control's shape (the sanctioned border use).
  ring: {
    width: RING,
    height: RING,
    borderRadius: RING / 2,
    borderWidth: 2.5,
    borderColor: "rgba(255,255,255,0.85)",
  },
  stopSquare: { width: STOP, height: STOP, borderRadius: 5, backgroundColor: "#FFFFFF" },
  label: {
    fontFamily: FONT_DISPLAY.black,
    fontSize: 8,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    textAlign: "center",
  },
  pressed: { opacity: 0.75 },
});
