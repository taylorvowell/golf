import { useCallback, useState, type ReactNode } from "react";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";

import { COLORS } from "../../theme";
import { AlignmentGhost } from "./AlignmentGhost";

/**
 * The capture screen's picture layer — and the seam the real camera fills in.
 *
 * UI phase (D61): a dark stage standing in for the live feed, carrying the alignment ghost.
 * Step 04 replaces the stub `View` with the `modules/high-speed-camera` preview surface and
 * nothing above this layer changes — chrome renders through `children`, which is the whole
 * point of the seam.
 */

export interface CameraStageProps {
  /** The alignment ghost shows while true — hidden the moment recording starts. */
  ghostVisible: boolean;
  children?: ReactNode;
}

export function CameraStage({ ghostVisible, children }: CameraStageProps) {
  const [box, setBox] = useState({ width: 0, height: 0 });
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setBox((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
  }, []);

  return (
    <View style={styles.root} onLayout={onLayout} testID="camera-stage">
      {/* Stub feed: the real preview mounts here in the wiring step. */}
      <View style={styles.feed} />
      <AlignmentGhost width={box.width} height={box.height} visible={ghostVisible} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg, overflow: "hidden" },
  // A hair lighter than the ground so the stage reads as a surface waiting for a picture,
  // not a dead screen.
  feed: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: COLORS.panel },
});
