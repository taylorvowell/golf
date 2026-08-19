import { useEffect, useState } from "react";
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
  /** 0 swings → "Cancel" (nothing is stored); >0 → the same slot reads "End". */
  hasSwings: boolean;
  onCancel: () => void;
  onRecord: () => void;
  onStop: () => void;
  onDelayChange: (delay: RecordingDelay) => void;
  /** Abort the countdown but STAY on the capture screen — Stop's exit mid-countdown. */
  onDisarm: () => void;
  /** Leave the held countdown entirely — back to the swing being reviewed, or to plain capture. */
  onAbort: () => void;
  onTypeChange: (sessionType: SessionType) => void;
  onOpenSettings: () => void;
}

export function SessionDock({
  mode,
  delaySeconds,
  sessionType,
  typeLocked,
  hasSwings,
  onCancel,
  onRecord,
  onStop,
  onDelayChange,
  onDisarm,
  onAbort,
  onTypeChange,
  onOpenSettings,
}: SessionDockProps) {
  const insets = useSafeAreaInsets();
  const [delayOpen, setDelayOpen] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);
  /**
   * Stop was pressed DURING a countdown (Taylor, step-03 iteration). The countdown ends, the
   * centre turns back into a red Record, and the screen stays exactly where it is with two
   * controls at the foot — cancel out, or change the delay and go again. Interrupting a
   * countdown almost always means "not yet", not "not at all", and snapping back to full chrome
   * loses the thing the golfer was in the middle of.
   */
  const [holding, setHolding] = useState(false);
  const modeLabel = MODES.find((m) => m.type === sessionType)?.label ?? "Analysis";
  const busy = mode !== "idle";
  /** The held state only — a running countdown shows nothing but its own timer and Stop. */
  const counting = holding;
  // In an effect, never the render body — a state write during render is the rule this repo
  // keeps for refs and it applies doubly to setState.
  useEffect(() => {
    if (mode === "recording") setHolding(false);
  }, [mode]);

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
                  style={[styles.modeOption, active && styles.delayOptionActive]}
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

      {counting ? (
        <>
          {/* Subtle, white, over the footage — the countdown strips the bar's own controls, so
              these two are the only things on screen besides the swing and the timer. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel the countdown"
            onPress={() => {
              setHolding(false);
              setDelayOpen(false);
              onAbort();
            }}
            style={({ pressed }) => [
              styles.corner,
              { left: 18, bottom: insets.bottom + 16 },
              pressed && styles.cornerPressed,
            ]}
            testID="countdown-cancel"
          >
            <X size={22} color="rgba(255,255,255,0.9)" strokeWidth={2.2} />
            <Text style={styles.cornerLabel}>Cancel</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Change the recording delay"
            onPress={() => setDelayOpen((open) => !open)}
            style={({ pressed }) => [
              styles.corner,
              { right: 18, bottom: insets.bottom + 16 },
              pressed && styles.cornerPressed,
            ]}
            testID="countdown-delay"
          >
            <Timer size={22} color="rgba(255,255,255,0.9)" strokeWidth={2.2} />
            <Text style={styles.cornerLabel}>
              {delaySeconds === 0 ? "No delay" : `${delaySeconds}s delay`}
            </Text>
          </Pressable>
        </>
      ) : null}

      <SessionNav
        sidesHidden={busy || counting}
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
        center={
          <SessionRecordButton
            stop={busy}
            label={busy ? "Stop" : "Record Swing"}
            onPress={
              // Interrupting a countdown means "not yet" ONLY once the session is underway
              // (Taylor, step-03 iteration): mid-session there is a swing to go back to, so the
              // screen holds and offers the two ways on. On the FIRST swing there is no session
              // yet — stopping is just backing out, and it returns to the new-session screen.
              mode === "countdown" && hasSwings
                ? () => {
                    onDisarm();
                    setHolding(true);
                  }
                : busy
                ? onStop
                : () => {
                    setHolding(false);
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
    backgroundColor: "rgba(16,28,50,0.96)",
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
    backgroundColor: "rgba(16,28,50,0.96)",
    zIndex: 2,
  },
  // Subtle corner controls over the footage: a white glyph over a small white word, no fill.
  corner: { position: "absolute", alignItems: "center", gap: 4, padding: 6 },
  cornerLabel: {
    color: "rgba(255,255,255,0.85)",
    fontFamily: FONT_DISPLAY.black,
    fontSize: 9,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  cornerPressed: { opacity: 0.6 },
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
  delayOptionActive: { backgroundColor: COLORS.aqua },
  delayOptionText: {
    color: "rgba(255,255,255,0.8)",
    fontFamily: FONT_DISPLAY.black,
    fontSize: 11,
  },
  delayOptionTextActive: { color: COLORS.onAqua },
});
