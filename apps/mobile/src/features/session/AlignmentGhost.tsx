import { useEffect, useRef } from "react";
import { Animated, StyleSheet } from "react-native";

import { PoseOutline } from "../../design/system/PoseOutline";
import { posePlacement } from "../../design/system/capturePoses";
import { useHandedness } from "../profile/useProfile";
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
  // The art is right-handed; a left-handed golfer gets the mirror image in the mirrored spot,
  // or the guide teaches them to stand on the wrong side of the ball (profile handedness, §5.4).
  const mirrored = useHandedness() === "left";
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
  const place = posePlacement(view, width, height, mirrored);

  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: fade }]}>
      <Animated.View
        style={{
          position: "absolute",
          left: place.left,
          top: place.top,
        }}
      >
        <PoseOutline
          pose={view}
          width={place.width}
          height={place.height}
          mirrored={mirrored}
          color={COLORS.aqua}
          // Really thin (Taylor, step-03 iteration): the ghost is a guide to line a body up
          // against, so it has to sit ON the golfer without hiding them. 3 read as a drawing
          // over the footage rather than a reference laid across it.
          strokeWidth={1}
        />
      </Animated.View>
    </Animated.View>
  );
}
