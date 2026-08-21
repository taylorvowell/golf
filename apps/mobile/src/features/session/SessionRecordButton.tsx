import { Pressable, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Plus } from "lucide-react-native";

import { FONT_DISPLAY } from "../../design/system/typography";
import { useAppTheme } from "../../theme";

/**
 * The session record control: the home bar's Record button in red.
 *
 * Same size and same position as the main menu's raised `+` (Taylor, 2026-08-18 — it used to be
 * deliberately larger, "the one control that must dominate the screen"; matching the shell won).
 * Every number here is `RecordButton`'s compact geometry, and `SessionNav`'s bump is `WaveNav`'s
 * — change one and the two bars stop reading as the same bar. `stop` latches it into the white
 * square. `plus` marks the after-swing dock's copy, where the control starts the NEXT swing —
 * a bare ring there says "recording", and a plus says "another one" (Taylor).
 */

export interface SessionRecordButtonProps {
  stop: boolean;
  /** Draws a `+` inside the ring — the "record another swing" reading. */
  plus?: boolean;
  label: string;
  onPress: () => void;
  testID?: string;
}

const SIZE = 58; // RecordButton's `compact` size, verbatim.
/** The ring and the stop square, as fractions of the face — they scaled with the old 74. */
const RING = Math.round(SIZE * 0.7);
const STOP = Math.round(SIZE * 0.32);
// Press darkens the face rather than fading it — a translucent record control shows the bar
// through itself and reads as disabled, not held (Taylor, 2026-08-19).
const REC_FACE = ["#F0546A", "#E03144"] as const;
const REC_FACE_PRESSED = ["#CE4159", "#B72636"] as const;
const STOP_FACE = ["#3A4358", "#2B3345"] as const;
const STOP_FACE_PRESSED = ["#2D3546", "#1F2532"] as const;

export function SessionRecordButton({
  stop,
  plus = false,
  label,
  onPress,
  testID,
}: SessionRecordButtonProps) {
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
        style={[styles.halo, { backgroundColor: t.surface2 }]}
      >
        {({ pressed }) => (
          <LinearGradient
            colors={
              stop
                ? pressed
                  ? STOP_FACE_PRESSED
                  : STOP_FACE
                : pressed
                  ? REC_FACE_PRESSED
                  : REC_FACE
            }
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            // Pressed presses IN, visibly (Taylor, 2026-08-21): the golfer taps Stop from
            // arm's length, often without hearing the cue, and a face that only darkens a
            // shade leaves them unsure whether the tap landed — so they tap again.
            style={[styles.face, pressed && styles.facePressed]}
          >
            {stop ? (
              <View style={[styles.stopSquare, pressed && styles.stopSquarePressed]} />
            ) : (
              <View style={styles.ring}>
                {plus ? <Plus size={RING - 14} color="rgba(255,255,255,0.9)" strokeWidth={2.8} /> : null}
              </View>
            )}
          </LinearGradient>
        )}
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
    alignItems: "center",
    justifyContent: "center",
  },
  /** A real, felt press: the face shrinks by a tenth. Scale, not opacity — a control over
   * footage that fades reads as disabled rather than held. */
  facePressed: { transform: [{ scale: 0.9 }] },
  stopSquare: { width: STOP, height: STOP, borderRadius: 5, backgroundColor: "#FFFFFF" },
  /** The square shrinks further and rounds off, so the glyph moves too — motion at the centre
   * of the control is what the eye actually catches. */
  stopSquarePressed: { transform: [{ scale: 0.78 }], borderRadius: 8 },
  label: {
    fontFamily: FONT_DISPLAY.black,
    fontSize: 8,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    textAlign: "center",
  },
});
