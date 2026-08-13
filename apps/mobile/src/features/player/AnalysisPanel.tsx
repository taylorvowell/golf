import { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type {
  Analysis,
  CategoryResult,
  CheckResult,
  CheckpointScore,
  Finding,
  Priority,
} from "@swingsage/schema/contract";

import { DECK } from "../../design/deck";
import { COLORS } from "../../theme";
import { checkpointA11yLabel, checkpointTarget, type CheckpointTarget } from "./checkpointFrames";
import { categoryLabel, describeCheck } from "./scoreDisplay";
import type { ReportState } from "./useReport";

/**
 * The swing, explained.
 *
 * **A score alone is a product failure** (CLAUDE.md): what was detected, why it matters, how
 * important it is, what to work on first. This panel is that sentence, in that order — the one fix
 * with the most leverage, the drill for it, what was seen, then the rest ranked, then the swing by
 * position and by moment.
 *
 * ## Coverage is printed next to the score, not buried
 *
 * `65 from 41 of 58 checks` and `65 from 6 of 58` are different claims about the same number, and a
 * reader who cannot tell them apart has been misled by a headline. The two reasons checks did not
 * score are also kept apart, because they mean opposite things: *skipped for this swing* is
 * something about the clip (wrong club, wrong view, low confidence), while *deferred* is the config
 * refusing to score a metric it does not trust yet — our gap, not the golfer's. That split is held
 * at the headline, at every category, and at every individual check; collapsing it anywhere would
 * make the panel contradict itself.
 *
 * ## Rows that know where they happened take you there
 *
 * Anything anchored to a coaching position seeks the player to that frame and closes the panel, so
 * a finding lands on the picture it is about rather than on a paragraph. A row whose checkpoint
 * does not resolve is **plain text with no affordance at all** — never a control that looks
 * pressable and does nothing. See `checkpointFrames.ts` for why null is a real answer.
 *
 * ## Nothing here is AI
 *
 * Every word comes from the versioned `scoring_config` via `coach_report.json`. AI is an
 * enhancement and never a hard dependency for a swing being ready, so this panel is what a golfer
 * gets with no model call at all.
 */

export interface AnalysisPanelProps {
  state: ReportState;
  /** The artifact, for resolving a checkpoint to a frame. Null when the swing has none. */
  analysis?: Analysis | null;
  /** Seek the player and dismiss this panel. Absent when the player cannot seek. */
  onSeekToFrame?: (frame: number) => void;
}

export function AnalysisPanel({ state, analysis, onSeekToFrame }: AnalysisPanelProps) {
  const [open, setOpen] = useState<string | null>(null);
  const toggle = useCallback(
    (category: string) => setOpen((c) => (c === category ? null : category)),
    [],
  );

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
  const categories = Object.values(report.categories ?? {}) as CategoryResult[];
  const priorities = (report.priorities ?? []) as Priority[];
  const findings = (report.findings ?? []) as Finding[];
  const checkpoints = Object.values(report.checkpoints ?? {}) as CheckpointScore[];

  /** A row seeks only when the artifact can actually place it. */
  const seek = (checkpoint: string | null | undefined) => {
    const target = checkpointTarget(analysis, checkpoint);
    return target && onSeekToFrame ? { target, go: () => onSeekToFrame(target.frame) } : null;
  };

  const primarySeek = seek(report.primary?.checkpoint);

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
        <Seekable seek={primarySeek} style={styles.primary}>
          <Text style={styles.primaryTag}>Work on this first</Text>
          <Text style={styles.primaryTitle}>{report.primary.title}</Text>
          {primarySeek ? <Moment target={primarySeek.target} /> : null}
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
        </Seekable>
      ) : null}

      {findings.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>What was seen</Text>
          {/* Both tones, and the positive ones are not decoration: a golfer who is only ever told
              what is broken has no way to keep the parts that are working. `detail` is a CATEGORY
              SLUG, not prose — it goes through `categoryLabel` rather than to the screen raw. */}
          {findings.map((f, i) => (
            <View key={`${f.title}-${i}`} style={styles.finding}>
              <Text style={[styles.findingIcon, f.tone === "positive" && styles.findingIconGood]}>
                {ICONS.has(f.icon) ? f.icon : ""}
              </Text>
              <View style={styles.findingBody}>
                <Text style={styles.findingTitle}>{f.title}</Text>
                <Text style={styles.findingWhere}>{categoryLabel(f.detail)}</Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {priorities.length > 1 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Then</Text>
          {/* Ranked by leverage — severity, impact and ease in equal thirds — rather than by how
              badly each scored. The worst score is not always the best thing to spend a range
              session on, and that ordering is the whole point of a coach. */}
          {priorities.slice(1, 5).map((p) => {
            const s = seek(p.checkpoint);
            return (
              <Seekable key={p.key} seek={s} style={styles.priority}>
                <View style={styles.priorityHead}>
                  <Text style={styles.priorityLabel}>{p.label}</Text>
                  {p.checkpoint ? <Text style={styles.checkpoint}>{p.checkpoint}</Text> : null}
                </View>
                {p.cue ? <Text style={styles.cue}>{p.cue}</Text> : null}
              </Seekable>
            );
          })}
        </View>
      ) : null}

      {checkpoints.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>By position</Text>
          <View style={styles.cpRow}>
            {checkpoints.map((c) => {
              const s = seek(c.p);
              return (
                <Seekable key={c.p} seek={s} style={styles.cp}>
                  <Text style={styles.cpP}>{c.p}</Text>
                  {/* Nothing measurable is an abstention, not a zero — a position with no
                      measurable checks has said nothing about this swing. */}
                  <Text style={[styles.cpScore, c.n_measurable === 0 && styles.cpNone]}>
                    {c.n_measurable === 0 ? "—" : Math.round(c.score)}
                  </Text>
                  <Text style={styles.cpLabel} numberOfLines={1}>
                    {c.label}
                  </Text>
                </Seekable>
              );
            })}
          </View>
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>By moment</Text>
        {categories.map((c) => (
          <CategoryRow
            key={c.category}
            category={c}
            expanded={open === c.category}
            onToggle={toggle}
            seek={seek}
          />
        ))}
      </View>
    </View>
  );
}

/**
 * The report's icons are config strings, allow-listed so an unrecognised glyph draws nothing
 * rather than tofu.
 *
 * The set is what the config actually emits, read off all ten fixtures rather than assumed: `↓`
 * for a fault and **`✓`** for something the golfer is doing well. An earlier guess at `↑` for the
 * positive tone silently blanked the icon on every positive finding — nothing failed, the row just
 * quietly lost its mark.
 */
const ICONS = new Set(["↓", "↑", "✓"]);

type Seek = { target: CheckpointTarget; go: () => void } | null;

/**
 * A row that seeks when it can and is inert text when it cannot.
 *
 * The branch is on the *element*, not on a `disabled` prop, so an unresolvable row has no button
 * role, no press feedback and nothing for a screen reader to offer — it is not a broken control,
 * it is not a control.
 */
function Seekable({
  seek,
  style,
  children,
}: {
  seek: Seek;
  style: object;
  children: React.ReactNode;
}) {
  if (!seek) return <View style={style}>{children}</View>;
  return (
    <Pressable
      style={({ pressed }) => [style, pressed && styles.pressed]}
      onPress={seek.go}
      accessibilityRole="button"
      accessibilityHint="Seeks the video to this moment"
      accessibilityLabel={checkpointA11yLabel(seek.target)}
      hitSlop={8}
    >
      {children}
    </Pressable>
  );
}

function Moment({ target }: { target: CheckpointTarget }) {
  return (
    <Text style={styles.moment}>
      {target.label} · frame {target.frame}
    </Text>
  );
}

function CategoryRow({
  category,
  expanded,
  onToggle,
  seek,
}: {
  category: CategoryResult;
  expanded: boolean;
  onToggle: (category: string) => void;
  seek: (checkpoint: string | null | undefined) => Seek;
}) {
  const scored = typeof category.score === "number";
  const checks = category.checks ?? [];

  return (
    <View style={styles.catRow}>
      <Pressable
        onPress={() => onToggle(category.category)}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${categoryLabel(category.category)}, ${
          scored ? `scored ${Math.round(category.score as number)}` : "not scored"
        }`}
        accessibilityHint={expanded ? "Hides the checks behind this score" : "Shows every check behind this score"}
        hitSlop={8}
        disabled={checks.length === 0}
      >
        <View style={styles.catHead}>
          <Text style={styles.catLabel}>{categoryLabel(category.category)}</Text>
          <Text style={[styles.catScore, !scored && styles.catUnscored]}>
            {scored ? Math.round(category.score as number) : "not scored"}
          </Text>
        </View>
        <View style={styles.meter}>
          {scored ? (
            <View
              style={[styles.meterFill, { width: `${Math.max(2, category.score as number)}%` }]}
            />
          ) : null}
        </View>
        {/* `n of n` beside every category for the same reason coverage sits beside the headline: a
            category resting on two checks must not read like one resting on nine. */}
        <View style={styles.catFoot}>
          <Text style={styles.catCoverage}>
            {category.n_measurable} of {category.n_total} measured
            {category.n_deferred ? ` · ${category.n_deferred} not scored yet` : ""}
          </Text>
          {checks.length > 0 ? (
            <Text style={styles.disclose}>{expanded ? "Hide checks" : "Show checks"}</Text>
          ) : null}
        </View>
      </Pressable>

      {/* Collapsed by default: the panel opens as a summary, not a spreadsheet. */}
      {expanded ? (
        <View style={styles.checks}>
          {checks.map((check) => (
            <CheckRow key={check.id} check={check} seek={seek} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function CheckRow({
  check,
  seek,
}: {
  check: CheckResult;
  seek: (checkpoint: string | null | undefined) => Seek;
}) {
  const s = seek(check.checkpoint);
  const scored = typeof check.score === "number";

  return (
    <Seekable seek={s} style={styles.check}>
      <View style={styles.checkHead}>
        <Text style={styles.checkLabel}>{check.label}</Text>
        {scored ? (
          <Text style={styles.checkScore}>{Math.round(check.score as number)}</Text>
        ) : null}
      </View>
      {scored ? (
        <Text style={styles.checkValue}>{describeCheck(check)}</Text>
      ) : (
        /* The two unscored reasons, kept apart in the same words the headline uses. `deferred`
           is the config declining to score a metric it does not trust on ANY swing — our gap.
           A `skip_reason` alone is about this clip. Never a bare zero for either. */
        <Text style={styles.checkUnscored}>
          {check.deferred ? "Not scored yet" : "Not measured on this clip"}
          {check.skip_reason ? ` — ${check.skip_reason}` : ""}
        </Text>
      )}
      {check.advice ? <Text style={styles.checkAdvice}>{check.advice}</Text> : null}
    </Seekable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 20 },
  quiet: { color: COLORS.muted, fontSize: 13, lineHeight: 19 },
  pressed: { opacity: 0.6 },

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
  moment: { color: DECK.label.caption, fontSize: 11, fontVariant: ["tabular-nums"] },
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

  finding: { flexDirection: "row", alignItems: "flex-start", gap: 9 },
  findingIcon: { color: "#ff8b6b", fontSize: 13, fontWeight: "800", lineHeight: 19, width: 11 },
  findingIconGood: { color: DECK.accent },
  findingBody: { flex: 1, gap: 1 },
  findingTitle: { color: COLORS.text, fontSize: 13, fontWeight: "600", lineHeight: 19 },
  findingWhere: { color: COLORS.dim, fontSize: 10.5 },

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

  cpRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  cp: {
    alignItems: "center",
    gap: 1,
    minWidth: 54,
    flexGrow: 1,
    paddingVertical: 7,
    paddingHorizontal: 4,
    borderRadius: DECK.radius.tile,
    backgroundColor: DECK.glass.key,
    borderWidth: 1,
    borderColor: DECK.glass.keyEdge,
  },
  cpP: { color: DECK.label.caption, fontSize: 9, fontWeight: "800", letterSpacing: 0.8 },
  cpScore: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  cpNone: { color: COLORS.dim, fontSize: 14 },
  cpLabel: { color: COLORS.dim, fontSize: 9.5 },

  catRow: { gap: 5 },
  catHead: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 12,
  },
  catLabel: { color: COLORS.text, fontSize: 13, fontWeight: "600", flexShrink: 1 },
  catScore: { color: COLORS.text, fontSize: 13, fontWeight: "700", fontVariant: ["tabular-nums"] },
  catUnscored: { color: COLORS.dim, fontSize: 11, fontWeight: "600" },
  meter: { height: 4, borderRadius: 2, backgroundColor: DECK.glass.key, overflow: "hidden" },
  meterFill: { height: "100%", borderRadius: 2, backgroundColor: DECK.accent },
  catFoot: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },
  catCoverage: { color: COLORS.dim, fontSize: 10.5, flexShrink: 1 },
  disclose: { color: DECK.label.caption, fontSize: 10, fontWeight: "700" },

  checks: {
    gap: 11,
    paddingTop: 9,
    paddingLeft: 11,
    borderLeftWidth: 1,
    borderLeftColor: DECK.glass.hairline,
  },
  check: { gap: 2 },
  checkHead: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 10,
  },
  checkLabel: { color: COLORS.text, fontSize: 12, fontWeight: "600", flexShrink: 1 },
  checkScore: {
    color: COLORS.muted,
    fontSize: 11.5,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  checkValue: { color: COLORS.muted, fontSize: 11.5, lineHeight: 16.5 },
  checkUnscored: { color: COLORS.dim, fontSize: 11, lineHeight: 16, fontStyle: "italic" },
  checkAdvice: { color: DECK.label.caption, fontSize: 11.5, lineHeight: 16.5 },
});
