import { Pressable, StyleSheet, Text, View } from "react-native";

import { FONT_DISPLAY } from "../../design/system/typography";
import { COLORS } from "../../theme";
import { DualViewIcon } from "../../design/system/DualViewIcon";
import { CONTROL_EDGE } from "./controlEdge";

/**
 * Dual Sync (Taylor, step-03 iteration) — the door to filming one swing from two angles.
 *
 * Sits on the far right edge, opposite this phone's own controls, and is built to the
 * DTL/Front switcher's exact segment metrics so the two read as one system across the
 * screen. Active state is the switcher's: an aqua fill, never an edge.
 *
 * UI phase: opens the sync sheet, which is unwired. `paired` is the seam the
 * `dual-device-capture` track fills in.
 */

export interface DualSyncButtonProps {
  /** True once a second camera is connected — the switcher's selected treatment. */
  paired?: boolean;
  onPress: () => void;
}

export function DualSyncButton({ paired = false, onPress }: DualSyncButtonProps) {
  const ink = paired ? COLORS.onAqua : "rgba(255,255,255,0.8)";
  return (
    <View style={styles.track}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dual sync — film with a second phone"
        accessibilityState={{ selected: paired }}
        onPress={onPress}
        style={({ pressed }) => [
          styles.segment,
          paired && styles.segmentActive,
          pressed && styles.pressed,
        ]}
        testID="capture-dual-sync"
      >
        <DualViewIcon size={20} color={ink} strokeWidth={1} />
        <Text style={[styles.label, { color: ink }]}>Dual View</Text>
      </Pressable>
    </View>
  );
}

// Deliberately mirrors ViewToggle's metrics — edit both or neither.
const styles = StyleSheet.create({
  track: {
    padding: 3,
    borderRadius: 16,
    backgroundColor: "rgba(11,16,28,0.66)",
    ...CONTROL_EDGE,
  },
  segment: {
    minWidth: 46,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 5,
    paddingHorizontal: 7,
    gap: 1,
  },
  segmentActive: { backgroundColor: COLORS.aqua },
  label: {
    fontFamily: FONT_DISPLAY.black,
    fontSize: 9,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  pressed: { opacity: 0.6 },
});
