import { Pressable, StyleSheet, Text, View } from "react-native";
import { Info } from "lucide-react-native";

import { FONT_DISPLAY } from "../../design/system/typography";
import { COLORS } from "../../theme";
import type { SessionType } from "./sessionState";

/**
 * The session type: a large three-way segmented control with every option visible (D61) —
 * `Segmented`'s language sized up for a dark surface read at arm's length. Selection is
 * fill + text colour (borderless rule). Locked once the first swing exists: the pressables
 * stay for layout but announce disabled and drop their onPress.
 */

export const SESSION_TYPE_LABELS: Record<SessionType, string> = {
  swing_analysis: "Swing Analysis",
  practice_drills: "Practice Drills",
  video_only: "Video Only",
};

const ORDER: SessionType[] = ["swing_analysis", "practice_drills", "video_only"];

export interface SessionTypeToggleProps {
  value: SessionType;
  locked: boolean;
  onChange: (next: SessionType) => void;
  onInfo: () => void;
}

export function SessionTypeToggle({ value, locked, onChange, onInfo }: SessionTypeToggleProps) {
  return (
    <View style={styles.row}>
      <View accessibilityRole="tablist" style={styles.track}>
        {ORDER.map((type) => {
          const active = type === value;
          return (
            <Pressable
              key={type}
              accessibilityRole="tab"
              accessibilityLabel={SESSION_TYPE_LABELS[type]}
              accessibilityState={{ selected: active, disabled: locked }}
              disabled={locked}
              onPress={() => onChange(type)}
              style={[styles.segment, active && styles.segmentActive]}
              testID={`session-type-${type}`}
            >
              <Text style={[styles.label, active && styles.labelActive]} numberOfLines={2}>
                {SESSION_TYPE_LABELS[type]}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="About session types"
        onPress={onInfo}
        hitSlop={10}
        style={({ pressed }) => [styles.info, pressed && styles.pressed]}
        testID="session-type-info"
      >
        <Info size={16} color={COLORS.muted} strokeWidth={2.4} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  track: {
    flex: 1,
    flexDirection: "row",
    gap: 3,
    padding: 3,
    borderRadius: 12,
    backgroundColor: "rgba(11,16,28,0.6)",
  },
  segment: {
    flex: 1,
    minHeight: 46,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  segmentActive: { backgroundColor: COLORS.aqua },
  label: {
    color: "rgba(255,255,255,0.78)",
    fontFamily: FONT_DISPLAY.black,
    fontSize: 11,
    letterSpacing: 0.2,
    textAlign: "center",
    textTransform: "uppercase",
  },
  labelActive: { color: COLORS.onAqua },
  info: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  pressed: { opacity: 0.6 },
});
