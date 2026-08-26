import { Pressable, Text, View } from "react-native";
import { TrendingDown, TrendingUp } from "lucide-react-native";

import { FONT_BODY } from "../../../design/system/typography";
import { themedStyles, useTheme } from "../../../theme";
import type { StudentSummary } from "../mock/types";
import { InitialsDisc } from "./InitialsDisc";

/**
 * One roster row (architecture §4a.2): the face, the measured headline, and the three quiet
 * signals — unread, drill follow-through, the lesson slot. Everything here is something an
 * instructor acts on; anything that was merely available stayed off the card.
 */
export function StudentCard({
  student,
  onPress,
}: {
  student: StudentSummary;
  onPress: () => void;
}) {
  const t = useTheme();
  const styles = useStyles();
  const trendColor =
    student.trend.direction === "up"
      ? t.good
      : student.trend.direction === "down"
        ? t.bad
        : t.muted;

  return (
    <Pressable
      testID={`student-${student.id}`}
      accessibilityRole="button"
      accessibilityLabel={`${student.name}, ${student.trend.label}`}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      <InitialsDisc initials={student.initials} />
      <View style={styles.body}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>
            {student.name}
          </Text>
          {student.unread > 0 && <View style={styles.unreadDot} />}
        </View>
        <View style={styles.trendRow}>
          {student.trend.direction === "up" && (
            <TrendingUp size={13} color={trendColor} strokeWidth={2.4} />
          )}
          {student.trend.direction === "down" && (
            <TrendingDown size={13} color={trendColor} strokeWidth={2.4} />
          )}
          <Text style={[styles.trend, { color: trendColor }]} numberOfLines={1}>
            {student.trend.label}
          </Text>
        </View>
        <Text style={styles.meta} numberOfLines={1}>
          {student.handicapLabel} · last swing {student.lastSwingAgo}
          {student.compliance
            ? ` · drills ${student.compliance.pct}%${student.compliance.selfReportedOnly ? " (self-reported)" : ""}`
            : ""}
        </Text>
      </View>
      {student.lessonState != null && (
        <Text style={[styles.lesson, student.lessonState === "viewed" && { color: t.muted }]}>
          {student.lessonState === "viewed" ? "Lesson viewed" : "Lesson sent"}
        </Text>
      )}
    </Pressable>
  );
}

const useStyles = themedStyles((t) => ({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: t.surface,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  cardPressed: { backgroundColor: t.surface2 },
  body: { flex: 1, gap: 2 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  name: { color: t.text, fontFamily: FONT_BODY.semiBold, fontSize: 14.5, flexShrink: 1 },
  unreadDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: t.aqua },
  trendRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  trend: { fontFamily: FONT_BODY.regular, fontSize: 12.5, flexShrink: 1 },
  meta: { color: t.muted, fontFamily: FONT_BODY.regular, fontSize: 11.5 },
  lesson: { color: t.textSoft, fontFamily: FONT_BODY.regular, fontSize: 10.5 },
}));
