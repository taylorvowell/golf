import { useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { CheckCheck, MessageSquare, PenLine, Video } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  Button,
  Eyebrow,
  FloatingBack,
  ListGroup,
  ListRow,
  ListSectionLabel,
  Panel,
  Sheet,
  Tag,
} from "../design/system";
import { FONT_BODY, FONT_DISPLAY } from "../design/system/typography";
import { useAppNavigation, type RootStackParamList } from "../navigation";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { themedStyles, useTheme } from "../theme";
import { InitialsDisc } from "../features/instructor/components/InitialsDisc";
import { useStudentSeam } from "../features/instructor/mock/seams";

/**
 * The student's deep page (architecture §4a.3 — the full §25.2 set): who they are, the current
 * plan, MEASURED progress (the documented-progress surface competitors need a $5k bay for),
 * analysed swings with review chrome doors, assigned drills with the honesty split
 * (camera-verified and self-reported never mingle, §18.5), the 3-slot focus rule made visible
 * (§16.3.2), private notes, and the end-relationship act (§24.2).
 *
 * Mocked (step 04): `useStudentSeam` only. The review chrome DOORS open named placeholder
 * sheets — the acts behind them belong to the relationships/collaboration/lessons tracks.
 */
export function StudentDetailScreen({
  route,
}: NativeStackScreenProps<RootStackParamList, "StudentDetail">) {
  const t = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const navigation = useAppNavigation();
  const detail = useStudentSeam(route.params.studentId);
  const [door, setDoor] = useState<null | { title: string; body: string }>(null);

  const s = detail.summary;
  const slotsFull = detail.focusSlots.length >= 3;

  const reviewDoor = (title: string, owner: string) =>
    setDoor({
      title,
      body: `The act itself lands with ${owner}. This door is the placement being judged.`,
    });

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 54,
          paddingHorizontal: 16,
          paddingBottom: insets.bottom + 32,
          gap: 10,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Identity + the shared profile facts (§25.2). */}
        <View style={styles.head}>
          <InitialsDisc initials={s.initials} size={54} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.name}>{s.name}</Text>
            <Text style={styles.meta}>
              {detail.profile.handedness} · {s.handicapLabel} · {detail.profile.age}
            </Text>
            <Text style={styles.metaSoft} numberOfLines={1}>
              Goals: {detail.profile.goals.join(" · ")}
            </Text>
          </View>
          <Pressable
            testID="student-chat"
            accessibilityRole="button"
            accessibilityLabel={`Message ${s.name}`}
            onPress={() => navigation.navigate("InstructorThread", { studentId: s.id })}
            style={({ pressed }) => [styles.chatDoor, pressed && styles.doorPressed]}
          >
            <MessageSquare size={19} color={t.onDark} strokeWidth={2.3} />
            {s.unread > 0 && <View style={styles.unreadDot} />}
          </Pressable>
        </View>

        {/* §28 — the current plan, or its create door. */}
        {detail.plan ? (
          <Panel radius="feature" style={styles.card}>
            <View style={styles.cardHead}>
              <Eyebrow>Plan</Eyebrow>
              <Tag label={`${detail.plan.milestonesDone}/${detail.plan.milestones} milestones`} variant="neutral" compact />
            </View>
            <Text style={styles.cardTitle}>{detail.plan.name}</Text>
            <View style={styles.planTrack}>
              <View style={[styles.planFill, { width: `${detail.plan.progressPct}%` }]} />
            </View>
            <Text style={styles.metaSoft}>{detail.plan.frequency}</Text>
          </Panel>
        ) : (
          <Panel radius="feature" style={styles.card}>
            <Eyebrow>Plan</Eyebrow>
            <Text style={styles.metaSoft}>No improvement plan yet.</Text>
            <Button
              label="Create a plan"
              variant="ghost"
              onPress={() => reviewDoor("Create a plan", "the collaboration track (§28)")}
            />
          </Panel>
        )}

        {/* Measured progress — small, chosen, never a dump. */}
        <Panel radius="feature" style={styles.card}>
          <Eyebrow>Progress</Eyebrow>
          {detail.progress.map((p) => (
            <View key={p.metric} style={styles.progressRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.progressMetric}>{p.metric}</Text>
                <Text style={[styles.progressDelta, { color: p.direction === "down" ? t.bad : t.good }]}>
                  {p.deltaLabel}
                </Text>
              </View>
              <View style={styles.spark}>
                {p.series.map((v, i) => {
                  const max = Math.max(...p.series);
                  const min = Math.min(...p.series);
                  const h = max === min ? 0.6 : (v - min) / (max - min);
                  return (
                    <View
                      key={i}
                      style={[styles.sparkBar, { height: 6 + h * 22 }, i === p.series.length - 1 && { backgroundColor: t.aqua }]}
                    />
                  );
                })}
              </View>
            </View>
          ))}
        </Panel>

        {/* Analysed swings + the §25.3 review chrome doors. */}
        <ListSectionLabel>Recent swings</ListSectionLabel>
        {detail.swings.map((swing) => (
          <View key={swing.id} style={styles.swingRow}>
            <Text style={[styles.swingScore, swing.lowConfidence && { color: t.muted }]}>
              {swing.score}
            </Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.swingTitle}>
                {swing.club}
                {swing.lowConfidence ? " · low confidence" : ""}
              </Text>
              <Text style={styles.metaSoft}>{swing.ageLabel} ago · analysed</Text>
            </View>
            <View style={styles.swingActions}>
              <ReviewGlyph
                testID={`swing-review-${swing.id}`}
                label="Mark reviewed"
                onPress={() => reviewDoor("Mark as reviewed", "the relationships track (§25.3)")}
              >
                <CheckCheck size={16} color={t.textSoft} strokeWidth={2.3} />
              </ReviewGlyph>
              <ReviewGlyph
                testID={`swing-annotate-${swing.id}`}
                label="Annotate"
                onPress={() => reviewDoor("Annotate", "the collaboration track (§26)")}
              >
                <PenLine size={16} color={t.textSoft} strokeWidth={2.3} />
              </ReviewGlyph>
              <ReviewGlyph
                testID={`swing-lesson-${swing.id}`}
                label="Record a lesson"
                onPress={() => reviewDoor("Record a lesson", "the video-lessons track (D60)")}
              >
                <Video size={16} color={t.textSoft} strokeWidth={2.3} />
              </ReviewGlyph>
            </View>
          </View>
        ))}

        {/* Drills — the honesty split is the design (§18.5). */}
        <ListSectionLabel>Assigned drills</ListSectionLabel>
        <Panel radius="feature" style={styles.card}>
          {detail.drills.map((d) => (
            <View key={d.drillId} style={styles.drillRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.swingTitle}>{d.name}</Text>
                <Text style={styles.metaSoft}>
                  {d.checkedReps} camera-checked reps
                  {d.selfReportedDone > 0 ? ` · ${d.selfReportedDone} self-reported` : ""}
                </Text>
              </View>
              <Text style={[styles.compliance, d.compliancePct < 50 && { color: t.bad }]}>
                {d.compliancePct}%
              </Text>
            </View>
          ))}
          <Button
            label="Assign a drill"
            variant="ghost"
            onPress={() => navigation.navigate("DrillLibrary")}
          />
        </Panel>

        {/* Focus — the 3-slot rule made visible, slots-full state included. */}
        <ListSectionLabel>Focus areas</ListSectionLabel>
        <Panel radius="feature" style={styles.card}>
          {detail.focusSlots.map((slot) => (
            <View key={slot.name} style={styles.drillRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.swingTitle}>{slot.name}</Text>
                <Text style={styles.metaSoft}>
                  {slot.assignedBy === "you"
                    ? "Assigned by you"
                    : slot.assignedBy === "ai"
                      ? "AI proposed"
                      : "Self-set"}{" "}
                  · {slot.progressLabel}
                </Text>
              </View>
            </View>
          ))}
          {slotsFull ? (
            <Text style={styles.slotsFull}>
              All 3 focus slots are taken — a new focus replaces one, and {s.name.split(" ")[0]} can
              decline the change.
            </Text>
          ) : (
            <Button
              label="Assign a focus"
              variant="ghost"
              onPress={() => reviewDoor("Assign a focus", "goal-progression (§16.3.2)")}
            />
          )}
        </Panel>

        {/* Private notes — the instructor's own, never shared (§25.4). */}
        <ListSectionLabel>Private notes</ListSectionLabel>
        <Panel radius="feature" style={styles.card}>
          {detail.privateNotes.map((note) => (
            <Text key={note} style={styles.note}>
              {note}
            </Text>
          ))}
        </Panel>

        <ListGroup>
          <ListRow
            testID="end-relationship"
            title="End this relationship"
            subtitle="History is kept, read-only, for both of you"
            onPress={() => reviewDoor("End the relationship", "the relationships track (§24.2)")}
          />
        </ListGroup>
      </ScrollView>

      <Sheet
        visible={door != null}
        onClose={() => setDoor(null)}
        title={door?.title ?? ""}
        subtitle="Mocked — nothing is wired yet"
        testID="review-door-sheet"
      >
        <Text style={styles.doorBody}>{door?.body}</Text>
      </Sheet>

      <FloatingBack onPress={() => navigation.goBack()} />
    </View>
  );
}

