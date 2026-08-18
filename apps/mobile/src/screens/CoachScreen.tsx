import { useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { ChevronRight, UserRound } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  APP_HEADER_BAR,
  AppHeader,
  Eyebrow,
  Panel,
  TitleText,
  useChromeScroll,
} from "../design/system";
import { FONT_BODY, FONT_DISPLAY } from "../design/system/typography";
import { createdAtMs } from "../features/swings/sessions";
import { useSwings } from "../features/swings/useSwings";
import { useAppNavigation } from "../navigation";
import { themedStyles, useTheme } from "../theme";

/**
 * Coach — the human-coach tab, before the coach platform exists.
 *
 * Honest about the state: there is no marketplace to search yet, so no dead "Find a coach"
 * button pretending otherwise. What it does instead is name what a coach will get, and point at
 * the coaching that already works — the deterministic scorecard on every analysed swing. That
 * door is real: it opens the newest scored swing's after-swing view.
 */

/** Lavender at 16% — the coach voice's bed (the Tag pattern's named tint). */
const LAVENDER_BED = "rgba(133,141,194,0.16)";

export function CoachScreen() {
  const navigation = useAppNavigation();
  const insets = useSafeAreaInsets();
  const { state } = useSwings();
  const t = useTheme();
  const styles = useStyles();
  const onChromeScroll = useChromeScroll();

  // The newest scored swing — the "see it in action" door's target.
  const latestScored = useMemo(() => {
    if (state.kind !== "ok") return null;
    const scored = state.swings.filter(
      (s) => s.status === "ready" && typeof s.overallScore === "number",
    );
    if (!scored.length) return null;
    return scored.reduce((a, b) => (createdAtMs(a) >= createdAtMs(b) ? a : b));
  }, [state]);

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + APP_HEADER_BAR + 4, paddingBottom: 32 + insets.bottom },
        ]}
        onScroll={(e) => onChromeScroll(e.nativeEvent.contentOffset.y)}
        scrollEventThrottle={16}
      >
        <Text style={styles.title}>Coach</Text>
        <Panel radius="feature" style={styles.card}>
          <View style={styles.heroIcon}>
            <UserRound size={24} color={t.lavender} strokeWidth={2} />
          </View>
          <TitleText>No coach yet</TitleText>
          <Text style={styles.copy}>
            Finding a coach opens with launch. Your coach will see the swings you share, scrub
            them frame by frame, and leave feedback anchored to the exact moment it is about —
            and you stay in control of what they can see.
          </Text>
        </Panel>

        <Panel radius="feature" style={styles.card}>
          <Eyebrow>Meanwhile</Eyebrow>
          <Text style={styles.copy}>
            Every analysed swing already gets a full scorecard — what was detected, why it
            matters, and what to work on first.
          </Text>
          {latestScored ? (
            <Pressable
              testID="coach-latest-scorecard"
              accessibilityRole="button"
              accessibilityLabel="See your latest scorecard"
              onPress={() => navigation.navigate("SwingDetail", { id: latestScored.id })}
              style={({ pressed }) => [styles.door, pressed && styles.pressed]}
            >
              <Text style={styles.doorText}>See your latest scorecard</Text>
              <ChevronRight size={15} color={t.cobalt} strokeWidth={2.5} />
            </Pressable>
          ) : null}
        </Panel>
      </ScrollView>

      <AppHeader onProfile={() => navigation.navigate("Profile")} />
    </View>
  );
}

const useStyles = themedStyles((t) => ({
  root: { flex: 1, backgroundColor: t.bg },
  content: { padding: 16, gap: 12 },
  /* The screen's display title, in the flow now that the brand header floats above. */
  title: {
    color: t.text,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 30,
    lineHeight: 30,
    letterSpacing: -0.6,
    paddingHorizontal: 2,
  },
  card: { padding: 18, gap: 8 },
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
  door: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 6,
    paddingTop: 13,
  },
  doorText: {
    color: t.cobalt,
    fontFamily: FONT_DISPLAY.extraBold,
    fontSize: 13,
  },
  pressed: { opacity: 0.6 },
}));
