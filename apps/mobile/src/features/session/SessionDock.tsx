import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Settings, Timer, Volume2, VolumeX, X } from "lucide-react-native";

import { FONT_DISPLAY } from "../../design/system/typography";
import { COLORS } from "../../theme";
import { SessionNav } from "./SessionNav";
import { SessionRecordButton } from "./SessionRecordButton";
import {
  RECORDING_DELAYS,
  type CaptureMode,
  type RecordingDelay,
} from "./sessionState";

/**
 * The capture screen's sticky bar (D61, reshaped by Taylor's step-03 feedback): the main
 * tab bar's wave construction with the big red Record Swing in the raised centre — always
 * dead-centre of the screen. During countdown and recording the side items fade out and
 * only the stop shows (`SessionNav`'s `sidesHidden`).
 *
 * The delay select is a small popover ABOVE the clock item, not a sheet: one tap deep,
 * four options, and closing it never costs the golfer their place.
 */

export interface SessionDockProps {
  mode: CaptureMode;
  delaySeconds: RecordingDelay;
  aiAudio: boolean;
  /** 0 swings → "Cancel" (nothing is stored); >0 → the same slot reads "End". */
  hasSwings: boolean;
  onCancel: () => void;
  onRecord: () => void;
  onStop: () => void;
  onDelayChange: (delay: RecordingDelay) => void;
  onToggleAiAudio: () => void;
  onOpenSettings: () => void;
}

export function SessionDock({
  mode,
  delaySeconds,
  aiAudio,
  hasSwings,
  onCancel,
  onRecord,
  onStop,
  onDelayChange,
  onToggleAiAudio,
  onOpenSettings,
}: SessionDockProps) {
  const insets = useSafeAreaInsets();
  const [delayOpen, setDelayOpen] = useState(false);
  const busy = mode !== "idle";

  return (
    <>
      {delayOpen && !busy ? (
        <View
          style={[styles.delayPopover, { bottom: insets.bottom + 108 }]}
          testID="delay-popover"
        >
          {RECORDING_DELAYS.map((d) => {
            const active = d === delaySeconds;
            return (
              <Pressable
                key={d}
                accessibilityRole="button"
                accessibilityLabel={d === 0 ? "No delay" : `${d} second delay`}
                accessibilityState={{ selected: active }}
                onPress={() => {
                  onDelayChange(d);
                  setDelayOpen(false);
                }}
                style={[styles.delayOption, active && styles.delayOptionActive]}
              >
                <Text style={[styles.delayOptionText, active && styles.delayOptionTextActive]}>
                  {d === 0 ? "Off" : `${d}s`}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <SessionNav
        sidesHidden={busy}
        leftItems={[
          {
            key: "cancel",
            label: hasSwings ? "End" : "Cancel",
            onPress: onCancel,
            testID: "session-cancel",
            icon: (c) => <X size={23} color={c} strokeWidth={2.2} />,
          },
          {
            key: "delay",
            label: delaySeconds === 0 ? "Off" : `${delaySeconds}s`,
            active: delayOpen,
            onPress: () => setDelayOpen((open) => !open),
            testID: "session-delay",
            icon: (c) => <Timer size={23} color={c} strokeWidth={2.2} />,
          },
        ]}
        rightItems={[
          {
            key: "ai-audio",
            label: "AI Audio",
            active: aiAudio,
            onPress: onToggleAiAudio,
            testID: "session-ai-audio",
            icon: (c) =>
              aiAudio ? (
                <Volume2 size={23} color={c} strokeWidth={2.2} />
              ) : (
                <VolumeX size={23} color={c} strokeWidth={2.2} />
              ),
          },
          {
            key: "settings",
            label: "Settings",
            onPress: onOpenSettings,
            testID: "session-settings",
            icon: (c) => <Settings size={23} color={c} strokeWidth={2.2} />,
          },
        ]}
        center={
          <SessionRecordButton
            stop={busy}
            label={busy ? "Stop" : "Record Swing"}
            onPress={busy ? onStop : onRecord}
            testID="session-record"
          />
        }
      />
    </>
  );
}

const styles = StyleSheet.create({
  // Sits over the clock item's side of the bar. Close-enough placement; tuned by eye.
  delayPopover: {
    position: "absolute",
    left: 52,
    width: 168,
    flexDirection: "row",
    gap: 4,
    padding: 5,
    borderRadius: 999,
    backgroundColor: "rgba(16,28,50,0.96)",
    zIndex: 2,
  },
  delayOption: {
    flex: 1,
    minHeight: 36,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  delayOptionActive: { backgroundColor: COLORS.aqua },
  delayOptionText: {
    color: "rgba(255,255,255,0.8)",
    fontFamily: FONT_DISPLAY.black,
    fontSize: 11,
  },
  delayOptionTextActive: { color: COLORS.onAqua },
});
