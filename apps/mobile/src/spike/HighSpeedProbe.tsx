import { useCallback, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import HighSpeedCamera, { type Camera2Capabilities } from "../../modules/high-speed-camera/src";
import { styles } from "./styles";

/**
 * Probe 3b — true high-frame-rate capture through CameraX 1.5.
 *
 * Reports what the device GRANTS separately from what was requested, because D37's whole finding
 * was that those two can differ silently. The achieved rate is still measured off the file by
 * `scripts/measure-capture.mjs`; nothing here is allowed to be the witness for itself.
 */

interface HighSpeedProbeProps {
  onRecorded: (info: { path: string; requestedFps: number; api: string }) => void;
  onError: (message: string) => void;
  disabled?: boolean;
}

const RATES = [120, 240];
const RECORD_SECONDS = 6;

export function HighSpeedProbe({ onRecorded, onError, disabled }: HighSpeedProbeProps) {
  const [busy, setBusy] = useState<number | null>(null);

  const [queryError, setQueryError] = useState<string | null>(null);
  const [cam2, setCam2] = useState<Camera2Capabilities | null>(null);
  /**
   * The last attempt, shown ON THE CARD.
   *
   * A recording that hung left the button reading "Recording 120…" with nothing else to go on —
   * no way to tell a slow camera from a dead one without reading logcat on another machine. The
   * probe has to be able to report its own outcome, or it is not usable by the person holding the
   * phone.
   */
  const [last, setLast] = useState<string | null>(null);

  useEffect(() => {
    HighSpeedCamera.camera2Capabilities()
      .then((c) => {
        console.log(`SWINGSAGE_CAMERA2 ${JSON.stringify(c)}`);
        setCam2(c);
      })
      .catch((e: unknown) => {
        console.log(`SWINGSAGE_CAMERA2 {"error":${JSON.stringify(String(e))}}`);
      });
  }, []);


  const record = useCallback(async (fps: number) => {
    if (busy !== null) return;
    setBusy(fps);
    setLast(`requesting ${fps}fps…`);
    try {
      const result = await HighSpeedCamera.camera2Record(fps, RECORD_SECONDS);
      setLast(`✓ recorded ${fps}fps -> ${result.path.split("/").pop()}`);
      onRecorded(result);
    } catch (e) {
      // A rejection here is a GOOD outcome relative to the alternative: D37's failure was a
      // request for 240 quietly served at 60. Refusing outright is the honest answer.
      const msg = e instanceof Error ? e.message : String(e);
      setLast(`✗ ${fps}fps failed: ${msg}`);
      onError(msg);
    }
    setBusy(null);
  }, [busy, onError, onRecorded]);

  return (
    <View>
      <Text style={styles.detail}>
        {queryError ? `query failed: ${queryError}` : "Camera2 constrained high-speed"}
      </Text>
      <Text style={styles.detail}>
        Camera2:{" "}
        {cam2 === null
          ? "querying…"
          : cam2.supported
            ? `${cam2.configurations?.length ?? 0} high-speed configs · normal-session ranges ${
                cam2.normalFpsRanges?.join(",") ?? "?"
              }`
            : `unsupported (${cam2.reason ?? "declares=" + cam2.declaresCapability})`}
      </Text>
      {last ? <Text style={styles.detail}>{last}</Text> : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {RATES.map((fps) => (
          <Pressable
            key={fps}
            onPress={() => void record(fps)}
            /**
             * Deliberately NOT disabled by `support.supported`. The card went unclickable once and
             * the screen could not say whether that was the device, the query or the layout —
             * three very different problems. Always tappable; the native side refuses loudly and
             * that refusal is itself the measurement.
             */
            disabled={busy !== null}
            style={[styles.button, busy !== null && styles.buttonDisabled]}
          >
            <Text style={styles.buttonText}>
              {busy === fps ? `Recording ${fps}…` : `Camera2 ${RECORD_SECONDS}s @ ${fps}`}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
