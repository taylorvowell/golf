import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { ArrowLeftRight, Pause, Play } from "lucide-react-native";

import { FONT_DISPLAY } from "../../design/system/typography";

/**
 * `.report-v2-player-bar` — the video-open transport row: the speed pill group on the left,
 * the aqua play cap in the middle, the Compare tool pill on the right. (The overlays opener
 * is the layers orb at the top of the player, not a bar pill — Taylor 2026-08-17.)
 *
 * Behind its own memo taking primitives only: the shell's parent re-renders per presented
 * frame (the scrub indicator rides `frame`), and nothing in this bar changes at that rate.
 *
 * The speed control is the mockup's pill group (0.1× / 0.5× / 1×) — the same three rates the
 * player's speed slider carries, re-skinned; `setPlaybackSpeed` stays native, so 0.1× is a
 * true 6 frames a second, not dropped frames.
 */

/** Mockup order: slowest first. The same three rates as the player dock — see PlayerConsole. */
const SPEEDS = [0.1, 0.5, 1] as const;

export interface ReportPlayerBarProps {
  playing: boolean;
  speed: number;
  disabled?: boolean;
  onToggle: () => void;
  onSpeed: (speed: number) => void;
  onCompare: () => void;
  /** True while a comparison reference is set — the Compare pill lights up. */
  comparing?: boolean;
}

export const ReportPlayerBar = memo(function ReportPlayerBar({
  playing,
  speed,
  disabled = false,
  onToggle,
  onSpeed,
  onCompare,
  comparing = false,
}: ReportPlayerBarProps) {
  return (
    <View style={[styles.bar, disabled && styles.dim]} testID="report-player-bar">
      {/* .report-v2-speed */}
      <View style={styles.speedGroup}>
        {SPEEDS.map((s) => (
          <Pressable
            key={s}
            testID={`report-speed-${String(s).replace(".", "-")}`}
            accessibilityRole="button"
            accessibilityLabel={`${s}x speed`}
            accessibilityState={{ selected: speed === s, disabled }}
            disabled={disabled}
            onPress={() => onSpeed(s)}
            style={[styles.speedButton, speed === s && styles.speedButtonOn]}
          >
            <Text style={[styles.speedText, speed === s && styles.speedTextOn]}>{s}x</Text>
          </Pressable>
        ))}
      </View>

      {/* .report-v2-play-button — the aqua gradient cap. */}
      <Pressable
        testID="report-play-toggle"
        accessibilityRole="button"
        accessibilityLabel={playing ? "Pause" : "Play"}
        accessibilityState={{ disabled }}
        disabled={disabled}
        hitSlop={8}
        onPress={onToggle}
        style={({ pressed }) => [styles.playCap, pressed && styles.pressed]}
      >
        <LinearGradient
          // Mockup: linear-gradient(145deg, #66E1E1 0%, aqua-500 58%, #35BFC4 100%).
          colors={["#66E1E1", "#43CDD0", "#35BFC4"]}
          locations={[0, 0.58, 1]}
          start={{ x: 0.15, y: 0 }}
          end={{ x: 0.85, y: 1 }}
          style={styles.playFace}
        >
          {playing ? (
            <Pause size={16} color="#10204A" fill="#10204A" strokeWidth={0} />
          ) : (
            <Play size={16} color="#10204A" fill="#10204A" strokeWidth={0} />
          )}
        </LinearGradient>
      </Pressable>

      {/* .report-v2-toolset */}
      <View style={styles.toolset}>
        <Pressable
          testID="report-compare-open"
          accessibilityRole="button"
          accessibilityLabel="Compare with another swing"
          accessibilityState={{ selected: comparing }}
          onPress={onCompare}
          style={({ pressed }) => [styles.tool, comparing && styles.toolOn, pressed && styles.pressed]}
        >
          <ArrowLeftRight size={12} color="#FFFFFF" strokeWidth={2.5} />
          <Text style={styles.toolText}>Compare</Text>
        </Pressable>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 16,
    backgroundColor: "rgba(7,16,31,0.66)", // .report-v2-player-bar (blur is a named deviation)
  },
  dim: { opacity: 0.5 },
  pressed: { opacity: 0.7 },

  speedGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    padding: 4,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  speedButton: {
    minHeight: 28,
    paddingHorizontal: 10,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  speedButtonOn: { backgroundColor: "rgba(255,255,255,0.12)" },
  speedText: {
    color: "rgba(255,255,255,0.64)",
    fontFamily: FONT_DISPLAY.black,
    fontSize: 8,
    letterSpacing: 0.64,
    textTransform: "uppercase",
  },
  speedTextOn: { color: "#FFFFFF" },

  playCap: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  playFace: {
    flex: 1,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },

  toolset: { flexDirection: "row", alignItems: "center", gap: 8 },
  tool: {
    minHeight: 32,
    paddingHorizontal: 12,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  toolOn: { backgroundColor: "rgba(67,205,208,0.28)" },
  toolText: {
    color: "#FFFFFF",
    fontFamily: FONT_DISPLAY.black,
    fontSize: 8,
    letterSpacing: 0.64,
    textTransform: "uppercase",
  },
});
