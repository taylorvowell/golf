import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Settings, SlidersHorizontal, Timer, X } from "lucide-react-native";

import { FONT_DISPLAY } from "../../design/system/typography";
import { COLORS } from "../../theme";
import { SessionNav } from "./SessionNav";
import { SessionRecordButton } from "./SessionRecordButton";
import {
  RECORDING_DELAYS,
  type CaptureMode,
  type RecordingDelay,
  type SessionType,
} from "./sessionState";

/**
 * The capture screen's sticky bar (D61, reshaped by Taylor's step-03 feedback): the main
 * tab bar's wave construction with the big red Record Swing in the raised centre — always
 * dead-centre of the screen. During countdown and recording the side items fade out and
 * only the stop shows (`SessionNav`'s `sidesHidden`).
 *
 * The delay and mode selects are small popovers ABOVE their item, not sheets: one tap deep,
 * a handful of options, and closing one never costs the golfer their place.
 *
 * Each item's LABEL says what the control is ("Delay", "Mode") and its current value rides on
 * the glyph as a badge or under it as a word (Taylor, step-03 iteration). A label that changed
 * to "3s" told you the value while hiding what it was the value OF, which is the thing you scan
 * a bar for. Session type moved here from the top of the screen for the same reason — it is a
 * control, and every other control is in the bar.
 */

/** Short enough for a popover; the full names live in the info sheet. */
const MODES: Array<{ type: SessionType; label: string }> = [
  { type: "swing_analysis", label: "Analysis" },
  { type: "practice_drills", label: "Drills" },
  { type: "video_only", label: "Video" },
];

export interface SessionDockProps {
  mode: CaptureMode;
  delaySeconds: RecordingDelay;
  sessionType: SessionType;
  /** A session is ONE type: the selector locks the moment the first swing exists. */
  typeLocked: boolean;
  onCancel: () => void;
  onRecord: () => void;
  onStop: () => void;
  onDelayChange: (delay: RecordingDelay) => void;
  onTypeChange: (sessionType: SessionType) => void;
  onOpenSettings: () => void;
  /** Seconds until the take stops itself, once inside the countdown window — null otherwise. */
  autoStopIn?: number | null;
}

export function SessionDock({
  mode,
  delaySeconds,
  sessionType,
  typeLocked,
  onCancel,
  onRecord,
  onStop,
  onDelayChange,
  onTypeChange,
  onOpenSettings,
  autoStopIn = null,
}: SessionDockProps) {
  const insets = useSafeAreaInsets();
  const [delayOpen, setDelayOpen] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);
  const modeLabel = MODES.find((m) => m.type === sessionType)?.label ?? "Analysis";
  const busy = mode !== "idle";
  const counting = mode === "countdown";

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
                style={({ pressed }) => [
                  styles.delayOption,
                  active && styles.delayOptionActive,
                  pressed && styles.optionPressed,
                ]}
              >
                <Text style={[styles.delayOptionText, active && styles.delayOptionTextActive]}>
                  {d === 0 ? "Off" : `${d}s`}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {modeOpen && !busy ? (
        <View
          style={[styles.modePopover, { bottom: insets.bottom + 108 }]}
          testID="mode-popover"
        >
          {MODES.map((m) => {
              const active = m.type === sessionType;
              return (
                <Pressable
                  key={m.type}
                  accessibilityRole="button"
                  accessibilityLabel={m.label}
                  accessibilityState={{ selected: active }}
                  onPress={() => {
                    onTypeChange(m.type);
                    setModeOpen(false);
                  }}
                  style={({ pressed }) => [
                    styles.modeOption,
                    active && styles.delayOptionActive,
                    pressed && styles.optionPressed,
                  ]}
                  testID={`session-mode-${m.type}`}
                >
                  <Text style={[styles.delayOptionText, active && styles.delayOptionTextActive]}>
                    {m.label}
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
            label: "Cancel",
            onPress: onCancel,
            testID: "session-cancel",
            icon: (c) => <X size={23} color={c} strokeWidth={2.2} />,
          },
          {
            key: "delay",
            label: "Delay",
            badge: delaySeconds === 0 ? "Off" : `${delaySeconds}s`,
            active: delayOpen,
            onPress: () => {
              setModeOpen(false);
              setDelayOpen((open) => !open);
            },
            testID: "session-delay",
            icon: (c) => <Timer size={23} color={c} strokeWidth={2.2} />,
          },
        ]}
        rightItems={[
          {
            key: "mode",
            label: "Mode",
            active: modeOpen,
            disabled: typeLocked,
            onPress: () => {
              setDelayOpen(false);
              setModeOpen((open) => !open);
            },
            testID: "session-mode",
            pill: modeLabel,
            icon: (c) => <SlidersHorizontal size={23} color={c} strokeWidth={2.2} />,
          },
          {
            key: "settings",
            label: "Settings",
            onPress: onOpenSettings,
            testID: "session-settings",
            icon: (c) => <Settings size={23} color={c} strokeWidth={2.2} />,
          },
        ]}
        // Directly above the stop button, where the thumb already is: a recording that simply
        // ends looks identical to one that failed, and the golfer is out at the ball where
        // they cannot read anything larger than a number (Taylor, 2026-08-21).
        centerAbove={
          autoStopIn != null ? (
            <View style={styles.autoStop} pointerEvents="none">
              <Text style={styles.autoStopText}>{`Stopping in ${autoStopIn}`}</Text>
            </View>
          ) : null
        }
        center={
          <SessionRecordButton
            stop={busy}
            // Before the camera rolls the button ABORTS; after it, it stops. Same tap, two
            // different promises, so they no longer wear the same face (Taylor, 2026-08-23).
            cancel={counting}
            label={counting ? "Cancel countdown" : busy ? "Stop" : "Record Swing"}
            onPress={
              // Stopping a countdown puts the golfer back where they came FROM (Taylor,
              // 2026-08-21). Mid-session that is the swing they were just looking at; on the
              // first swing of a session there is nothing behind it, so it is the capture
              // screen. The reducer already resolves which — this button only has to say
              // "stop". (It replaces a held-countdown state that offered two corner controls:
              // an extra decision in the one moment the golfer has already decided.)
              busy
                ? onStop
                : () => {
                    setDelayOpen(false);
                    onRecord();
                  }
            }
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
    backgroundColor: "rgba(14,35,56,0.96)",
    zIndex: 2,
  },
  // A single column ABOVE the item — three full words do not fit side by side, and stacked
  // options are the shape a golfer already expects a menu to have.
  modePopover: {
    position: "absolute",
    right: 44,
    width: 128,
    gap: 4,
    padding: 5,
    borderRadius: 18,
    backgroundColor: "rgba(14,35,56,0.96)",
    zIndex: 2,
  },
  modeOption: {
    minHeight: 36,
    borderRadius: 14,
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  delayOption: {
    flex: 1,
    minHeight: 36,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  autoStop: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "rgba(224,49,68,0.9)",
  },
  autoStopText: {
    color: "#FFFFFF",
    fontFamily: FONT_DISPLAY.black,
    fontSize: 11,
    letterSpacing: 0.4,
  },
  delayOptionActive: { backgroundColor: COLORS.aqua },
  // These float over the camera picture, so the press is a lift in the same glass.
  optionPressed: { opacity: 0.7 },
  delayOptionText: {
    color: "rgba(255,255,255,0.8)",
    fontFamily: FONT_DISPLAY.black,
    fontSize: 11,
  },
  delayOptionTextActive: { color: COLORS.onAqua },
});
