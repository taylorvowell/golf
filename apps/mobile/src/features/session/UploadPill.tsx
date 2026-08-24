import { Pressable, StyleSheet, Text } from "react-native";
import { Upload } from "lucide-react-native";

import { CONTROL_EDGE } from "../../design/system/controlEdge";
import { FONT_DISPLAY } from "../../design/system/typography";

/**
 * The upload door on the capture screen (Taylor, 2026-08-23) — the swing log's Upload action,
 * where a golfer already holding a clip actually is.
 *
 * Past the picker an uploaded clip takes the exact path a recorded swing takes, so this is a
 * second door, never a second kind of swing (importSwing.ts).
 *
 * Outlined rather than filled (Taylor, 2026-08-23): it is the secondary action on a surface whose
 * subject is the record button, and the barely-there glass keeps the framing behind it readable —
 * the same treatment the zoom rail wears, so the capture chrome stays one decision.
 */
export function UploadPill({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      testID="session-upload"
      accessibilityRole="button"
      accessibilityLabel="Upload a swing from your videos"
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
    >
      {/* The swing log hero action's glyph metrics, so Upload is one object wherever it
          appears (Taylor, 2026-08-23). */}
      <Upload size={14} color="rgba(255,255,255,0.9)" strokeWidth={2.4} />
      <Text style={styles.text}>Upload</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(11,16,28,0.28)",
    ...CONTROL_EDGE,
  },
  text: {
    color: "rgba(255,255,255,0.9)",
    fontFamily: FONT_DISPLAY.black,
    fontSize: 11,
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  // Over the camera picture the press is opacity, not a fill step — there is no ramp behind it.
  pressed: { opacity: 0.7 },
});
