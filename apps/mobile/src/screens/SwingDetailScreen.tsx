import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";

import { useSwing } from "../features/swings/useSwings";
import { COLORS } from "../theme";

/**
 * One swing, before the player exists.
 *
 * This screen is deliberately the end of step 01 rather than the start of the player. Navigation
 * and playback are separate risks and proving them together is how a routing bug gets diagnosed as
 * a video bug — the same reasoning behind this project's Gate 1 / Gate 2 split between pose and
 * frame sync.
 *
 * What it must not do is look broken. "Playback arrives with the player release" is a true
 * sentence a golfer can act on; a blank screen is not.
 */

export interface SwingDetailScreenProps {
  id: string;
}

export function SwingDetailScreen({ id }: SwingDetailScreenProps) {
  const { state, swing } = useSwing(id);

  if (state.kind === "loading") {
    return (
      <View style={styles.centre}>
        <ActivityIndicator color={COLORS.muted} />
      </View>
    );
  }

  if (!swing) {
    return (
      <View style={styles.centre}>
        <Text style={styles.title}>Swing not found</Text>
        <Text style={styles.detail}>
          {state.kind === "ok"
            ? "It may have been deleted from another device."
            : "This device could not reach SwingSage, so it cannot tell you about this swing."}
        </Text>
      </View>
    );
  }

  const scored = typeof swing.overallScore === "number";

  return (
    <ScrollView contentContainerStyle={styles.content} testID="swing-detail">
      <Text style={styles.heading}>{swing.label}</Text>

      <View style={styles.panel}>
        <Row
          label="Score"
          value={scored ? `${Math.round(swing.overallScore as number)}${swing.band ? ` · ${swing.band}` : ""}` : "Not scored"}
        />
        <Row label="Angles" value={swing.views.map(viewName).join(", ") || "—"} />
        <Row label="Frames" value={`${swing.frameCount} at ${swing.fps} fps`} />
        {/* Coverage is a confidence signal, not decoration: a swing the pose model barely tracked
            must say so here rather than present its score as equally trustworthy. */}
        <Row label="Pose coverage" value={`${Math.round(swing.poseCoverage * 100)}%`} />
        <Row label="Club trace" value={swing.traceEnabled ? "Available" : "Not available"} />
        {swing.tempoRatio ? <Row label="Tempo" value={`${swing.tempoRatio.toFixed(1)} : 1`} /> : null}
      </View>

      <Text style={styles.detail}>
        Playback, overlays and the full scorecard arrive with the player release. This swing is
        analysed and safe.
      </Text>
    </ScrollView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

function viewName(v: { view: string }): string {
  return v.view === "face_on" ? "Face-on" : "Down the line";
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 16 },
  centre: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 24 },
  heading: { color: COLORS.text, fontSize: 22, fontWeight: "700" },
  panel: {
    backgroundColor: COLORS.panel,
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    gap: 16,
  },
  rowLabel: { color: COLORS.muted, fontSize: 13 },
  rowValue: { color: COLORS.text, fontSize: 14, fontWeight: "600", flexShrink: 1, textAlign: "right" },
  title: { color: COLORS.text, fontSize: 17, fontWeight: "600", textAlign: "center" },
  detail: { color: COLORS.muted, fontSize: 13, lineHeight: 19, textAlign: "center" },
});
