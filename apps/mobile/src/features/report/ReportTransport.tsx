import { memo, useEffect, useMemo, useRef } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Pause, Play } from "lucide-react-native";

import { FONT_DISPLAY } from "../../design/system/typography";
import { COLORS } from "../../theme";

/**
 * The report transport, in two pieces (Taylor, 2026-08-22).
 *
 * It used to be one bar: speed pills left, a restart button and the play cap right. The restart
 * button is gone — the swing loops, so "play it from the start again" was a control for something
 * the player already does — and the two survivors moved to where they are actually used. `PlayCap`
 * rides the far right of the SCRUB's own row, because play/pause and the playhead are one control
 * surface. `SpeedToggle` stands on the left above it, in the capture screen's zoom-rail language:
 * a vertical column of the same width and height, the same aqua, the same small caps label
 * underneath.
 *
 * The difference from zoom is deliberate — zoom is continuous, speed is a few rates, so this is a
 * TOGGLE and not a slider: fixed stops, and the aqua handle SWITCHES between them rather than
 * being dragged. `setPlaybackSpeed` stays native — the decoder is retimed, never frame-dropped.
 *
 * The ladder halves: 1 → ½ → ¼ → ⅛ (Taylor, 2026-08-23). Each stop divides a high-speed take's
 * rate cleanly, so slow motion stays SMOOTH the whole way down — a 240fps take presents 120/60/30
 * real frames a second, and at ¼x and below every sensor frame reaches the screen. The old 0.1x
 * divided nothing evenly and bought almost nothing over ⅛x; slower than ⅛x is a scrubbing task.
 */

/** Top to bottom, fastest first — the zoom rail's "more is up", so the two columns read alike. */
const SPEEDS = [1, 0.5, 0.25, 0.125] as const;

/** ASCII fractions, not decimals and not `¼`-style glyphs: "0.125x" does not fit a 34px rail,
 *  and a vulgar-fraction glyph is a font risk on Android (the register's own gotcha). */
const SPEED_LABELS: Record<number, string> = { 1: "1x", 0.5: "1/2", 0.25: "1/4", 0.125: "1/8" };

/** The zoom rail's column width; the height grew with the fourth stop (each stop keeps the
 *  zoom rail's 37px rhythm rather than squeezing four into three's track). */
const TRACK_WIDTH = 34;
const TRACK_HEIGHT = 148 * (4 / 3);
const STOP_HEIGHT = TRACK_HEIGHT / SPEEDS.length;
/** The handle is a CIRCLE of the rail's width (Taylor, 2026-08-22) — the zoom rail's thumb, not
 *  a pill filling its third of the column. It centres in whichever stop is selected. */
const THUMB = TRACK_WIDTH;
const THUMB_INSET = (STOP_HEIGHT - THUMB) / 2;

function speedLabel(speed: number): string {
  return SPEED_LABELS[speed] ?? `${speed}x`;
}

export interface SpeedToggleProps {
  speed: number;
  disabled?: boolean;
  onSpeed: (speed: number) => void;
}

