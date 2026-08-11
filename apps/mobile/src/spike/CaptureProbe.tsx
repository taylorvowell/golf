import { useCallback, useEffect, useMemo, useState } from "react";
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
    path: string; requestedFps: number; resolvedFps: number; seconds: number; supported: number[];
  }) => void;
  onError: (message: string) => void;
  disabled?: boolean;
}

const RECORD_SECONDS = 10;

/**
 * §2.3 sets a FLOOR of 60, not a target, and the rates above it are worth measuring on their own.
 *
 * A golf swing's club head covers its whole arc in roughly a fifth of a second, and impact itself
 * is over inside one frame at 60fps — which is precisely why `analysis.json` has no impact face
 * angle and why the club detector is worst exactly where the swing is fastest. Every one of those
 * limits eases at 120 or 240. So the question is not only "does 60 hold" but "what is this device
 * actually capable of", and the answer changes what in-app-capture can offer.
 *
 * Each rate is a separate recording judged against its OWN request, because a device that
 * sustains 60 and silently halves 240 has told us two different things.
 */
const RATES = [60, 120, 240] as const;

export function CaptureProbe({ onRecorded, onError, disabled }: CaptureProbeProps) {
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice("back");
  const videoOutput = useVideoOutput({
    targetResolution: CommonResolutions.FHD_16_9,
    enableAudio: false,
  });

  /**
   * The camera session is OFF until armed, and that is not just politeness.
   *
   * Mounting `<Camera isActive>` with the probe list starts a live 1080p session the moment the
   * screen renders — it froze the app on first try, and even when it does not, a running camera
   * competes for the decoder and the GPU with exactly the playback probes 1, 2 and 4 are trying
   * to measure. A measurement taken with the camera quietly running is not the measurement.
   */
  const [armed, setArmed] = useState(false);
  const [recording, setRecording] = useState<number | null>(null);
  /** The rate the session is currently configured for; changing it reconfigures the pipeline. */
  const [targetFps, setTargetFps] = useState<number>(60);
  /** What the pipeline actually negotiated, as opposed to what was asked for. */
  const [resolvedFps, setResolvedFps] = useState(0);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (armed && !hasPermission) void requestPermission();
  }, [armed, hasPermission, requestPermission]);

  const onSessionConfigSelected = useCallback((config: CameraSessionConfig) => {
    // The negotiated rate, reported separately from the recorded one. A pipeline that quietly
    // resolves 60 down to 30 is the "silent degrade" §2.3 bans, and it is visible here BEFORE a
    // single frame is written — worth surfacing on its own.
    const fps = (config as unknown as { fps?: number }).fps ?? 0;
    setResolvedFps(fps);
  }, []);

  /** What the DEVICE claims it can do, before anything is recorded. Claims are not results. */
  const supported = useMemo(
    () => (device ? RATES.filter((r) => device.supportsFPS(r)) : []),
    [device],
  );

  const record = useCallback(async (fps: number) => {
    if (recording !== null) return;
    if (!device) {
      onError("no back camera on this device");
      return;
    }
    setRecording(fps);
    setNote(`recording ${RECORD_SECONDS}s, requested ${fps}fps…`);
    const startedAt = Date.now();

    try {
      const recorder = await videoOutput.createRecorder({});
      await recorder.startRecording(
        (filePath) => {
          setRecording(null);
          setNote(null);
          onRecorded({
            path: filePath,
            requestedFps: fps,
            resolvedFps,
            seconds: (Date.now() - startedAt) / 1000,
            supported: [...supported],
          });
        },
        (err) => {
          setRecording(null);
          setNote(null);
          onError(err.message);
        },
      );
      await new Promise((r) => setTimeout(r, RECORD_SECONDS * 1000));
      await recorder.stopRecording();
    } catch (err) {
      setRecording(null);
      setNote(null);
      onError(err instanceof Error ? err.message : String(err));
    }
  }, [device, onError, onRecorded, recording, resolvedFps, supported, videoOutput]);

  if (!device) return <Text style={styles.detail}>No back camera reported by this device.</Text>;

  if (!armed) {
    return (
      <View>
        <Text style={styles.detail}>
          Camera is off. Arming it starts a live session, so do this AFTER the playback probes.
        </Text>
        <Pressable onPress={() => setArmed(true)} style={styles.button}>
          <Text style={styles.buttonText}>Arm camera</Text>
        </Pressable>
      </View>
    );
  }

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
        Device claims: {supported.length ? supported.map((r) => `${r}fps`).join(" · ") : "none of 60/120/240"}
        {resolvedFps ? ` · pipeline negotiated ${resolvedFps}fps` : ""}
      </Text>
      <Text style={styles.detail}>
        A claim is not a result — each rate records its own clip and is judged against its own
        request by scripts/measure-capture.mjs.
      </Text>
      {/* A preview must be mounted and active for a recording to start. Kept small on purpose:
          this measures the RECORDING rate, and a full-screen preview would add compositing work
          the product's capture screen might not have. */}
      <Camera
        style={{ width: 160, height: 90, marginTop: 8, backgroundColor: COLORS.panel }}
        device={device}
        outputs={[videoOutput]}
        constraints={[{ fps: targetFps }]}
        onSessionConfigSelected={onSessionConfigSelected}
        isActive
      />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {RATES.map((rate) => {
          const claimed = supported.includes(rate);
          return (
            <Pressable
              key={rate}
              onPress={() => {
                // Reconfigure the session first; the constraint is a prop, so the pipeline needs
                // a render to renegotiate before the recorder is created against it.
                setTargetFps(rate);
                setTimeout(() => void record(rate), 600);
              }}
              disabled={disabled || recording !== null}
              style={[
                styles.button,
                (disabled || recording !== null) && styles.buttonDisabled,
              ]}
            >
              <Text style={styles.buttonText}>
                {recording === rate ? `Recording ${rate}…` : `Record 10s @ ${rate}`}
                {claimed ? "" : " (unclaimed)"}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {note ? <Text style={styles.detail}>{note}</Text> : null}
    </View>
  );
}
