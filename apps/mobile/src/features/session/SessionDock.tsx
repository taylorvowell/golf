import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Settings, Timer, Volume2, VolumeX, X } from "lucide-react-native";

import { FONT_DISPLAY } from "../../design/system/typography";
import { COLORS } from "../../theme";
import { DockItem } from "./DockItem";
import {
  RECORDING_DELAYS,
  type CaptureMode,
  type RecordingDelay,
} from "./sessionState";

/**
 * The capture screen's sticky dock (D61): Cancel · delay clock · the big red Record Swing ·
 * AI audio · settings cog. Same glass-pill language as `SessionPillNav`, but the centre
 * carries the one control §41 says must dominate — the record button is the biggest target
 * on the screen and turns into Stop for the whole countdown + recording stretch.
 *
 * The delay select is a small popover ABOVE the clock item (the spec's words), not a sheet:
 * it is one tap deep, four options, and closing it must not cost the golfer their place.
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
  const [delayOpen, setDelayOpen] = useState(false);
  const busy = mode !== "idle";

  return (
    <View>
      {delayOpen ? (
        <View style={styles.delayPopover} testID="delay-popover">
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

      <View style={styles.dock}>
        <DockItem
          label={hasSwings ? "End" : "Cancel"}
          onPress={onCancel}
          testID="session-cancel"
          icon={<X size={17} color={COLORS.muted} strokeWidth={2.4} />}
        />
        <DockItem
          label={delaySeconds === 0 ? "Off" : `${delaySeconds}s`}
          onPress={() => setDelayOpen((open) => !open)}
          disabled={busy}
          active={delayOpen}
          testID="session-delay"
          icon={<Timer size={17} color={delayOpen ? COLORS.aqua : COLORS.muted} strokeWidth={2.4} />}
        />

        {/* The record / stop centre. */}
        <View style={styles.centerSlot}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={busy ? "Stop" : "Record swing"}
            onPress={busy ? onStop : onRecord}
            testID="session-record"
            style={({ pressed }) => [pressed && styles.pressed]}
          >
            <LinearGradient
              colors={busy ? ["#3A4358", "#2B3345"] : ["#F0546A", "#E03144"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.recordFace}
            >
              {busy ? (
                <View style={styles.stopSquare} />
              ) : (
                <View style={styles.recordRing} />
              )}
            </LinearGradient>
          </Pressable>
          <Text style={styles.centerLabel}>{busy ? "Stop" : "Record Swing"}</Text>
        </View>

        <DockItem
          label="AI Audio"
          onPress={onToggleAiAudio}
          active={aiAudio}
          testID="session-ai-audio"
          icon={
            aiAudio ? (
              <Volume2 size={17} color={COLORS.aqua} strokeWidth={2.4} />
            ) : (
              <VolumeX size={17} color={COLORS.muted} strokeWidth={2.4} />
            )
          }
        />
        <DockItem
          label="Settings"
          onPress={onOpenSettings}
          testID="session-settings"
          icon={<Settings size={17} color={COLORS.muted} strokeWidth={2.4} />}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    minHeight: 86,
    marginHorizontal: 14,
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(16,28,50,0.94)",
  },
  centerSlot: { width: 96, alignItems: "center", gap: 4, marginTop: -18 },
  recordFace: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: "center",
    justifyContent: "center",
  },
  // The idle face's inner ring and the busy face's square both DRAW the control's shape.
  recordRing: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 2.5,
    borderColor: "rgba(255,255,255,0.85)",
  },
  stopSquare: { width: 22, height: 22, borderRadius: 4, backgroundColor: "#FFFFFF" },
  centerLabel: {
    color: "rgba(255,255,255,0.85)",
    fontFamily: FONT_DISPLAY.black,
    fontSize: 8,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  pressed: { opacity: 0.6 },
  // Sits over the clock item's side of the dock. Exact centring over the item needs a
  // measured layout; close-enough is right for the stub and step 03 tunes it by eye.
  delayPopover: {
    position: "absolute",
    bottom: 96,
    left: 52,
    width: 160,
    flexDirection: "row",
    gap: 4,
    padding: 5,
    borderRadius: 999,
    backgroundColor: "rgba(16,28,50,0.96)",
  },
  delayOption: {
    flex: 1,
    minHeight: 34,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  delayOptionActive: { backgroundColor: COLORS.aqua },
  delayOptionText: {
    color: "rgba(255,255,255,0.8)",
    fontFamily: FONT_DISPLAY.black,
    fontSize: 10,
  },
  delayOptionTextActive: { color: COLORS.onAqua },
});
