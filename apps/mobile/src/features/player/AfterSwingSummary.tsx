import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { Analysis, CheckpointScore, Finding, Priority } from "@swingsage/schema/contract";

import { ArcGauge, RingGauge, TrendLine } from "../../design/gauges";
import { COLORS } from "../../theme";
import { checkpointA11yLabel, checkpointTarget } from "./checkpointFrames";
import { categoryLabel } from "./scoreDisplay";
import type { ReportState } from "./useReport";

/**
 * The after-swing scorecard, in the product's designed skin — the mobile rendering of
 * `.claude/SAMPLE-afterswing.html`, which is the one screen with a finished visual design and is
 * followed closely on purpose: headline, gauge with the violet→cyan ramp and a marker at the
 * score, band chip, trend over the recent swings, coach takeaway, finding boxes in two tones, and
 * the indicator rail of score rings.
 *
 * ## Everything drawn is measured; everything unmeasured is absent
 *
 * The sample is a mock and carries numbers this product cannot yet produce (ArcShift™, per-card
 * deltas, hand-written headlines). None of them are faked here: the tempo block stands where
 * ArcShift stood because tempo is real, deltas appear only when the log actually holds prior
 * scored swings, and the headline is composed from the band and the top priority — fields the
 * scoring config emitted for exactly this purpose. A section with no data is not rendered.
 *
 * The meters are `design/gauges` — the SVG arc and ring, animated. This panel renders only when
 * its data changes (memoized above the per-frame player), so none of it rides the 60 Hz path.
 */

export interface AfterSwingSummaryProps {
  state: ReportState;
  analysis?: Analysis | null;
  /** The list's score/band — drawn while the report is still on the wire, so the panel never
   *  opens empty when the log already knew the number. */
  score?: number | null;
  band?: string | null;
  tempoRatio?: number | null;
  /** Recent overall scores, oldest → newest, this swing's LAST. From the log's cache. */
  history?: number[];
  onSeekToFrame?: (frame: number) => void;
}

/** The sample's trend violet — slightly brighter than the token, kept as the sample drew it. */
const TREND = "#9b6cff";
/** The sample's ring colour by score — cyan when pure, indigo mid, violet low. */
function ringColor(score: number): string {
  return score >= 85 ? "#5ed0ff" : score >= 70 ? "#6e92ff" : "#8b7bff";
}

