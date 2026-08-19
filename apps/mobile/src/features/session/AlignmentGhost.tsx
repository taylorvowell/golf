import { useEffect, useRef } from "react";
import { Animated, StyleSheet } from "react-native";

import { PoseOutline } from "../../design/system/PoseOutline";
import { ARTBOARD_ASPECT, CAPTURE_POSES } from "../../design/system/capturePoses";
import { COLORS } from "../../theme";

/**
 * The camera-alignment guide: Taylor's capture-pose outline art (design/system/
 * capturePoses.ts) stroked over the live feed, so the golfer frames themself the way the
 * analyzer wants before recording.
 *
 * A hint, never a gate — it does not measure anything and recording never waits on it. It
 * fades out when recording starts (`visible: false`), and its pose follows the DTL/Front
 * view toggle.
 *
 * PLACEMENT: the SVG viewBoxes are cropped to the figure, so drawing them full screen
 * makes the golfer fill the frame — not where Taylor composed them. The original artboard
 * (460×1000) is contain-fitted into the stage and each pose is placed at its measured
 * `frame` rect within it, reproducing the delivered composition at any stage aspect.
 */

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

  // The artboard contain-fitted in the stage, centred; the figure rect lives inside it.
  const scale = Math.min(width / ARTBOARD_ASPECT, height);
  const frameW = scale * ARTBOARD_ASPECT;
  const frameH = scale;
  const frameX = (width - frameW) / 2;
  const frameY = (height - frameH) / 2;
  const rect = CAPTURE_POSES[view].frame;

  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: fade }]}>
      <Animated.View
        style={{
          position: "absolute",
          left: frameX + rect.x * frameW,
          top: frameY + rect.y * frameH,
        }}
      >
        <PoseOutline
          pose={view}
          width={rect.w * frameW}
          height={rect.h * frameH}
          color={COLORS.aqua}
          strokeWidth={3}
        />
      </Animated.View>
    </Animated.View>
  );
}
