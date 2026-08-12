import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { SwingPlayer } from "../features/player/SwingPlayer";
import { useSwing } from "../features/swings/useSwings";
import { useAppNavigation } from "../navigation";
import { COLORS } from "../theme";

/**
 * One swing: the picture, and the facts about it a panel away.
 *
 * **The screen has no header.** `SwingPlayer` owns the whole viewport — the picture centred in it,
 * the back control and the swing's name laid over the top, the transport over the bottom. A
 * navigation bar above the video would spend the most valuable strip of a tall screen on a title
 * that is already on the picture.
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

  /**
   * The picture's shape, from data the log already had.
   *
   * The primary view when there is one, else the first view that recorded a size — a view analysed
   * before those columns existed carries nulls, and guessing a shape for it would put the height
   * shift back. `SwingPlayer` falls through to portrait in that case, which is right far more often
   * than the 16:9 it used to assume.
   */
  const sized =
    swing.views.find((v) => v.id === swing.primaryViewId && v.width && v.height) ??
    swing.views.find((v) => v.width && v.height);
  const aspectRatio = sized?.width && sized?.height ? sized.width / sized.height : null;

  return (
    // No `view` — the route serves the primary angle, which is the one a single-view player wants.
    // Passing `primaryViewId` here is what made every swing answer 400: that is a uuid and the
    // parameter takes a view TYPE. Dual-view is step 04.
    <SwingPlayer
      swingId={swing.id}
      frameCount={swing.frameCount}
      fps={swing.fps}
      title={swing.label}
      subtitle={formatDate(swing.createdAt)}
      score={scored ? (swing.overallScore as number) : null}
      aspectRatio={aspectRatio}
      onBack={navigation.canGoBack() ? navigation.goBack : undefined}
    >
      <View testID="swing-detail" style={styles.panel}>
        {/* The chip over the picture carries the number; the band is the part that qualifies it,
            and a grade with no number beside it is not a fact anyone can act on. */}
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

function formatDate(epoch: number): string {
  // `createdAt` is an integer in the contract. Seconds and milliseconds are both plausible and
  // silently differ by 50 years, so it is normalized rather than assumed.
  const ms = epoch < 1e12 ? epoch * 1000 : epoch;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
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
  // No border and no fill: this now sits inside a `DeckSheet`, which is already a surface. A
  // panel drawn on a panel is the box-in-a-box the sheet exists to remove.
  panel: { paddingVertical: 2 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 11,
    gap: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  rowLabel: { color: COLORS.muted, fontSize: 13 },
  rowValue: { color: COLORS.text, fontSize: 14, fontWeight: "600", flexShrink: 1, textAlign: "right" },
  title: { color: COLORS.text, fontSize: 17, fontWeight: "600", textAlign: "center" },
  detail: { color: COLORS.muted, fontSize: 13, lineHeight: 19, textAlign: "center" },
});
