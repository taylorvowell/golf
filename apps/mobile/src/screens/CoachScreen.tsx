import { useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ChevronGlyph, PersonGlyph } from "../design/deck";
import { TopBar } from "../design/TopBar";
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
export function CoachScreen() {
  const navigation = useAppNavigation();
  const insets = useSafeAreaInsets();
  const { state } = useSwings();
  const t = useTheme();
  const styles = useStyles();

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
      <TopBar title="Coach" />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 32 + insets.bottom }]}>
        <View style={styles.card}>
          <View style={styles.heroIcon}>
            <PersonGlyph size={26} color={t.violet} />
          </View>
          <Text style={styles.title}>No coach yet</Text>
          <Text style={styles.copy}>
            Finding a coach opens with launch. Your coach will see the swings you share, scrub
            them frame by frame, and leave feedback anchored to the exact moment it is about —
            and you stay in control of what they can see.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.tag}>Meanwhile</Text>
          <Text style={styles.copy}>
            Every analysed swing already gets a full scorecard — what was detected, why it
            matters, and what to work on first.
          </Text>
          {latestScored ? (
            <Pressable
              testID="coach-latest-scorecard"
              accessibilityRole="button"
              accessibilityLabel="See your latest scorecard"
              onPress={() =>
                navigation.navigate("SwingDetail", { id: latestScored.id, afterSwing: true })
              }
              style={({ pressed }) => [styles.door, pressed && styles.pressed]}
            >
              <Text style={styles.doorText}>See your latest scorecard</Text>
              <ChevronGlyph size={9} color={t.accent} direction="right" weight={1.8} />
            </Pressable>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

const useStyles = themedStyles((t) => ({
  root: { flex: 1, backgroundColor: t.bg },
  content: { padding: 16, gap: 12 },
  card: {
    borderRadius: 22,
    backgroundColor: t.panel,
    padding: 18,
    gap: 8,
  },
  heroIcon: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: t.violetSoft,
    marginBottom: 4,
  },
  title: { color: t.text, fontSize: 21, fontWeight: "700", letterSpacing: -0.6 },
  tag: {
    color: t.muted,
    fontSize: 9,
    fontWeight: "600",
    letterSpacing: 1.6,
    textTransform: "uppercase",
  },
  copy: { color: t.muted, fontSize: 14, lineHeight: 21 },
  door: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 6,
    paddingTop: 13,
  },
  doorText: { color: t.accent, fontSize: 13.5, fontWeight: "700" },
  pressed: { opacity: 0.6 },
}));
