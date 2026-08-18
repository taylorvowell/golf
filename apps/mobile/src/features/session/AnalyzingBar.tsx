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
      <ActivityIndicator size="small" color={COLORS.aqua} />
      <View style={styles.body}>
        <Text style={styles.label}>{`Analyzing — ${ANALYSIS_STAGES[stage]}`}</Text>
        <View style={styles.track}>
          {ANALYSIS_STAGES.map((name, i) => (
            <View key={name} style={[styles.segment, i <= stage && styles.segmentDone]} />
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: COLORS.panel,
  },
  body: { flex: 1, gap: 7 },
  label: { color: COLORS.text, fontFamily: FONT_BODY.semiBold, fontSize: 12.5 },
  track: { flexDirection: "row", gap: 4 },
  segment: { flex: 1, height: 4, borderRadius: 2, backgroundColor: COLORS.border },
  segmentDone: { backgroundColor: COLORS.aqua },
});
