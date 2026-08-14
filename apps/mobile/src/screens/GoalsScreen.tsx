import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { themedStyles } from "../theme";

/**
 * Goals — honestly not built yet.
 *
 * Personalization (swing styles, curated goals, session focus) is a designed system on the
 * roadmap (D54), not a form to improvise here: a free-text goal nothing reads would be the
 * placeholder-toggle mistake at page size. Until then this page says what is coming and what
 * already works toward it, and the focus card on Home is the live piece of it.
 */
export function GoalsScreen() {
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingBottom: 32 + insets.bottom }]}
    >
      <View style={styles.card}>
        <Text style={styles.title}>Goals are on the way</Text>
        <Text style={styles.copy}>
          You&apos;ll pick a swing style to work toward, choose curated goals, and every session
          will get a focus that moves you there — with drills matched to what your swings
          actually show.
        </Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.tag}>Already working</Text>
        <Text style={styles.copy}>
          Home already recommends a focus for your next session from what recurred in your last
          one. Goals will steer that recommendation toward what you care about most.
        </Text>
      </View>
    </ScrollView>
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
  title: { color: t.text, fontSize: 21, fontWeight: "700", letterSpacing: -0.6 },
  tag: {
    color: t.muted,
    fontSize: 9,
    fontWeight: "600",
    letterSpacing: 1.6,
    textTransform: "uppercase",
  },
  copy: { color: t.muted, fontSize: 14, lineHeight: 21 },
}));
