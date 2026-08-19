import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Linking,
  PermissionsAndroid,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from "react-native";

import HighSpeedCameraView from "../../../modules/high-speed-camera/src/HighSpeedCameraView";
import { FONT_BODY, FONT_DISPLAY } from "../../design/system/typography";
import { COLORS } from "../../theme";
import { AlignmentGhost } from "./AlignmentGhost";
import type { CameraFacing, CameraZoom, ZoomRange } from "./sessionState";

/**
 * The capture screen's picture layer: the live Camera2 preview
 * (`modules/high-speed-camera`'s view — never a second camera library, D37–D39), carrying
 * the alignment ghost, with chrome rendered through `children`.
 *
 * Permission is a real screen state, not an alert: denied renders a readable explanation
 * with a door to Settings, and the preview mounts only behind a grant — the native view
 * assumes it. Recording is still the stub (`sessionReducer`); binding the record path to
 * this same session is the rest of step 04.
 */

export interface CameraStageProps {
  /** The alignment ghost shows while true — hidden the moment recording starts. */
  ghostVisible: boolean;
  /** Which address pose the ghost suggests — follows the DTL/Front view toggle. */
  view: "dtl" | "face_on";
  facing: CameraFacing;
  zoom: CameraZoom;
  /** The open lens's real zoom range, straight from Camera2 — the zoom slider's bounds. */
  onZoomRange?: (range: ZoomRange) => void;
  children?: ReactNode;
}

type Permission = "checking" | "granted" | "denied";

export function CameraStage({
  ghostVisible,
  view,
  facing,
  zoom,
  onZoomRange,
  children,
}: CameraStageProps) {
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [permission, setPermission] = useState<Permission>("checking");

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setBox((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
  }, []);

  const request = useCallback(async () => {
    if (Platform.OS !== "android") {
      // No iOS build exists on this project; the stub stage stands in.
      setPermission("denied");
      return;
    }
    const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
    setPermission(result === PermissionsAndroid.RESULTS.GRANTED ? "granted" : "denied");
  }, []);

  useEffect(() => {
    void request();
  }, [request]);

  return (
    <View style={styles.root} onLayout={onLayout} testID="camera-stage">
      {permission === "granted" ? (
        <HighSpeedCameraView
          facing={facing}
          zoom={zoom}
          onZoomRange={(e) => onZoomRange?.({ min: e.nativeEvent.min, max: e.nativeEvent.max })}
          style={StyleSheet.absoluteFill}
        />
      ) : (
        <View style={styles.feed}>
          {permission === "denied" ? (
            <View style={styles.denied}>
              <Text style={styles.deniedTitle}>SwingSage needs the camera</Text>
              <Text style={styles.deniedDetail}>
                Recording a swing starts with seeing one. Allow camera access to film.
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Allow camera access"
                onPress={() => {
                  // A permanently-denied permission never re-prompts — Settings is the
                  // only door left, and sending the golfer there beats a dead button.
                  void request();
                  void Linking.openSettings();
                }}
                style={({ pressed }) => [styles.deniedButton, pressed && styles.pressed]}
                testID="camera-permission"
              >
                <Text style={styles.deniedButtonText}>Allow camera</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      )}
      <AlignmentGhost width={box.width} height={box.height} visible={ghostVisible} view={view} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg, overflow: "hidden" },
  // A hair lighter than the ground so the stage reads as a surface waiting for a picture.
  feed: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: COLORS.panel,
    alignItems: "center",
    justifyContent: "center",
  },
  denied: { alignItems: "center", gap: 8, paddingHorizontal: 32, maxWidth: 340 },
  deniedTitle: {
    color: COLORS.text,
    fontFamily: FONT_DISPLAY.extraBold,
    fontSize: 17,
    textAlign: "center",
  },
  deniedDetail: {
    color: COLORS.muted,
    fontFamily: FONT_BODY.regular,
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
  },
  deniedButton: {
    marginTop: 8,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: COLORS.aqua,
  },
  deniedButtonText: { color: COLORS.onAqua, fontFamily: FONT_DISPLAY.black, fontSize: 12 },
  pressed: { opacity: 0.7 },
});
