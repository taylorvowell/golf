import { useEffect, useRef } from "react";
import { ActivityIndicator, Animated, StyleSheet, Text, View } from "react-native";
import { CircleCheck } from "lucide-react-native";

import { FONT_BODY, FONT_DISPLAY } from "../../design/system/typography";
import { useTheme } from "../../theme";

/**
 * The just-ended session landing in the Swing Log (Taylor, step-03 iteration): a "Saving
 * session…" beat, then the card springs in — a small rise + scale so the log visibly
 * RECEIVES the session rather than already containing it.
 *
 * UI phase: the card is synthetic (no session row persists yet) and lives only for this
 * screen visit; step 05 replaces the synthesis with the real row and keeps the entrance.
 */

export interface SessionArrivalCardProps {
  phase: "saving" | "landed";
  title: string;
  swings: number;
}

export function SessionArrivalCard({ phase, title, swings }: SessionArrivalCardProps) {
  const t = useTheme();
  const enter = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (phase !== "landed") return;
    Animated.spring(enter, {
      toValue: 1,
      damping: 16,
      stiffness: 210,
      mass: 0.8,
      useNativeDriver: true,
    }).start();
  }, [enter, phase]);

  if (phase === "saving") {
    return (
      <View style={[styles.card, { backgroundColor: t.surface }]} testID="session-saving">
        <ActivityIndicator size="small" color={t.cobalt} />
        <Text style={[styles.savingText, { color: t.muted }]}>Saving session…</Text>
      </View>
    );
  }

  return (
    <Animated.View
      testID="session-arrival"
      style={[
        styles.card,
        // Selection voice, not an outline: the landed card sits on the tinted fill.
        { backgroundColor: t.surfaceBlue },
        {
          opacity: enter,
          transform: [
            { translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [26, 0] }) },
            { scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) },
          ],
        },
      ]}
    >
      <CircleCheck size={20} color={t.good} strokeWidth={2.4} />
      <View style={styles.body}>
        <Text style={[styles.title, { color: t.text }]} numberOfLines={1}>
          {title}
        </Text>
        <Text style={[styles.meta, { color: t.muted }]}>
          {`${swings} swing${swings === 1 ? "" : "s"} · Just now`}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    borderRadius: 14,
    marginBottom: 12,
  },
  savingText: { fontFamily: FONT_BODY.regular, fontSize: 13 },
  body: { flex: 1, gap: 2 },
  title: { fontFamily: FONT_DISPLAY.extraBold, fontSize: 15 },
  meta: { fontFamily: FONT_BODY.regular, fontSize: 12 },
});
