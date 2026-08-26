import { Pressable, StyleSheet, Text, View } from "react-native";
import { TriangleAlert } from "lucide-react-native";

import { CONTROL_EDGE } from "../../design/system/controlEdge";
import { SwingLoader } from "../../design/system/SwingLoader";
import { FONT_DISPLAY } from "../../design/system/typography";
import { COLORS } from "../../theme";
import type { SessionSwing } from "./sessionState";

/**
 * What the swings behind this screen are doing, in one line — the replay-off path's only report.
 *
 * With **Video replay** on, a saved swing takes the golfer to the after-swing screen and the
 * analyzing bar tells the story there. With it OFF they stay on the camera to hit the next ball,
 * and without this they would have no way to know whether anything was happening at all. So this
 * is deliberately the SMALLEST honest report: what is happening, and whether anything went wrong.
 *
 * **It is not the analyzing bar.** No stage name, no percentage, no frame counter — a golfer
 * standing over the next ball cannot act on any of that, and the rule for this surface is that a
 * number earns its place by being actionable. "Analyzing" and "couldn't analyze" are the only two
 * things they would do something about, and the failure is the one that is tappable.
 *
 * Renders nothing when every swing is ready, which is the common case a few seconds in.
 */
export function CaptureStatusChip({
  swings,
  onOpen,
}: {
  swings: SessionSwing[];
  /** Open a swing — the failure's tap target. */
  onOpen: (swingId: string) => void;
}) {
  // Newest first, as the reducer keeps them, so "the failure" is the most recent one.
  const failed = swings.find((s) => s.status === "failed");
  const analyzing = swings.filter((s) => s.status === "analyzing");

  if (failed) {
    return (
      <Pressable
        testID="capture-status-failed"
        accessibilityRole="button"
        accessibilityLabel={`Swing ${failed.number} couldn't be analyzed. Open it.`}
        hitSlop={8}
        onPress={() => onOpen(failed.id)}
        style={({ pressed }) => [styles.chip, styles.chipBad, pressed && styles.pressed]}
      >
        <TriangleAlert size={13} color={COLORS.red} strokeWidth={2.4} />
        <Text style={[styles.text, { color: COLORS.red }]}>
          {`Swing ${failed.number} needs a look`}
        </Text>
      </Pressable>
    );
  }

  if (analyzing.length === 0) return null;

  // One swing is named; several are counted. Listing three numbers would be three facts where
  // the golfer only wanted one — that work is in hand.
  const label =
    analyzing.length === 1
      ? `Swing ${analyzing[0].number} analyzing`
      : `${analyzing.length} swings analyzing`;

  return (
    <View
      testID="capture-status-analyzing"
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      style={styles.chip}
    >
      <SwingLoader size={16} ground="dark" />
      <Text style={styles.text}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // The Upload pill's construction exactly — the capture chrome stays one decision.
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(11,16,28,0.28)",
    ...CONTROL_EDGE,
  },
  chipBad: { backgroundColor: "rgba(11,16,28,0.44)" },
  text: {
    color: "rgba(255,255,255,0.9)",
    fontFamily: FONT_DISPLAY.black,
    fontSize: 11,
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  pressed: { opacity: 0.7 },
});
