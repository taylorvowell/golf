import { useEffect, useRef } from "react";
import { Animated, StyleSheet } from "react-native";
import { Image } from "expo-image";

/**
 * The camera-alignment guide: Taylor's supplied outline art over the live feed
 * (`assets/capture/overlay_dtl.png` / `overlay_front.png`, 460×1000 RGBA), so the golfer
 * frames themself the way the analyzer wants before recording.
 *
 * A hint, never a gate — it does not measure anything and recording never waits on it. It
 * fades out when recording starts (`visible: false`), and its pose follows the DTL/Front
 * view toggle. The art is composed for a full portrait frame (the figure sits low-centre
 * with its own margins), so it renders full-bleed and `contain`-fitted — never cropped,
 * whatever the stage's aspect.
 */

const ART = {
  dtl: require("../../../assets/capture/overlay_dtl.png"),
  face_on: require("../../../assets/capture/overlay_front.png"),
} as const;

/** Present but not competing with the picture — the outline reads at just over half. */
const GHOST_OPACITY = 0.55;

export interface AlignmentGhostProps {
  width: number;
  height: number;
  visible: boolean;
  /** Which address pose to suggest — DTL or Front View (face-on). */
  view: "dtl" | "face_on";
}

export function AlignmentGhost({ width, height, visible, view }: AlignmentGhostProps) {
  const fade = useRef(new Animated.Value(visible ? GHOST_OPACITY : 0)).current;
  useEffect(() => {
    Animated.timing(fade, {
      toValue: visible ? GHOST_OPACITY : 0,
      duration: 260,
      useNativeDriver: true,
    }).start();
  }, [fade, visible]);

  if (width <= 0 || height <= 0) return null;

  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: fade }]}>
      <Image source={ART[view]} style={styles.art} contentFit="contain" transition={120} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  art: { flex: 1 },
});
