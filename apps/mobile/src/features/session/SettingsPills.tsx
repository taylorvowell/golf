import { Pressable, StyleSheet, Text, View } from "react-native";

import { FONT_DISPLAY } from "../../design/system/typography";
import { COLORS } from "../../theme";
import type { SessionSettings } from "./sessionState";

/**
 * The at-a-glance settings row (D61): pills summarizing the session's active settings, plus
 * the recording-FPS pill. Any pill opens the settings sheet — the pills are a door, not a
 * second control surface.
 *
 * The FPS pill is Taylor's named exception to the instruments-stay-in-dev rule, and it is
 * honest by construction: it renders whatever the capture layer reports (stubbed at 60
 * until the wiring probes the real rate).
 */

export interface SettingsPillsProps {
  settings: SessionSettings;
  fps: number;
  onOpenSettings: () => void;
}

function pillLabels(s: SessionSettings): string[] {
  const labels: string[] = [];
  labels.push(s.delaySeconds === 0 ? "No delay" : `${s.delaySeconds}s delay`);
  labels.push(s.autoEndRecording ? "Auto-end" : "Manual stop");
  if (!s.aiAnalysis) labels.push("No AI analysis");
  if (s.aiAnalysis && !s.aiCoachTips) labels.push("Tips off");
  if (s.aiAnalysis && !s.aiCoachVoice) labels.push("Voice off");
  if (!s.videoReplay) labels.push("Replay off");
  return labels;
}

export function SettingsPills({ settings, fps, onOpenSettings }: SettingsPillsProps) {
  return (
    <View style={styles.row}>
      {pillLabels(settings).map((label) => (
        <Pressable
          key={label}
          accessibilityRole="button"
          accessibilityLabel={`${label} — session settings`}
          onPress={onOpenSettings}
          style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
        >
          <Text style={styles.pillText}>{label}</Text>
        </Pressable>
      ))}
      <View style={[styles.pill, styles.fpsPill]} accessible accessibilityLabel={`Recording at ${fps} frames per second`}>
        <Text style={[styles.pillText, styles.fpsText]}>{`${fps} FPS`}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "rgba(11,16,28,0.6)",
  },
  pressed: { opacity: 0.6 },
  pillText: {
    color: "rgba(255,255,255,0.82)",
    fontFamily: FONT_DISPLAY.black,
    fontSize: 9,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  fpsPill: { backgroundColor: "rgba(67,205,208,0.22)" },
  fpsText: { color: COLORS.aqua },
});
