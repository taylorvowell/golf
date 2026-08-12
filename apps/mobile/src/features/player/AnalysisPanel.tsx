import { StyleSheet, Text, View } from "react-native";
import type { CategoryResult, Priority } from "@swingsage/schema/contract";

import { DECK } from "../../design/deck";
import { COLORS } from "../../theme";
import type { ReportState } from "./useReport";

/**
 * The swing, explained.
 *
 * **A score alone is a product failure** (CLAUDE.md): what was detected, why it matters, how
 * important it is, what to work on first. This panel is that sentence, in that order — the one fix
 * with the most leverage, the drill for it, then the rest ranked, then the categories with their
 * coverage.
 *
 * ## Coverage is printed next to the score, not buried
 *
 * `65 from 41 of 58 checks` and `65 from 6 of 58` are different claims about the same number, and a
 * reader who cannot tell them apart has been misled by a headline. The two reasons checks did not
 * score are also kept apart, because they mean opposite things: *skipped for this swing* is
 * something about the clip (wrong club, wrong view, low confidence), while *deferred* is the config
 * refusing to score a metric it does not trust yet — our gap, not the golfer's.
 *
 * ## Nothing here is AI
 *
 * Every word comes from the versioned `scoring_config` via `coach_report.json`. AI is an
 * enhancement and never a hard dependency for a swing being ready, so this panel is what a golfer
 * gets with no model call at all.
 */

