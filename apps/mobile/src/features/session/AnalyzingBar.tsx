import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { FONT_BODY } from "../../design/system/typography";
import { COLORS } from "../../theme";

/**
 * The analyzing bar (§9.6): a spinner and a staged progress track shown while a swing's
 * analysis runs. Stages, never a fake percentage — in the stub the stage advances on a
 * timer; the wiring drives it from real job states and the component does not change.
 *
 * Owns its own ticking: nothing above it re-renders per tick.
 *
 * Deliberately SMALL and off to one side (Taylor, step-03 iteration): it used to be a
 * full-width bar and it covered the player's transport, so the golfer could not scrub the swing
 * they had just hit while it analysed. Progress is secondary to the picture — it sits left of
 * the record button, above the session bar, and stays out of the way. No spinner: the segmented
 * track already moves, and two moving things in a pill this size is noise.
 */

export const ANALYSIS_STAGES = [
  "Uploading",
  "Queued",
  "Analyzing pose",
  "Tracking club",
  "Scoring",
] as const;

/** Stub pacing — the whole progression runs ~12s (also the driver's ready timer). */
export const STUB_ANALYSIS_MS = 12_000;

export interface AnalyzingBarProps {
  /** When the swing was recorded — the stub derives its stage from elapsed time. */
  recordedAt: number;
}

export function AnalyzingBar({ recordedAt }: AnalyzingBarProps) {
  const [stage, setStage] = useState(0);

  useEffect(() => {
    const tick = setInterval(() => {
      const elapsed = Date.now() - recordedAt;
      const next = Math.min(
        ANALYSIS_STAGES.length - 1,
        Math.floor((elapsed / STUB_ANALYSIS_MS) * ANALYSIS_STAGES.length),
      );
      setStage(next);
    }, 400);
    return () => clearInterval(tick);
  }, [recordedAt]);

  return (
    <View style={styles.root} testID="analyzing-bar">
      <Text style={styles.label} numberOfLines={1}>
        {ANALYSIS_STAGES[stage]}
      </Text>
      <View style={styles.row}>
        {/* The spinner says "still working" between stage changes, which are up to a few seconds
            apart — the segmented track alone can sit still long enough to look stuck. */}
        <ActivityIndicator size="small" color={COLORS.aqua} style={styles.spinner} />
        <View style={styles.track}>
          {ANALYSIS_STAGES.map((name, i) => (
            <View key={name} style={[styles.segment, i <= stage && styles.segmentDone]} />
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