export const SpeedToggle = memo(function SpeedToggle({
  speed,
  disabled = false,
  onSpeed,
}: SpeedToggleProps) {
  // Nearest stop, never an index of -1: the player can be handed a rate this column does not
  // carry (the dev lab), and a handle parked off the rail would read as broken.
  const index = useMemo(() => {
    let best = 0;
    for (let i = 1; i < SPEEDS.length; i += 1) {
      if (Math.abs(SPEEDS[i] - speed) < Math.abs(SPEEDS[best] - speed)) best = i;
    }
    return best;
  }, [speed]);

  /** The handle SWITCHES — a spring, native-driven, one value. Snapping between two stops
   *  between frames is what makes a toggle read as a set of buttons instead. */
  const y = useRef(new Animated.Value(index * STOP_HEIGHT + THUMB_INSET)).current;
  useEffect(() => {
    Animated.spring(y, {
      toValue: index * STOP_HEIGHT + THUMB_INSET,
      useNativeDriver: true,
      speed: 20,
      bounciness: 4,
    }).start();
  }, [index, y]);

  return (
    <View style={[styles.speedGroup, disabled && styles.dim]} pointerEvents="box-none">
      <View style={styles.rail} testID="report-speed">
        <View style={styles.railGround} pointerEvents="none" />
        <Animated.View
          style={[styles.railThumb, { transform: [{ translateY: y }] }]}
          pointerEvents="none"
        />
        {SPEEDS.map((s, i) => (
          <Pressable
            key={s}
            testID={`report-speed-${String(s).replace(".", "-")}`}
            accessibilityRole="button"
            accessibilityLabel={`${s}x speed`}
            accessibilityState={{ selected: i === index, disabled }}
            disabled={disabled}
            onPress={() => onSpeed(s)}
            style={[styles.stop, { top: i * STOP_HEIGHT }]}
          >
            <Text style={[styles.stopText, i === index && styles.stopTextOn]}>
              {speedLabel(s)}
            </Text>
          </Pressable>
        ))}
      </View>
      {/* Names the column, exactly as the zoom rail's does — a bare rail over footage reads as
          decoration otherwise. */}
      <Text style={styles.tag} pointerEvents="none">
        Speed
      </Text>
    </View>
  );
});

export interface PlayCapProps {
  playing: boolean;
  disabled?: boolean;
  onToggle: () => void;
}

/** `.report-v2-play-button` — the aqua gradient cap, now riding the scrub's own row. */
export const PlayCap = memo(function PlayCap({
  playing,
  disabled = false,
  onToggle,
}: PlayCapProps) {
  return (
    <Pressable
      testID="report-play-toggle"
      accessibilityRole="button"
      accessibilityLabel={playing ? "Pause" : "Play"}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={8}
      onPress={onToggle}
      style={({ pressed }) => [styles.playCap, disabled && styles.dim, pressed && styles.pressed]}
    >
      <LinearGradient
        // Mockup: linear-gradient(145deg, #8AF7FD 0%, aqua-500 58%, #0D94DB 100%).
        colors={["#8AF7FD", "#2DF0FB", "#0D94DB"]}
        locations={[0, 0.58, 1]}
        start={{ x: 0.15, y: 0 }}
        end={{ x: 0.85, y: 1 }}
        style={styles.playFace}
      >
        {playing ? (
          <Pause size={16} color="#0F2E4C" fill="#0F2E4C" strokeWidth={0} />
        ) : (
          <Play size={16} color="#0F2E4C" fill="#0F2E4C" strokeWidth={0} />
        )}
      </LinearGradient>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  dim: { opacity: 0.5 },
  pressed: { opacity: 0.7 },

  speedGroup: { alignItems: "center", gap: 6 },
  /** The touch column is wider than the rail, same as zoom's — the rail is what you see. */
  rail: { width: 44, height: TRACK_HEIGHT, alignItems: "center" },
  railGround: {
    position: "absolute",
    width: TRACK_WIDTH,
    top: 0,
    bottom: 0,
    borderRadius: TRACK_WIDTH / 2,
    // The zoom rail's barely-there glass: the controls sit ON the footage, never curtain it.
    // No `CONTROL_EDGE` here (Taylor, 2026-08-22) — the outline read as a box around the
    // control rather than as its shape.
    backgroundColor: "rgba(11,16,28,0.28)",
  },
  railThumb: {
    position: "absolute",
    top: 0,
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: COLORS.aqua,
  },
  stop: {
    position: "absolute",
    width: 44,
    height: STOP_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
  },
  stopText: {
    color: "rgba(255,255,255,0.78)",
    fontFamily: FONT_DISPLAY.black,
    fontSize: 10,
  },
  stopTextOn: { color: COLORS.onAqua },
  tag: {
    color: "rgba(255,255,255,0.8)",
    fontFamily: FONT_DISPLAY.black,
    fontSize: 9,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },

  playCap: { width: 44, height: 44, borderRadius: 22 },
  playFace: { flex: 1, borderRadius: 22, alignItems: "center", justifyContent: "center" },
});
