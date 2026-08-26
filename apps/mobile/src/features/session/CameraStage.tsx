import { useCallback, useEffect, useState, type ReactNode, type Ref } from "react";
import {
  AppState,
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
import type {
  HighSpeedCameraViewProps,
  HighSpeedCameraViewRef,
} from "../../../modules/high-speed-camera/src/HighSpeedCameraView";
import { FONT_BODY, FONT_DISPLAY } from "../../design/system/typography";
import { COLORS } from "../../theme";
import { AlignmentGhost } from "./AlignmentGhost";
import type { CameraZoom, ZoomRange } from "./sessionState";

/**
 * The capture screen's picture layer: the live Camera2 preview
 * (`modules/high-speed-camera`'s view — never a second camera library, D37–D39), carrying
 * the alignment ghost, with chrome rendered through `children`.
 *
 * Permission is a real screen state, not an alert: denied renders a readable explanation
 * with a door to Settings, and the preview mounts only behind a grant — the native view
 * assumes it. The take itself is driven through `cameraRef` by the session screen — this
 * component only owns the picture and the permission gate.
 *
 * **The grant is re-read every time the app comes back to the foreground**, and it has to be:
 * the Settings door this screen offers is a round trip out of the app, so the interesting
 * answer always arrives while the screen is backgrounded. It runs both ways. Revoked while
 * away, a stale `granted` would keep the dead preview mounted and leave Record looking ready
 * over a black rectangle; newly granted, the golfer would come back to the same refusal that
 * sent them to Settings and reasonably conclude it had not worked.
 */

export interface CameraStageProps {
  /** The alignment ghost shows while true — hidden the moment recording starts. */
  ghostVisible: boolean;
  /** Which address pose the ghost suggests — follows the DTL/Front view toggle. */
  view: "dtl" | "face_on";
  zoom: CameraZoom;
  /** The open lens's real zoom range, straight from Camera2 — the zoom slider's bounds. */
  onZoomRange?: (range: ZoomRange) => void;
  /** The session screen's handle on the take (`startRecording`/`stopRecording`). Null until
   * the permission grant mounts the native view — callers must tolerate that. */
  cameraRef?: Ref<HighSpeedCameraViewRef>;
  /** A take that ended without `stopRecording` — the hard cap, or a mid-take failure. */
  onRecordingEnded?: HighSpeedCameraViewProps["onRecordingEnded"];
  /** The probed capture rate — what the FPS pill shows. */
  children?: ReactNode;
}

type Permission = "checking" | "granted" | "denied";

export function CameraStage({
  ghostVisible,
  view,
  zoom,
  onZoomRange,
  cameraRef,
  onRecordingEnded,
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
    // BOTH, together: the recorder captures audio (impact detection seeds from it), and a
    // missing RECORD_AUDIO grant fails the take at `setAudioSource` — after the camera
    // permission alone let the preview open and the Record button look ready.
    const results = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.CAMERA,
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    ]);
    const granted = Object.values(results).every(
      (r) => r === PermissionsAndroid.RESULTS.GRANTED,
    );
    setPermission(granted ? "granted" : "denied");
  }, []);

  /**
   * `check`, never `request` — this runs on every foreground, and a screen that re-prompts each
   * time the golfer switches apps is a screen they turn off notifications to escape. The system
   * dialog belongs to the mount below and to the explicit Allow button, both of which are the
   * golfer asking for it.
   */
  const recheck = useCallback(async () => {
    if (Platform.OS !== "android") return;
    const [camera, mic] = await Promise.all([
      PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.CAMERA),
      PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO),
    ]);
    setPermission(camera && mic ? "granted" : "denied");
  }, []);

  useEffect(() => {
    void request();
  }, [request]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") void recheck();
    });
    return () => sub.remove();
  }, [recheck]);

  return (
    <View style={styles.root} onLayout={onLayout} testID="camera-stage">
      {permission === "granted" ? (
        <HighSpeedCameraView
          ref={cameraRef}
          zoom={zoom}
          onZoomRange={(e) => onZoomRange?.({ min: e.nativeEvent.min, max: e.nativeEvent.max })}
          onRecordingEnded={onRecordingEnded}
          style={StyleSheet.absoluteFill}
        />
      ) : (
        <View style={styles.feed}>
          {permission === "denied" ? (
            <View style={styles.denied}>
              <Text style={styles.deniedTitle}>SwingSage needs the camera and mic</Text>
              <Text style={styles.deniedDetail}>
                The camera films your swing; the mic is how the app hears the strike and
                finds it for you. Allow both to record.
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
