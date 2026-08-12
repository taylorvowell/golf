import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { SwingPlayer } from "../features/player/SwingPlayer";
import { useSwing } from "../features/swings/useSwings";
import { useAppNavigation } from "../navigation";
import { COLORS } from "../theme";

/**
 * One swing: the picture, then the facts about it.
 *
 * **The screen has no header.** `SwingPlayer` owns the whole viewport — full-width picture at the
 * top with the back control and the swing's name laid over it, the facts scrolling beneath, and
 * the transport pinned to the bottom of the window. A navigation bar above the video would spend
 * the most valuable strip of a tall screen on a title that is already on the picture.
 *
 * The metadata is not filler. Pose coverage and trace availability are confidence signals, and a
 * swing the model barely tracked has to say so next to its own score rather than present it as
 * equally trustworthy.
 */

export interface SwingDetailScreenProps {
  id: string;
}

export function SwingDetailScreen({ id }: SwingDetailScreenProps) {
  const { state, swing } = useSwing(id);
  const navigation = useAppNavigation();

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
    // No `view` — the route serves the primary angle, which is the one a single-view player wants.
    // Passing `primaryViewId` here is what made every swing answer 400: that is a uuid and the
    // parameter takes a view TYPE. Dual-view is step 04.
    <SwingPlayer
      swingId={swing.id}
      frameCount={swing.frameCount}
      fps={swing.fps}
      title={swing.label}
      onBack={navigation.canGoBack() ? navigation.goBack : undefined}
    >
      <View testID="swing-detail" style={styles.panel}>
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
    </SwingPlayer>
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
  centre: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 24 },
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
