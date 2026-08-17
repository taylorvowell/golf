import { Text, View } from "react-native";

import { ScoreOrb, StickThumb } from "../../design/system";
import { FONT_BODY, FONT_DISPLAY } from "../../design/system/typography";
import { themedStyles, useTheme } from "../../theme";
import { COMPARE_FIGURES, type CompareEnd } from "./viewModel";

/**
 * `.compare-grid` (Progress mockup): the then-vs-now pair. Everything drawn is REAL — the
 * two swings' labels, dates and scores from the log; the score circles sweep to the real
 * score (`.compare-score`'s conic → ScoreOrb, lavender for "then", aqua for "now"). The
 * mockup's per-swing commentary and finding tags need per-swing findings, which the list
 * does not carry — they arrive with goal-progression via `copy`/`tags`, and until then the
 * cards abstain rather than caption real swings with canned claims.
 */
export function CompareThenNow({
  then,
  now,
  copy,
  tags,
}: {
  then: CompareEnd;
  now: CompareEnd;
  /** Per-card commentary once a later track derives it from real findings. */
  copy?: { then: string; now: string };
  tags?: { then: string[]; now: string[] };
}) {
  const t = useTheme();
  const styles = useStyles();
  const card = (
    slot: "then" | "now",
    end: CompareEnd,
  ) => (
    <View style={styles.card}>
      <View style={styles.scoreRow}>
        <View style={styles.identity}>
          <StickThumb figure={COMPARE_FIGURES[slot]} size={48} />
          <View style={{ flexShrink: 1 }}>
            <Text style={styles.slot}>{slot === "then" ? "Then" : "Now"}</Text>
            <Text style={styles.label} numberOfLines={2}>
              {end.label}
            </Text>
          </View>
        </View>
        <ScoreOrb
          score={end.score}
          size={46}
          color={slot === "then" ? t.lavender : t.aqua}
        />
      </View>
      <Text style={styles.date}>
        {new Date(end.at).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        })}
      </Text>
      {copy != null && <Text style={styles.copy}>{copy[slot]}</Text>}
      {tags != null && tags[slot].length > 0 && (
        <View style={styles.tags}>
          {tags[slot].map((tag) => (
            <View key={tag} style={styles.tag}>
              <Text style={styles.tagText}>{tag}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );

  return (
    <View style={styles.grid}>
      {card("then", then)}
      {card("now", now)}
    </View>
  );
}

const useStyles = themedStyles((t) => ({
  /* .compare-grid — two columns, gap 10. */
  grid: { flexDirection: "row", gap: 10 },
  /* .compare-swing — surface2 well, radius 12, padding 12. */
  card: { flex: 1, padding: 12, borderRadius: 12, backgroundColor: t.surface2 },
  scoreRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 8,
  },
  identity: { flexDirection: "row", alignItems: "center", gap: 10, flexShrink: 1 },
  slot: {
    color: t.muted,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 7,
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  label: { marginTop: 4, color: t.text, fontFamily: FONT_DISPLAY.extraBold, fontSize: 13 },
  date: { color: t.textSoft, fontFamily: FONT_BODY.regular, fontSize: 9 },
  copy: {
    marginTop: 4,
    color: t.textSoft,
    fontFamily: FONT_BODY.regular,
    fontSize: 9,
    lineHeight: 13,
  },
  /* .compare-tags / .compare-tag — surface3 pills, radius 999. */
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  tag: {
    minHeight: 22,
    paddingHorizontal: 8,
    borderRadius: 999,
    backgroundColor: t.surface3,
    alignItems: "center",
    justifyContent: "center",
  },
  tagText: {
    color: t.textSoft,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 7,
    letterSpacing: 0.56,
    textTransform: "uppercase",
  },
}));
