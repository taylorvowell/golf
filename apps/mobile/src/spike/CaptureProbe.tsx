import { useCallback, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  Camera,
  CommonResolutions,
  useCameraDevice,
  useCameraPermission,
  useVideoOutput,
  type CameraSessionConfig,
} from "react-native-vision-camera";
import { COLORS, styles } from "./styles";

/**
 * Probe 3 — does the device RECORD at the rate it reports?
 *
 * §2.3 makes 60fps non-negotiable and forbids degrading it silently, which is exactly why this
 * cannot be answered by asking the camera. VisionCamera will accept a 60fps constraint on a
 * pipeline that cannot sustain it, and a clip that claims 60 while delivering 47 reaches the
 * analyzer as a video whose every frame timestamp is wrong — every event frame derived from it
 * would be wrong with it, and nothing about the file would look broken.
 *
 * So this component's job stops at **producing an artifact**. The verdict is computed on the PC
 * from the file itself by `scripts/measure-capture.mjs`, which counts the frames ffmpeg can
 * actually decode. Same discipline as the analyzer's own verification: the artifact is the
 * evidence, and the producer's self-report is not.
 *
 * Written against VisionCamera **v5**, which is a full rewrite — `useCamera`/`useVideoOutput` and
 * a `constraints` array, not v4's `format`/`fps` props. Do not port v4 snippets into it.
 */

interface CaptureProbeProps {
  onRecorded: (info: {
    path: string; requestedFps: number; resolvedFps: number; seconds: number;
  }) => void;
  onError: (message: string) => void;
  disabled?: boolean;
}

const RECORD_SECONDS = 10;
/** §2.3's floor. Asking for exactly this rather than the device maximum keeps the question
 *  falsifiable: the bar is 60, so 60 is what gets requested and what the file is judged against. */
const TARGET_FPS = 60;

export function CaptureProbe({ onRecorded, onError, disabled }: CaptureProbeProps) {
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice("back");
  const videoOutput = useVideoOutput({
    targetResolution: CommonResolutions.FHD_16_9,
    enableAudio: false,
  });

  const [recording, setRecording] = useState(false);
  /** What the pipeline actually negotiated, as opposed to what was asked for. */
  const [resolvedFps, setResolvedFps] = useState(0);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!hasPermission) void requestPermission();
  }, [hasPermission, requestPermission]);

  const onSessionConfigSelected = useCallback((config: CameraSessionConfig) => {
    // The negotiated rate, reported separately from the recorded one. A pipeline that quietly
    // resolves 60 down to 30 is the "silent degrade" §2.3 bans, and it is visible here BEFORE a
    // single frame is written — worth surfacing on its own.
    const fps = (config as unknown as { fps?: number }).fps ?? 0;
    setResolvedFps(fps);
  }, []);

  const record = useCallback(async () => {
    if (recording) return;
    if (!device) {
      onError("no back camera on this device");
      return;
    }
    setRecording(true);
    setNote(`recording ${RECORD_SECONDS}s, requested ${TARGET_FPS}fps…`);
    const startedAt = Date.now();

    try {
      const recorder = await videoOutput.createRecorder({});
      await recorder.startRecording(
        (filePath) => {
          setRecording(false);
          setNote(null);
          onRecorded({
            path: filePath,
            requestedFps: TARGET_FPS,
            resolvedFps,
            seconds: (Date.now() - startedAt) / 1000,
          });
        },
        (err) => {
          setRecording(false);
          setNote(null);
          onError(err.message);
        },
      );
      await new Promise((r) => setTimeout(r, RECORD_SECONDS * 1000));
      await recorder.stopRecording();
    } catch (err) {
      setRecording(false);
      setNote(null);
      onError(err instanceof Error ? err.message : String(err));
    }
  }, [device, onError, onRecorded, recording, resolvedFps, videoOutput]);

  if (!device) return <Text style={styles.detail}>No back camera reported by this device.</Text>;
  if (!hasPermission) {
    return (
      <View>
        <Text style={styles.detail}>Camera permission not granted.</Text>
        <Pressable onPress={() => void requestPermission()} style={styles.button}>
          <Text style={styles.buttonText}>Grant camera access</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View>
      <Text style={styles.detail}>
        Requesting {TARGET_FPS}fps
        {resolvedFps ? ` · pipeline negotiated ${resolvedFps}fps` : ""}
      </Text>
      {/* A preview must be mounted and active for a recording to start. Kept small on purpose:
          this measures the RECORDING rate, and a full-screen preview would add compositing work
          the product's capture screen might not have. */}
      <Camera
        style={{ width: 160, height: 90, marginTop: 8, backgroundColor: COLORS.panel }}
        device={device}
        outputs={[videoOutput]}
        constraints={[{ fps: TARGET_FPS }]}
        onSessionConfigSelected={onSessionConfigSelected}
        isActive
      />
      <Pressable
        onPress={record}
        disabled={disabled || recording}
        style={[styles.button, (disabled || recording) && styles.buttonDisabled]}
      >
        <Text style={styles.buttonText}>{recording ? "Recording…" : "Record 10s"}</Text>
      </Pressable>
      {note ? <Text style={styles.detail}>{note}</Text> : null}
    </View>
  );
}
