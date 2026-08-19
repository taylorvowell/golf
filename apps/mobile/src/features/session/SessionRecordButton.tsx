import { Pressable, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

import { FONT_DISPLAY } from "../../design/system/typography";

/**
 * The session record control: a red circle bigger than the main menu's Record button
 * (Taylor — this is the one control that must dominate the screen), with the same glass
 * halo language so the two read as siblings. `stop` latches it into the white square.
 */

export interface SessionRecordButtonProps {
  stop: boolean;
  label: string;
  onPress: () => void;
  testID?: string;
}

const SIZE = 74;

export function SessionRecordButton({ stop, label, onPress, testID }: SessionRecordButtonProps) {
  return (
    <View style={styles.slot}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        testID={testID}
        style={({ pressed }) => [styles.halo, pressed && styles.pressed]}
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
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  slot: { alignItems: "center", gap: 5 },
  halo: {
    width: SIZE + 8,
    height: SIZE + 8,
    borderRadius: (SIZE + 8) / 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.10)",
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
    width: SIZE - 22,
    height: SIZE - 22,
    borderRadius: (SIZE - 22) / 2,
    borderWidth: 2.5,
    borderColor: "rgba(255,255,255,0.85)",
  },
  stopSquare: { width: 24, height: 24, borderRadius: 5, backgroundColor: "#FFFFFF" },
  label: {
    color: "rgba(255,255,255,0.9)",
    fontFamily: FONT_DISPLAY.black,
    fontSize: 8,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    textAlign: "center",
  },
  pressed: { opacity: 0.75 },
});