function ReviewGlyph({
  children,
  label,
  onPress,
  testID,
}: {
  children: ReactNode;
  label: string;
  onPress: () => void;
  testID?: string;
}) {
  const styles = useStyles();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [styles.glyph, pressed && styles.glyphPressed]}
    >
      {children}
    </Pressable>
  );
}

const useStyles = themedStyles((t) => ({
  root: { flex: 1, backgroundColor: t.bg },
  head: { flexDirection: "row", alignItems: "center", gap: 12 },
  name: { color: t.text, fontFamily: FONT_DISPLAY.bold, fontSize: 19 },
  meta: { color: t.textSoft, fontFamily: FONT_BODY.regular, fontSize: 12.5 },
  metaSoft: { color: t.muted, fontFamily: FONT_BODY.regular, fontSize: 11.5, lineHeight: 16 },
  chatDoor: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: t.cobalt,
  },
  doorPressed: { backgroundColor: t.cobaltPressed },
  unreadDot: {
    position: "absolute",
    top: 3,
    right: 3,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: t.aqua,
  },
  card: { padding: 16, gap: 8 },
  cardHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cardTitle: { color: t.text, fontFamily: FONT_BODY.semiBold, fontSize: 14.5 },
  planTrack: { height: 6, borderRadius: 3, backgroundColor: t.surface2, overflow: "hidden" },
  planFill: { height: 6, borderRadius: 3, backgroundColor: t.aqua },
  progressRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  progressMetric: { color: t.text, fontFamily: FONT_BODY.semiBold, fontSize: 13 },
  progressDelta: { fontFamily: FONT_BODY.regular, fontSize: 11.5 },
  spark: { flexDirection: "row", alignItems: "flex-end", gap: 3, height: 30 },
  sparkBar: { width: 7, borderRadius: 2, backgroundColor: t.surface3 },
  swingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: t.surface,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  swingScore: { color: t.aqua, fontFamily: FONT_DISPLAY.bold, fontSize: 20, width: 34 },
  swingTitle: { color: t.text, fontFamily: FONT_BODY.semiBold, fontSize: 13 },
  swingActions: { flexDirection: "row", gap: 4 },
  glyph: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: t.surface2,
  },
  glyphPressed: { backgroundColor: t.surface3 },
  drillRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 3 },
  compliance: { color: t.good, fontFamily: FONT_DISPLAY.bold, fontSize: 15 },
  slotsFull: { color: t.muted, fontFamily: FONT_BODY.regular, fontSize: 11.5, lineHeight: 17 },
  note: { color: t.textSoft, fontFamily: FONT_BODY.regular, fontSize: 12.5, lineHeight: 18 },
  doorBody: {
    color: t.textSoft,
    fontFamily: FONT_BODY.regular,
    fontSize: 13,
    lineHeight: 19,
    paddingBottom: 8,
  },
}));
