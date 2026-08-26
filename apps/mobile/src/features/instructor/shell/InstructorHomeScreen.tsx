import { Pressable, ScrollView, Text, View } from "react-native";
import { CircleAlert, Dumbbell, Moon, Search, Trophy } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  AppHeader,
  APP_HEADER_BAR,
  Eyebrow,
  ListSectionLabel,
  Panel,
  WAVE_NAV_CLEARANCE,
  useChromeScroll,
} from "../../../design/system";
import { FONT_BODY, FONT_DISPLAY } from "../../../design/system/typography";
import { useAppNavigation } from "../../../navigation";
import { themedStyles, useTheme } from "../../../theme";
import { useEntitlement } from "../../billing/entitlement";
import { ModeSwitch } from "../../mode/ModeSwitch";
import { InitialsDisc } from "../components/InitialsDisc";
import { useTriageSeam } from "../mock/seams";
import type { TriageItem } from "../mock/types";

/**
 * The instructor dashboard — the TRIAGE surface (architecture §4a.1, the separating feature):
 * every student swing arrives pre-analysed, so this queue sorts by what CHANGED — a review
 * request, a measured regression, drills going undone, a student gone quiet — never by upload
 * order. A working screen, not a brochure: every card is an act (tap → that student).
 *
 * Mocked (step 04): renders `useTriageSeam` only. The relationships track's server rollups
 * replace the seam; this screen does not change.
 */

const KIND_GLYPH: Record<TriageItem["kind"], typeof Search> = {
  review_request: Search,
  regression: CircleAlert,
  compliance: Dumbbell,
  quiet: Moon,
  goal: Trophy,
};

export function InstructorHomeScreen() {
  const t = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const navigation = useAppNavigation();
  const { onScroll: onChromeScroll, chromePx } = useChromeScroll();
  const { items, feed } = useTriageSeam();
  const { instructor } = useEntitlement();

  const openStudent = (studentId: string) => navigation.navigate("StudentDetail", { studentId });

  return (
    <View style={styles.root}>
      <ScrollView
        onScroll={(e) => onChromeScroll(e.nativeEvent.contentOffset.y)}
        scrollEventThrottle={16}
        contentContainerStyle={{
          paddingTop: insets.top + APP_HEADER_BAR + 10,
          paddingHorizontal: 16,
          paddingBottom: WAVE_NAV_CLEARANCE + insets.bottom + 24,
          gap: 10,
        }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>Needs your eye</Text>

        {items.length === 0 && (
          <Panel radius="feature" style={styles.emptyCard}>
            <Eyebrow>All caught up</Eyebrow>
            <Text style={styles.emptyCopy}>
              Nothing needs you right now. New review requests, regressions and quiet students
              land here the moment they happen.
            </Text>
          </Panel>
        )}

        {items.map((item) => {
          const Glyph = KIND_GLYPH[item.kind];
          const alert = item.kind === "regression" || item.kind === "compliance";
          return (
            <Pressable
              key={item.id}
              testID={`triage-${item.id}`}
              accessibilityRole="button"
              accessibilityLabel={`${item.studentName}: ${item.title}`}
              onPress={() => openStudent(item.studentId)}
              style={({ pressed }) => [styles.triageCard, pressed && styles.cardPressed]}
            >
              <InitialsDisc initials={item.initials} size={38} />
              <View style={styles.triageBody}>
                <View style={styles.triageTitleRow}>
                  <Glyph
                    size={13}
                    color={alert ? t.bad : item.kind === "goal" ? t.good : t.aqua}
                    strokeWidth={2.4}
                  />
                  <Text style={styles.triageTitle} numberOfLines={1}>
                    {item.title}
                  </Text>
                </View>
                <Text style={styles.triageDetail} numberOfLines={1}>
                  {item.studentName} · {item.detail}
                </Text>
              </View>
              <Text style={styles.age}>{item.ageLabel}</Text>
            </Pressable>
          );
        })}

        {feed.length > 0 && (
          <>
            <ListSectionLabel>Latest swings, analysed</ListSectionLabel>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8, paddingRight: 8 }}
            >
              {feed.map((swing) => (
                <Pressable
                  key={swing.id}
                  testID={`feed-${swing.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${swing.studentName}, ${swing.club}, scored ${swing.score}`}
                  onPress={() => openStudent(swing.studentId)}
                  style={({ pressed }) => [styles.feedCard, pressed && styles.cardPressed]}
                >
                  <View style={styles.feedTop}>
                    <InitialsDisc initials={swing.initials} size={26} />
                    <Text
                      style={[styles.feedScore, swing.lowConfidence && { color: t.muted }]}
                    >{`${swing.score}`}</Text>
                  </View>
                  <Text style={styles.feedName} numberOfLines={1}>
                    {swing.studentName}
                  </Text>
                  <Text style={styles.feedMeta} numberOfLines={1}>
                    {swing.club} · {swing.ageLabel}
                    {swing.lowConfidence ? " · low confidence" : ""}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </>
        )}

        {/* The membership upsell — free-membership instructors only, one quiet card. */}
        {instructor?.membership === "free" && (
          <Pressable
            testID="home-membership-upsell"
            accessibilityRole="button"
            accessibilityLabel="See Instructor Gold"
            onPress={() => navigation.navigate("Membership")}
            style={({ pressed }) => [styles.upsell, pressed && styles.cardPressed]}
          >
            <Eyebrow>Instructor Gold</Eyebrow>
            <Text style={styles.upsellCopy}>
              A full roster, broadcasts, video lessons — and Pro for your own game, included.
            </Text>
          </Pressable>
        )}
      </ScrollView>
      <AppHeader
        chromePx={chromePx}
        onProfile={() => navigation.navigate("Profile")}
        modeSwitch={<ModeSwitch />}
      />
    </View>
  );
}

const useStyles = themedStyles((t) => ({
  root: { flex: 1, backgroundColor: t.bg },
  title: { color: t.text, fontFamily: FONT_DISPLAY.bold, fontSize: 21, marginBottom: 2 },
  emptyCard: { padding: 18, gap: 6 },
  emptyCopy: { color: t.textSoft, fontFamily: FONT_BODY.regular, fontSize: 13, lineHeight: 19 },
  triageCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    backgroundColor: t.surface,
    borderRadius: 18,
    paddingHorizontal: 13,
    paddingVertical: 12,
  },
  cardPressed: { backgroundColor: t.surface2 },
  triageBody: { flex: 1, gap: 2 },
  triageTitleRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  triageTitle: { color: t.text, fontFamily: FONT_BODY.semiBold, fontSize: 13.5, flexShrink: 1 },
  triageDetail: { color: t.muted, fontFamily: FONT_BODY.regular, fontSize: 11.5 },
  age: { color: t.muted2, fontFamily: FONT_BODY.regular, fontSize: 10.5 },
  feedCard: {
    width: 148,
    backgroundColor: t.surface,
    borderRadius: 16,
    padding: 12,
    gap: 4,
  },
  feedTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  feedScore: { color: t.aqua, fontFamily: FONT_DISPLAY.bold, fontSize: 18 },
  feedName: { color: t.text, fontFamily: FONT_BODY.semiBold, fontSize: 12.5 },
  feedMeta: { color: t.muted, fontFamily: FONT_BODY.regular, fontSize: 10.5 },
  upsell: { backgroundColor: t.surfaceBlue, borderRadius: 18, padding: 16, gap: 5, marginTop: 4 },
  upsellCopy: { color: t.textSoft, fontFamily: FONT_BODY.regular, fontSize: 12.5, lineHeight: 18 },
}));
