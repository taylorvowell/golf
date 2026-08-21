import { useEffect, useRef } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";

import { DualViewIcon } from "../../design/system/DualViewIcon";
import { PoseOutline } from "../../design/system/PoseOutline";
import { FONT_DISPLAY } from "../../design/system/typography";
import { useHandedness } from "../profile/useProfile";
import { SEMANTIC } from "../../theme";
import type { CaptureView } from "./sessionState";

/**
 * The second camera, picture-in-picture (Taylor, step-03 iteration).
 *
 * Once a phone is paired, its view lives on the capture screen — not behind a tap in the Dual
 * Sync sheet. The whole point of the feature is framing a second angle you are not holding, and
 * a preview you have to open a panel to see cannot do that job while you are setting up a shot.
 * Tapping it opens the sheet, which is where disconnecting lives.
 *
 * UI phase: nothing is wired, so the tile draws the angle's pose outline where the live WebRTC
 * preview track will go (`dual-device-capture`). It shows the ANGLE and nothing else — no frame
 * rate, no connection quality, no device model. Those are instruments.
 */

const WIDTH = 92;
const HEIGHT = 122;

export interface DualSyncPipProps {
  /** The angle the SECOND camera is filming — the one this phone is not. */
  view: CaptureView;
  onPress: () => void;
}

export function DualSyncPip({ view, onPress }: DualSyncPipProps) {
  const label = view === "dtl" ? "DTL" : "Front";
  // The stand-in art shows the golfer themself — it mirrors with profile handedness.
  const mirrored = useHandedness() === "left";

  // A slow halo behind the glyph — the tile's only motion, and the one thing on it that says
  // "this is live right now" rather than "a camera was connected at some point". Native driver
  // and a single looping value: it must cost nothing next to a 60fps preview.
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1400,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Second camera, filming ${view === "dtl" ? "down the line" : "front view"}`}
      onPress={onPress}
      style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
      testID="dual-sync-pip"
    >
      <PoseOutline
        pose={view}
        width={44}
        height={64}
        color="rgba(255,255,255,0.5)"
        mirrored={mirrored}
      />
      <View style={styles.tag}>
        {/* The Dual Sync glyph, green — same icon as the control that opened this, so the tile
            is legible as "the synced camera" without a word for it. */}
        <View style={styles.glyph}>
          <Animated.View
            pointerEvents="none"
            style={[
              styles.pulse,
              {
                opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }),
                transform: [
                  { scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.6, 2.1] }) },
                ],
              },
            ]}
          />
          <DualViewIcon size={16} color={SEMANTIC.good} strokeWidth={0.9} />
        </View>
        <Text style={styles.tagText}>{label}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Positioned by the screen — the tile only owns its own box.
  tile: {
    width: WIDTH,
    height: HEIGHT,
    borderRadius: 14,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(11,16,28,0.72)",
  },
  tag: {
    position: "absolute",
    left: 6,
    bottom: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: "rgba(11,16,28,0.66)",
  },
  glyph: { height: 16, alignItems: "center", justifyContent: "center" },
  pulse: {
    position: "absolute",
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: SEMANTIC.good,
  },
  tagText: {
    color: "rgba(255,255,255,0.85)",
    fontFamily: FONT_DISPLAY.black,
    fontSize: 9,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  pressed: { opacity: 0.7 },
});
