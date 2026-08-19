import { Pressable, StyleSheet, Text, View } from "react-native";

import { FONT_DISPLAY } from "../../design/system/typography";
import { COLORS } from "../../theme";
import type { CaptureView } from "./sessionState";

/**
 * DTL ↔ Front View (Taylor, step-03 iteration) — which angle the next swing is filmed
 * from. Sits on the RIGHT edge above the help orb; switching it also switches the
 * alignment ghost's pose. "Front View" is the golfer's phrase for the analyzer's
 * `face_on`.
 */

const OPTIONS: Array<{ view: CaptureView; label: string }> = [
  { view: "dtl", label: "DTL" },
  { view: "face_on", label: "Front" },
];

export interface ViewToggleProps {
  value: CaptureView;
  onChange: (view: CaptureView) => void;
}

export function ViewToggle({ value, onChange }: ViewToggleProps) {
  return (
    <View style={styles.track} accessibilityRole="tablist">
      {OPTIONS.map(({ view, label }) => {
        const active = view === value;
        return (
          <Pressable
            key={view}
            accessibilityRole="tab"
            accessibilityLabel={view === "dtl" ? "Down the line" : "Front view"}
            accessibilityState={{ selected: active }}
            onPress={() => onChange(view)}
            style={[styles.segment, active && styles.segmentActive]}
            testID={`capture-view-${view}`}
          >
            <Text style={[styles.label, active && styles.labelActive]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  // Positioned by the screen — the track only owns its own layout.
  track: {
    padding: 3,
    gap: 3,
    borderRadius: 999,
    backgroundColor: "rgba(11,16,28,0.66)",
  },
  segment: {
    minWidth: 52,
    minHeight: 34,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  segmentActive: { backgroundColor: COLORS.aqua },
  label: {
    color: "rgba(255,255,255,0.8)",
    fontFamily: FONT_DISPLAY.black,
    fontSize: 10,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  labelActive: { color: COLORS.onAqua },
});
