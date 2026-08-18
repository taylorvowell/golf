import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ChevronDown } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FONT_BODY, FONT_DISPLAY } from "../design/system/typography";
import { useAppNavigation } from "../navigation";
import { COLORS } from "../theme";

/**
 * Record — the capture surface's frame, before capture exists.
 *
 * The bar's biggest button has to lead somewhere honest: this says capture is coming and spends
 * the space on the one thing a golfer can act on today — how to film a swing the analyzer will
 * score well. The tips are the analyzer's real requirements, not filler; when the capture flow
 * lands it replaces the body of this screen and inherits the checklist as its setup guidance.
 *
 * Fixed dark (`COLORS`): capture is a video-facing surface and keeps its own light in both
 * themes, the same rule that pins the player.
 */

const TIPS: Array<{ title: string; detail: string }> = [
  { title: "Film down the line", detail: "Camera behind your hands, looking at the target." },
  { title: "Phone at hand height", detail: "Waist-high and level — not on the ground." },
  { title: "Whole swing in frame", detail: "Head to ball, with room for the club at the top." },
  { title: "60 fps if you can", detail: "Impact is two frames at 30 — settings → camera." },
  { title: "Steady the phone", detail: "A tripod or a bag beats a shaky hand." },
];

export function RecordScreen() {
  const navigation = useAppNavigation();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
      <Pressable
        testID="record-close"
        accessibilityRole="button"
        accessibilityLabel="Close"
        onPress={() => navigation.goBack()}
        hitSlop={10}
        style={({ pressed }) => [styles.close, pressed && styles.pressed]}
      >
        <ChevronDown size={20} color={COLORS.text} strokeWidth={2.5} />
      </Pressable>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 32 + insets.bottom }]}>
        <Text style={styles.title}>Record a swing</Text>
        <Text style={styles.sub}>
          In-app capture arrives with the capture release — 60&nbsp;fps, multi-phone sync, straight
          into analysis. Until then, film with your camera app and your swings are ready the moment
          upload lands.
        </Text>

        <View style={styles.card}>
          <Text style={styles.tag}>Filming checklist</Text>
          {TIPS.map((tip) => (
            <View key={tip.title} style={styles.tipRow}>
              <View style={styles.tipDot} />
              <View style={styles.tipBody}>
                <Text style={styles.tipTitle}>{tip.title}</Text>
                <Text style={styles.tipDetail}>{tip.detail}</Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  close: { paddingHorizontal: 20, paddingVertical: 8, alignSelf: "flex-start" },
  pressed: { opacity: 0.6 },
  content: { paddingHorizontal: 20, paddingTop: 8, gap: 14 },
  title: {
    color: COLORS.text,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 28,
    lineHeight: 29,
    letterSpacing: -0.56,
  },
  sub: { color: COLORS.muted, fontFamily: FONT_BODY.regular, fontSize: 13, lineHeight: 20 },
  card: {
    borderRadius: 14,
    backgroundColor: COLORS.panel,
    padding: 18,
    gap: 12,
    marginTop: 6,
  },
  tag: {
    color: COLORS.muted,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 10,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  tipRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  tipDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: COLORS.aqua, marginTop: 6 },
  tipBody: { flex: 1, gap: 1 },
  tipTitle: { color: COLORS.text, fontFamily: FONT_DISPLAY.extraBold, fontSize: 14 },
  tipDetail: {
    color: COLORS.muted,
    fontFamily: FONT_BODY.regular,
    fontSize: 12,
    lineHeight: 17,
  },
});