export function AnalysisPanel({ state }: { state: ReportState }) {
  if (state.kind === "loading" || state.kind === "idle") {
    return <Text style={styles.quiet}>Loading the scorecard…</Text>;
  }
  if (state.kind === "not-scored") {
    return (
      <Text style={styles.quiet}>
        This swing has not been scored. The video and the overlays still work — there is simply no
        scorecard for it.
      </Text>
    );
  }
  if (state.kind === "unreachable") {
    return (
      <Text style={styles.quiet}>
        The scorecard could not be loaded. This is a connection problem, not a problem with the
        swing.
      </Text>
    );
  }

  const { report } = state;
  const { coverage } = report;
  const categories = Object.values(report.categories) as CategoryResult[];
  const priorities = (report.priorities ?? []) as Priority[];

  return (
    <View style={styles.wrap} testID="analysis-panel">
      <View style={styles.headline}>
        <View style={styles.scoreBlock}>
          <Text style={styles.score}>
            {report.overall === null ? "—" : Math.round(report.overall)}
          </Text>
          {report.band ? <Text style={styles.band}>{report.band}</Text> : null}
        </View>
        <View style={styles.coverage}>
          <Text style={styles.coverageMain}>
            from {coverage.scored} of {coverage.total_checks} checks
          </Text>
          {coverage.skipped_this_swing > 0 ? (
            <Text style={styles.coverageLine}>
              {coverage.skipped_this_swing} could not be measured on this clip
            </Text>
          ) : null}
          {coverage.deferred_in_config > 0 ? (
            <Text style={styles.coverageLine}>
              {coverage.deferred_in_config} are not yet trustworthy enough to score
            </Text>
          ) : null}
          <Text style={styles.model}>scoring {report.scoring_model_version}</Text>
        </View>
      </View>

      {report.primary?.title ? (
        <View style={styles.primary}>
          <Text style={styles.primaryTag}>Work on this first</Text>
          <Text style={styles.primaryTitle}>{report.primary.title}</Text>
          {report.drill?.title ? (
            <View style={styles.drill}>
              <Text style={styles.drillTitle}>{report.drill.title}</Text>
              <Text style={styles.drillCopy}>{report.drill.copy}</Text>
              {report.drill.dose ? (
                <Text style={styles.drillDose}>
                  {report.drill.dose}
                  {report.drill.doseNote ? ` · ${report.drill.doseNote}` : ""}
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}

      {priorities.length > 1 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Then</Text>
          {/* Ranked by leverage — severity, impact and ease in equal thirds — rather than by how
              badly each scored. The worst score is not always the best thing to spend a range
              session on, and that ordering is the whole point of a coach. */}
          {priorities.slice(1, 5).map((p) => (
            <View key={p.key} style={styles.priority}>
              <View style={styles.priorityHead}>
                <Text style={styles.priorityLabel}>{p.label}</Text>
                {p.checkpoint ? <Text style={styles.checkpoint}>{p.checkpoint}</Text> : null}
              </View>
              {p.cue ? <Text style={styles.cue}>{p.cue}</Text> : null}
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>By moment</Text>
        {categories.map((c) => (
          <CategoryRow key={c.category} category={c} />
        ))}
      </View>
    </View>
  );
}

function CategoryRow({ category }: { category: CategoryResult }) {
  const scored = typeof category.score === "number";
  return (
    <View style={styles.catRow}>
      <View style={styles.catHead}>
        <Text style={styles.catLabel}>{titleise(category.category)}</Text>
        <Text style={[styles.catScore, !scored && styles.catUnscored]}>
          {scored ? Math.round(category.score as number) : "not scored"}
        </Text>
      </View>
      <View style={styles.meter}>
        {scored ? (
          <View style={[styles.meterFill, { width: `${Math.max(2, category.score as number)}%` }]} />
        ) : null}
      </View>
      {/* `n of n` beside every category for the same reason coverage sits beside the headline: a
          category resting on two checks must not read like one resting on nine. */}
      <Text style={styles.catCoverage}>
        {category.n_measurable} of {category.n_total} measured
      </Text>
    </View>
  );
}

function titleise(key: string): string {
  return key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

const styles = StyleSheet.create({
  wrap: { gap: 20 },
  quiet: { color: COLORS.muted, fontSize: 13, lineHeight: 19 },

  headline: { flexDirection: "row", alignItems: "flex-start", gap: 16 },
  scoreBlock: { alignItems: "center", minWidth: 76 },
  score: { color: COLORS.text, fontSize: 46, fontWeight: "800", lineHeight: 50, letterSpacing: -2 },
  band: { color: DECK.accent, fontSize: 12, fontWeight: "700", textTransform: "capitalize" },
  coverage: { flex: 1, gap: 3, paddingTop: 8 },
  coverageMain: { color: COLORS.text, fontSize: 13, fontWeight: "600" },
  coverageLine: { color: COLORS.muted, fontSize: 11.5, lineHeight: 16 },
  model: { color: COLORS.dim, fontSize: 10, fontVariant: ["tabular-nums"], paddingTop: 2 },

  primary: {
    gap: 8,
    padding: 14,
    borderRadius: 16,
    backgroundColor: "rgba(184,255,74,0.07)",
    borderWidth: 1,
    borderColor: "rgba(184,255,74,0.22)",
  },
  primaryTag: {
    color: DECK.accent,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1.6,
    textTransform: "uppercase",
  },
  primaryTitle: { color: COLORS.text, fontSize: 15, fontWeight: "600", lineHeight: 21 },
  drill: { gap: 3, paddingTop: 8, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.08)" },
  drillTitle: { color: COLORS.text, fontSize: 12.5, fontWeight: "700" },
  drillCopy: { color: COLORS.muted, fontSize: 12.5, lineHeight: 18 },
  drillDose: { color: DECK.accent, fontSize: 11, fontWeight: "600" },

  section: { gap: 10 },
  sectionTitle: {
    color: DECK.label.caption,
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1.6,
    textTransform: "uppercase",
  },
  priority: { gap: 3 },
  priorityHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  priorityLabel: { color: COLORS.text, fontSize: 13.5, fontWeight: "600", flexShrink: 1 },
  checkpoint: {
    color: DECK.label.caption,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.8,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 5,
    backgroundColor: DECK.glass.key,
  },
  cue: { color: COLORS.muted, fontSize: 12.5, lineHeight: 18 },

  catRow: { gap: 5 },
  catHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 12 },
  catLabel: { color: COLORS.text, fontSize: 13, fontWeight: "600", flexShrink: 1 },
  catScore: { color: COLORS.text, fontSize: 13, fontWeight: "700", fontVariant: ["tabular-nums"] },
  catUnscored: { color: COLORS.dim, fontSize: 11, fontWeight: "600" },
  meter: { height: 4, borderRadius: 2, backgroundColor: DECK.glass.key, overflow: "hidden" },
  meterFill: { height: "100%", borderRadius: 2, backgroundColor: DECK.accent },
  catCoverage: { color: COLORS.dim, fontSize: 10.5 },
});
