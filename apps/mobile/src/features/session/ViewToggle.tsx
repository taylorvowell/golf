import { Pressable, StyleSheet, Text, View } from "react-native";

import { PoseOutline } from "../../design/system/PoseOutline";
import { FONT_DISPLAY } from "../../design/system/typography";
import { COLORS } from "../../theme";
import type { CaptureView } from "./sessionState";

/**
 * DTL ↔ Front View (Taylor, step-03 iteration) — which angle the next swing is filmed
 * from. Each segment carries its pose outline as the icon (the same art the alignment
 * guide draws) over a small label. Sits on the RIGHT edge above the help orb; switching it
 * also switches the guide's pose. "Front View" is the golfer's phrase for the analyzer's
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
        const ink = active ? COLORS.onAqua : "rgba(255,255,255,0.8)";
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
            <PoseOutline pose={view} width={22} height={24} color={ink} fill />
            <Text style={[styles.label, { color: ink }]}>{label}</Text>
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
    borderRadius: 18,
    backgroundColor: "rgba(11,16,28,0.66)",
  },
  segment: {
    minWidth: 56,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 6,
    paddingHorizontal: 10,
    gap: 2,
  },
  segmentActive: { backgroundColor: COLORS.aqua },
  label: {
    fontFamily: FONT_DISPLAY.black,
    fontSize: 9,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
});
