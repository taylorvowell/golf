import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { COLORS } from "../../theme";
import { formatPosition } from "./frames";

/**
 * Play/pause and frame stepping.
 *
 * Memoised and given no dependency on the current frame: the frame readout is its own component,
 * so a 60-per-second presented-frame callback re-renders one `Text` rather than six pressables.
 * That is not premature — the whole player is judged on what happens during playback.
 *
 * Controls are large and labelled with words rather than icon glyphs. §41's stated conditions are
 * bright sunlight and one hand; the icon set that belongs here arrives with the design system in
 * `mobile-app-shell` step 03, and guessing at it now would be a second copy to reconcile.
 */

export interface TransportProps {
  playing: boolean;
  disabled: boolean;
  onToggle: () => void;
  onStep: (delta: number) => void;
}

export const Transport = memo(function Transport({
  playing,
  disabled,
  onToggle,
  onStep,
}: TransportProps) {
  return (
    <View style={styles.row}>
      <Key label="−10" testID="step-back-10" disabled={disabled} onPress={() => onStep(-10)} />
      <Key label="−1" testID="step-back-1" disabled={disabled} onPress={() => onStep(-1)} />
      <Key
        label={playing ? "Pause" : "Play"}
        testID="play-toggle"
        wide
        disabled={disabled}
        onPress={onToggle}
      />
      <Key label="+1" testID="step-fwd-1" disabled={disabled} onPress={() => onStep(1)} />
      <Key label="+10" testID="step-fwd-10" disabled={disabled} onPress={() => onStep(10)} />
    </View>
  );
});

function Key({
  label,
  testID,
  onPress,
  disabled,
  wide = false,
}: {
  label: string;
  testID: string;
  onPress: () => void;
  disabled: boolean;
  wide?: boolean;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.key,
        wide && styles.keyWide,
        pressed && styles.keyPressed,
        disabled && styles.keyDisabled,
      ]}
    >
      <Text style={[styles.keyLabel, wide && styles.keyLabelOnFill]}>{label}</Text>
    </Pressable>
  );
}

/**
 * The position readout, split out precisely because it changes every frame.
 *
 * It shows the frame the transport is ON, which during a scrub is the requested frame — a readout
 * that lagged the finger by a decode would be the most visible thing on the screen.
 */
export function PositionReadout({ frame, fps }: { frame: number; fps: number }) {
  return (
    <Text testID="position-readout" style={styles.position}>
      {formatPosition(frame, fps)}
    </Text>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 8, alignItems: "center" },
  key: {
    flex: 1,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    backgroundColor: COLORS.panel,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  keyWide: { flex: 1.6, backgroundColor: COLORS.acid, borderColor: COLORS.acid },
  keyPressed: { opacity: 0.7 },
  keyDisabled: { opacity: 0.35 },
  keyLabel: { color: COLORS.text, fontSize: 15, fontWeight: "700" },
  // `acid` is a bright fill; the palette carries its one inverted pairing for exactly this.
  keyLabelOnFill: { color: COLORS.onAcid },
  position: {
    color: COLORS.muted,
    fontSize: 13,
    fontVariant: ["tabular-nums"],
  },
});