export function AfterSwingSummary({
  state,
  analysis,
  score,
  band,
  tempoRatio,
  history,
  onSeekToFrame,
}: AfterSwingSummaryProps) {
  const report = state.kind === "ok" ? state.report : null;

  // The list's number until the report lands; the report's number after — same source, sooner.
  const overall = report ? report.overall : (score ?? null);
  const shownBand = report?.band ?? band ?? null;

  const findings = (report?.findings ?? []) as Finding[];
  const priorities = (report?.priorities ?? []) as Priority[];
  const checkpoints = useMemo(
    () => (report ? (Object.values(report.checkpoints ?? {}) as CheckpointScore[]) : []),
    [report],
  );

  const seek = (checkpoint: string | null | undefined) => {
    const target = checkpointTarget(analysis, checkpoint);
    return target && onSeekToFrame ? { target, go: () => onSeekToFrame(target.frame) } : null;
  };

  // The container keeps its identity across every state — screens and tests address the summary,
  // not the particular sentence it is currently able to stand behind.
  if (state.kind === "not-scored") {
    return (
      <View style={styles.wrap} testID="after-swing-summary">
        <Text style={styles.quiet}>
          This swing has not been scored. The video still plays — there is simply no scorecard
          for it.
        </Text>
      </View>
    );
  }
  if (state.kind === "unreachable" && overall === null) {
    return (
      <View style={styles.wrap} testID="after-swing-summary">
        <Text style={styles.quiet}>
          The scorecard could not be loaded. This is a connection problem, not a problem with the
          swing.
        </Text>
      </View>
    );
  }

  const delta = trendDelta(history);

  return (
    <View style={styles.wrap} testID="after-swing-summary">
      {/* The headline: band opener + the top priority as the opportunity, the sample's sentence
          shape built from fields the config emitted. */}
      <Text style={styles.headline}>{headline(shownBand, priorities[0])}</Text>

      <View style={styles.gaugeBlock}>
        <View style={styles.gaugeTopRow}>
          {shownBand ? (
            <View style={styles.bandChip}>
              <Text style={styles.bandChipText}>{shownBand}</Text>
            </View>
          ) : (
            <View />
          )}
          {delta !== null ? (
            <View style={styles.deltaCard}>
              <Text style={[styles.deltaValue, delta < 0 && styles.deltaValueDown]}>
                {delta >= 0 ? `+${delta}` : `−${Math.abs(delta)}`}
              </Text>
              <Text style={styles.deltaCaption}>Last {Math.min(history?.length ?? 0, 5)} swings</Text>
            </View>
          ) : null}
        </View>
        {overall !== null ? <ArcGauge score={overall} width={300} /> : null}
      </View>

      {(tempoRatio || report?.primary?.title) ? (
        <View style={styles.sideBlock}>
          {tempoRatio ? (
            <View style={styles.tempoRow}>
              <View style={styles.tempoValueBox}>
                <Text style={styles.tempoValue}>{tempoRatio.toFixed(1)}:1</Text>
                <Text style={styles.tempoTag}>Tempo</Text>
              </View>
              <View style={styles.tempoBody}>
                <Text style={styles.tempoLabel}>{tempoLabel(tempoRatio)}</Text>
                <Text style={styles.tempoHint}>
                  Backswing to downswing. Tour pace sits near 3:1.
                </Text>
              </View>
            </View>
          ) : null}
          {report?.primary?.title ? (
            <View style={[styles.takeawayRow, tempoRatio ? styles.sideDivider : null]}>
              <View style={styles.takeawayIcon}>
                <Text style={styles.takeawayGlyph}>✦</Text>
              </View>
              <View style={styles.takeawayBody}>
                <Text style={styles.sectionTag}>Coach takeaway</Text>
                <Text style={styles.takeawayText}>{report.primary.title}</Text>
              </View>
            </View>
          ) : null}
        </View>
      ) : null}

      {history && history.length >= 2 ? (
        <TrendLine history={history.slice(-5)} color={TREND} style={styles.trend} />
      ) : null}

      {findings.length > 0 ? (
        <View style={styles.findings}>
          {findings.map((f, i) => (
            <View
              key={`${f.title}-${i}`}
              style={[styles.findingBox, f.tone === "positive" ? styles.findingGood : styles.findingBad]}
            >
              <Text
                style={[
                  styles.findingIcon,
                  f.tone === "positive" ? styles.findingIconGood : styles.findingIconBad,
                ]}
              >
                {ICONS.has(f.icon) ? f.icon : "•"}
              </Text>
              <View style={styles.findingBody}>
                <Text style={styles.findingTitle}>{f.title}</Text>
                <Text style={styles.findingWhere}>{categoryLabel(f.detail)}</Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {checkpoints.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.rail}
          testID="indicator-rail"
        >
          {checkpoints.map((c) => {
            const s = seek(c.p);
            const scored = c.n_measurable > 0;
            const card = (
              <View key={c.p} style={styles.card}>
                <RingGauge
                  progress={scored ? c.score / 100 : null}
                  color={scored ? ringColor(c.score) : COLORS.dim}
                >
                  <Text style={[styles.ringScore, !scored && styles.ringNone]}>
                    {scored ? Math.round(c.score) : "—"}
                  </Text>
                </RingGauge>
                <Text style={styles.cardLabel} numberOfLines={2}>
                  {c.label}
                </Text>
              </View>
            );
            if (!s) return card;
            return (
              <Pressable
                key={c.p}
                onPress={s.go}
                accessibilityRole="button"
                accessibilityLabel={checkpointA11yLabel(s.target)}
                accessibilityHint="Seeks the video to this moment"
                style={({ pressed }) => pressed && styles.pressed}
              >
                {card}
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      {state.kind === "loading" || state.kind === "idle" ? (
        <Text style={styles.quiet}>Loading the full scorecard…</Text>
      ) : null}
    </View>
  );
}

/** The report's icon strings, allow-listed as in `AnalysisPanel` — unknown glyphs draw a dot. */
const ICONS = new Set(["↓", "↑", "✓"]);

function headline(band: string | null, top?: Priority): string {
  const opener =
    band?.toLowerCase() === "pure"
      ? "Pure swing."
      : band?.toLowerCase() === "solid"
        ? "Strong swing."
        : band
          ? "Building a swing."
          : "Your swing, scored.";
  if (!top?.label) return opener;
  return `${opener} ${top.label} is the clearest opportunity.`;
}

function tempoLabel(ratio: number): string {
  if (ratio >= 3.4) return "Unhurried — slightly long backswing";
  if (ratio >= 2.6) return "On tour pace";
  return "Quick — the backswing is rushed";
}

/** `current − oldest in the window`, rounded — the sample's "+8 last 5 swings". Null abstains. */
function trendDelta(history?: number[]): number | null {
  if (!history || history.length < 2) return null;
  const window = history.slice(-5);
  return Math.round(window[window.length - 1] - window[0]);
}

const styles = StyleSheet.create({
  wrap: { gap: 18 },
  quiet: { color: COLORS.muted, fontSize: 13, lineHeight: 19 },
  pressed: { opacity: 0.6 },

  headline: {
    color: COLORS.text,
    fontSize: 27,
    lineHeight: 31,
    fontWeight: "600",
    letterSpacing: -1.2,
  },

  gaugeBlock: { alignItems: "center" },
  gaugeTopRow: {
    alignSelf: "stretch",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    minHeight: 40,
  },
  bandChip: {
    borderRadius: 999,
    backgroundColor: "rgba(163,230,53,0.1)",
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  bandChipText: {
    color: COLORS.acid,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1.8,
    textTransform: "uppercase",
  },
  // The sample's floating "last 5" card: right-aligned, above the gauge's end.
  deltaCard: {
    alignItems: "flex-end",
    borderRadius: 16,
    backgroundColor: "rgba(17,19,36,0.9)",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  deltaValue: { color: COLORS.acid, fontSize: 22, fontWeight: "700", lineHeight: 23 },
  deltaValueDown: { color: "#ff8b6b" },
  deltaCaption: {
    color: COLORS.dim,
    fontSize: 8,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginTop: 2,
  },

  sideBlock: { gap: 0 },
  tempoRow: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 4 },
  tempoValueBox: { alignItems: "center", minWidth: 74 },
  tempoValue: { color: COLORS.violet, fontSize: 30, fontWeight: "700", letterSpacing: -1 },
  tempoTag: {
    color: "rgba(139,123,255,0.7)",
    fontSize: 8,
    fontWeight: "700",
    letterSpacing: 1.8,
    textTransform: "uppercase",
  },
  tempoBody: { flex: 1, gap: 2 },
  tempoLabel: { color: COLORS.text, fontSize: 16, fontWeight: "600" },
  tempoHint: { color: COLORS.muted, fontSize: 10.5, lineHeight: 14 },
  sideDivider: {
    marginTop: 12,
    paddingTop: 14,
  },
  takeawayRow: { flexDirection: "row", alignItems: "flex-start", gap: 14 },
  takeawayIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(163,230,53,0.1)",
  },
  takeawayGlyph: { color: COLORS.acid, fontSize: 19 },
  takeawayBody: { flex: 1, gap: 3 },
  sectionTag: {
    color: COLORS.muted,
    fontSize: 9,
    fontWeight: "600",
    letterSpacing: 1.6,
    textTransform: "uppercase",
  },
  takeawayText: { color: COLORS.text, fontSize: 15, fontWeight: "500", lineHeight: 21 },

  trend: { marginHorizontal: 6, opacity: 0.9 },

  findings: { gap: 9 },
  findingBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  findingBad: { backgroundColor: "rgba(255,139,107,0.07)" },
  findingGood: { backgroundColor: "rgba(163,230,53,0.06)" },
  findingIcon: { fontSize: 17, fontWeight: "800", width: 20, textAlign: "center" },
  findingIconBad: { color: "#ff8b6b" },
  findingIconGood: { color: COLORS.acid },
  findingBody: { flex: 1, gap: 2 },
  findingTitle: { color: COLORS.text, fontSize: 15, fontWeight: "600", lineHeight: 19 },
  findingWhere: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },

  rail: { gap: 10, paddingVertical: 2, paddingRight: 8 },
  card: {
    width: 112,
    alignItems: "center",
    gap: 8,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.035)",
    paddingVertical: 14,
    paddingHorizontal: 8,
  },
  cardLabel: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 15,
    textAlign: "center",
  },
  ringScore: { color: COLORS.text, fontSize: 20, fontWeight: "700", letterSpacing: -1 },
  ringNone: { color: COLORS.dim, fontSize: 16 },
});
