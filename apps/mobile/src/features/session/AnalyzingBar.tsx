import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { FONT_BODY } from "../../design/system/typography";
import { COLORS } from "../../theme";
import { ANALYSIS_STAGES } from "./processing";

/**
 * The analyzing bar (§9.6): a staged progress track shown while a swing's analysis runs.
 *
 * **Stages, never a percentage.** The segment lit is the segment the JOB says it is on — an
 * upload, then the queue, then the analyzer's own stages. A queue nobody is draining reads
 * "Queued" for as long as that is true rather than creeping toward 90%, because a progress bar
 * that lies is one a golfer believes exactly once.
 *
 * Deliberately SMALL and off to one side (Taylor, step-03 iteration): it used to be a
 * full-width bar and it covered the player's transport, so the golfer could not scrub the swing
 * they had just hit while it analysed. Progress is secondary to the picture — it sits left of
 * the record button, above the session bar, and stays out of the way.
 */

export { ANALYSIS_STAGES };

export interface AnalyzingBarProps {
  /** The stage label, in a golfer's words — from the job row, never derived from a clock. */
  stage: string;
  /** Which segment is lit. Clamped here so an unexpected value cannot draw an empty track. */
  stageIndex: number;
}

export function AnalyzingBar({ stage, stageIndex }: AnalyzingBarProps) {
  const lit = Math.max(0, Math.min(ANALYSIS_STAGES.length - 1, stageIndex));

  return (
    <View style={styles.root} testID="analyzing-bar">
      <Text style={styles.label} numberOfLines={1}>
        {stage}
      </Text>
      <View style={styles.row}>
        {/* The spinner says "still working" between stage changes, which are up to a few seconds
            apart — the segmented track alone can sit still long enough to look stuck. */}
        <ActivityIndicator size="small" color={COLORS.aqua} style={styles.spinner} />
        <View style={styles.track}>
          {ANALYSIS_STAGES.map((name, i) => (
            <View key={name} style={[styles.segment, i <= lit && styles.segmentDone]} />
          ))}
        </View>
      </View>
      {/* Names WHAT is running, once, at the smallest size that still reads — the stage above
          says where it is up to, and this says what it is. */}
      <Text style={styles.kind}>AI Analysis</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    // Glass over footage, like the capture screen's controls — this floats on the picture.
    backgroundColor: "rgba(11,16,28,0.72)",
  },
  label: { color: COLORS.text, fontFamily: FONT_BODY.semiBold, fontSize: 10.5 },
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  // Scaled down from the platform's "small" so it belongs beside a 3pt track.
  spinner: { transform: [{ scale: 0.62 }], width: 14, height: 14 },
  track: { flex: 1, flexDirection: "row", gap: 3 },
  kind: {
    color: "rgba(255,255,255,0.45)",
    fontFamily: FONT_BODY.semiBold,
    fontSize: 6,
    letterSpacing: 0.9,
    textTransform: "uppercase",
  },
  segment: { flex: 1, height: 3, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.22)" },
  segmentDone: { backgroundColor: COLORS.aqua },
});
