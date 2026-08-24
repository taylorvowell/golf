import { Pressable, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Plus, X } from "lucide-react-native";

import { FONT_DISPLAY } from "../../design/system/typography";
import { PRESS_SUNK_HARD } from "../../design/system/press";
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
 *
 * **No drawn label** (Taylor, 2026-08-23). The shell's `+` carries none, and a caption under this
 * one sat the red circle ~15px lower than the plus it is meant to BE — two bars that swap under
 * the same thumb, with the one control that must never move landing in two places. `label` is
 * still the screen-reader name; it just is not painted.
 */

export interface SessionRecordButtonProps {
  stop: boolean;
  /**
   * The countdown is running — the button ABORTS a take that has not started rather than
   * stopping one that has (Taylor, 2026-08-23).
   *
   * Those are different actions and used to wear the same white square, so the golfer could not
   * tell from the ball whether the camera was already rolling. An X in a ring says "this never
   * happened", and it is the only state that carries a drawn caption: the glyph alone is not a
   * word, and the caption sits absolutely below the face so the circle itself does not move.
   */
  cancel?: boolean;
  /** Draws a `+` inside the ring — the "record another swing" reading. */
  plus?: boolean;
  /** Announced, never drawn — see the note above. */
  label: string;
  onPress: () => void;
  testID?: string;
}

const SIZE = 58; // RecordButton's `compact` size, verbatim.
/** The `+` ring and the stop square, as fractions of the face — they scaled with the old 74. */
const RING = Math.round(SIZE * 0.7);
const STOP = Math.round(SIZE * 0.32);
// Press darkens the face rather than fading it — a translucent record control shows the bar
// through itself and reads as disabled, not held (Taylor, 2026-08-19).
const REC_FACE = ["#F0546A", "#E03144"] as const;
const REC_FACE_PRESSED = ["#CE4159", "#B72636"] as const;
/**
 * The "record another" face is BLUE, not red (Taylor, 2026-08-21).
 *
 * Red is the app's word for "filming, right now". This button does not start a recording —
 * it walks back to the capture screen — so wearing red made it the loudest thing on a screen
 * where nothing was being recorded, and taught the golfer that red sometimes means "go to
 * the place where you record". Cobalt keeps it the primary action without the promise.
 */
const NEW_FACE = ["#1FA9EF", "#1FA9EF"] as const;
const NEW_FACE_PRESSED = ["#0D94DB", "#0D94DB"] as const;
const STOP_FACE = ["#31414F", "#22303D"] as const;
const STOP_FACE_PRESSED = ["#243340", "#1A2530"] as const;

export function SessionRecordButton({
  stop,
  cancel = false,
  plus = false,
  label,
  onPress,
  testID,
}: SessionRecordButtonProps) {
  // The bar under this control wears the app's light fill (see `SessionNav`), so the halo
  // colour comes from the theme — white glass has nothing to sit on there.
  const t = useAppTheme();
  return (
    <View>
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
                : plus
                  ? pressed
                    ? NEW_FACE_PRESSED
                    : NEW_FACE
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
            {cancel ? (
              <View style={styles.ring}>
                <X size={RING - 16} color="rgba(255,255,255,0.9)" strokeWidth={3} />
              </View>
            ) : stop ? (
              <View style={[styles.stopSquare, pressed && styles.stopSquarePressed]} />
            ) : plus ? (
              <View style={styles.ring}>
                <Plus size={RING - 14} color="rgba(255,255,255,0.9)" strokeWidth={2.8} />
              </View>
            ) : (
              /* The face says what the button does, in words (Taylor, 2026-08-23) — the outer
                 caption is gone and the ring went with it. The dot is the record light every
                 camera has ever put beside that word. */
              <View style={styles.recRow}>
                <View style={styles.recDot} />
                <Text style={styles.rec}>REC</Text>
              </View>
            )}
          </LinearGradient>
        )}
      </Pressable>
      {/* Absolutely positioned, so adding it costs the face no height — a caption in the flow
          pushed the circle off the line the shell's `+` sits on (see the note above). */}
      {cancel ? (
        <View style={styles.caption} pointerEvents="none">
          <Text style={styles.captionText}>Cancel</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
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
  // The ring and the square DRAW the control's shape (the sanctioned border use). The ring
  // is the `plus` face only — the red face wears the REC dot instead.
  ring: {
    width: RING,
    height: RING,
    borderRadius: RING / 2,
    borderWidth: 2.5,
    borderColor: "rgba(255,255,255,0.85)",
    alignItems: "center",
    justifyContent: "center",
  },
  caption: { position: "absolute", top: "100%", left: 0, right: 0, alignItems: "center" },
  captionText: {
    color: "#FFFFFF",
    fontFamily: FONT_DISPLAY.black,
    fontSize: 9,
    lineHeight: 12,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  recRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  recDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#FFFFFF" },
  rec: {
    color: "#FFFFFF",
    fontFamily: FONT_DISPLAY.black,
    fontSize: 13,
    letterSpacing: 0.4,
  },
  /** The louder of the two shared outdoor presses — this is the control that must not be
   * missed from arm's length. */
  facePressed: PRESS_SUNK_HARD,
  stopSquare: { width: STOP, height: STOP, borderRadius: 5, backgroundColor: "#FFFFFF" },
  /** The square shrinks further and rounds off, so the glyph moves too — motion at the centre
   * of the control is what the eye actually catches. */
  stopSquarePressed: { transform: [{ scale: 0.78 }], borderRadius: 8 },
});
