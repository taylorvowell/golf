import { StyleSheet, Text, View } from "react-native";

import { COLORS } from "../../theme";
import { CoachLoader } from "./CoachLoader";
import { FONT_DISPLAY } from "./typography";

/**
 * A loader that owns the whole surface: the coach loader centred on the fixed dark ground, with
 * an optional line under it saying what is being waited on. Fixed dark like `CoachLoader`
 * itself — it fronts the video-facing flows (import, review), which are pinned dark.
 *
 * The label is a title, not a diagnostic: "Loading Swing Video", never a percentage or a step
 * count (the no-instruments rule).
 */
export function FullScreenLoader({ label }: { label?: string }) {
  return (
    <View style={styles.root} pointerEvents="none">
      <CoachLoader size={96} />
      {label ? <Text style={styles.label}>{label}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: 22,
    backgroundColor: COLORS.bg,
  },
  /** The same voice as the review screens' hint line — a title read at arm's length. */
  label: {
    color: COLORS.text,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 15,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    textAlign: "center",
    paddingHorizontal: 24,
  },
});
