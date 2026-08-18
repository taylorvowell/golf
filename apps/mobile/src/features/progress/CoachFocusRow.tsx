import { Text, View } from "react-native";

import { BrandIconThumb, ProgressTrack, StickThumb } from "../../design/system";
import { FONT_BODY, FONT_DISPLAY } from "../../design/system/typography";
import { themedStyles, useTheme } from "../../theme";
import type { ProgressPriority } from "./viewModel";

/**
 * `.coach-focus` (Progress mockup): stick-figure tile, ordinal + title + copy, the priority
 * pill, and — only when real numbers exist — the Before/Now progress track. The compact
 * (phone) grid: 48px thumb column, pill under the copy, track spanning the full width.
 */
export function CoachFocusRow({ priority }: { priority: ProgressPriority }) {
  const t = useTheme();
  const styles = useStyles();
  const pill =
    priority.level === "high"
      ? { bg: "rgba(229,87,100,0.14)", fg: t.bad }
      : priority.level === "med"
        ? { bg: t.mode === "dark" ? "rgba(63,87,218,0.20)" : "rgba(47,70,207,0.12)", fg: t.cobalt }
        : { bg: "rgba(40,168,107,0.14)", fg: t.good };

  return (
    <View style={styles.row}>
      <View style={styles.main}>
        {priority.icon ? (
          <BrandIconThumb name={priority.icon} size={48} />
        ) : (
          <StickThumb figure={priority.figure} size={48} />
        )}
        <View style={styles.body}>
          <Text style={styles.ordinal}>{priority.ordinal}</Text>
          <Text style={styles.title}>{priority.title}</Text>
          <Text style={styles.copy}>{priority.copy}</Text>
        </View>
        {/* .priority-pill — radius 999, tinted fill (borderless rule). */}
        <View style={[styles.pill, { backgroundColor: pill.bg }]}>
          <Text style={[styles.pillText, { color: pill.fg }]}>{priority.levelLabel}</Text>
        </View>
      </View>
      {/* .focus-progress — drawn only from real category scores (goal-progression's seam);
          a canned width would present a measurement nobody made. */}
      {priority.progress != null && (
        <ProgressTrack
          fraction={priority.progress.now / 100}
          height={8}
          labels={{
            start: `Before ${priority.progress.before}`,
            mid: `Now ${priority.progress.now}`,
            end: `${priority.progress.now - priority.progress.before >= 0 ? "+" : ""}${
              priority.progress.now - priority.progress.before
            }`,
          }}
          style={styles.track}
        />
      )}
    </View>
  );
}

const useStyles = themedStyles((t) => ({
  /* .coach-focus — surface2 well, radius 12, padding 12. */
  row: { padding: 12, borderRadius: 12, backgroundColor: t.surface2, gap: 10 },
  main: { flexDirection: "row", alignItems: "center", gap: 10 },
  body: { flex: 1, minWidth: 0 },
  ordinal: {
    color: t.muted,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 7,
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  title: { marginTop: 4, color: t.text, fontFamily: FONT_DISPLAY.extraBold, fontSize: 14 },
  copy: {
    marginTop: 4,
    color: t.textSoft,
    fontFamily: FONT_BODY.regular,
    fontSize: 9,
    lineHeight: 13,
  },
  pill: {
    minHeight: 24,
    paddingHorizontal: 9,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-start",
  },
  pillText: {
    fontFamily: FONT_DISPLAY.black,
    fontSize: 7,
    letterSpacing: 0.56,
    textTransform: "uppercase",
  },
  track: { marginTop: 2 },
}));
