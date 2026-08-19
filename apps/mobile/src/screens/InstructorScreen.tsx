import { Pressable, ScrollView, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { MapPin, MessageCircle } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Panel, TitleText, Eyebrow } from "../design/system";
import { FONT_BODY, FONT_DISPLAY } from "../design/system/typography";
import { useInstructor } from "../features/instructor/useInstructor";
import { useAppNavigation } from "../navigation";
import { themedStyles, useTheme } from "../theme";

/**
 * The Instructor page — a PLACEHOLDER while the instructor system is designed (coach-surface
 * step 02). One route serves both states: connected shows the instructor's details and the
 * chat door; not connected shows the find-a-local-instructor stub. Real directory, profiles
 * and messaging arrive with the instructor platform (the coach-relationships /
 * coach-collaboration tracks).
 */
export function InstructorScreen() {
  const instructor = useInstructor();
  const navigation = useAppNavigation();
  const insets = useSafeAreaInsets();
  const t = useTheme();
  const styles = useStyles();

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingBottom: 32 + insets.bottom }]}
    >
      {instructor ? (
        <>
          <LinearGradient
            colors={[t.aquaSoft, t.surfaceBlue]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.card}
          >
            <View style={styles.head}>
              <View style={styles.disc}>
                <Text style={styles.initials}>{instructor.initials}</Text>
              </View>
              <View style={styles.headText}>
                <Eyebrow>Your instructor</Eyebrow>
                <TitleText>{instructor.name}</TitleText>
              </View>
            </View>
            <Text style={styles.copy}>{instructor.blurb}</Text>
            <Pressable
              testID="instructor-open-chat"
              accessibilityRole="button"
              accessibilityLabel={`Message ${instructor.name}`}
              onPress={() => navigation.navigate("InstructorChat")}
              style={({ pressed }) => [styles.chatCta, pressed && styles.pressed]}
            >
              <MessageCircle size={16} color={t.onDark} strokeWidth={2.2} />
              <Text style={styles.chatCtaLabel}>Message instructor</Text>
            </Pressable>
          </LinearGradient>

          <Panel radius="feature" style={styles.block}>
            <Eyebrow>Coming with the instructor platform</Eyebrow>
            <Text style={styles.copy}>
              Lesson notes, swing reviews with frame-anchored feedback, video lessons, and the
              plans your instructor sets — all in one place, shared only with the swings you
              choose.
            </Text>
          </Panel>
        </>
      ) : (
        <Panel radius="feature" style={styles.card}>
          <View style={styles.heroIcon}>
            <MapPin size={24} color={t.lavender} strokeWidth={2} />
          </View>
          <TitleText>Find a local instructor</TitleText>
          <Text style={styles.copy}>
            The instructor directory opens with launch. You will browse verified instructors
            near you, connect one to your account, and stay in control of which swings they
            can see.
          </Text>
        </Panel>
      )}
    </ScrollView>
  );
}

/** Lavender at 16% — the same bed the profile drawer's inert tiles use. */
const LAVENDER_BED = "rgba(133,141,194,0.16)";

const useStyles = themedStyles((t) => ({
  root: { flex: 1, backgroundColor: t.bg },
  content: { padding: 16, gap: 12 },
  card: { padding: 18, borderRadius: 14, gap: 8 },
  block: { padding: 18, gap: 8 },
  head: { flexDirection: "row", alignItems: "center", gap: 12 },
  headText: { flex: 1, minWidth: 0, gap: 4 },
  disc: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: t.cobalt,
  },
  initials: {
    color: t.onDark,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 18,
    letterSpacing: 0.5,
  },
  heroIcon: {
    width: 46,
    height: 46,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: LAVENDER_BED,
    marginBottom: 4,
  },
  copy: { color: t.textSoft, fontFamily: FONT_BODY.regular, fontSize: 13, lineHeight: 20 },
  chatCta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 44,
    marginTop: 8,
    borderRadius: 12,
    backgroundColor: t.cobalt,
  },
  chatCtaLabel: {
    color: t.onDark,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 10,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  pressed: { opacity: 0.75 },
}));
