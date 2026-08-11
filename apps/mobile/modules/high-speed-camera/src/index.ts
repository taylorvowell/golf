import { requireNativeModule } from "expo";

export interface HighSpeedSupport {
  /** False when the device has no constrained-high-speed capability at all. */
  supported: boolean;
  /** Advertised ranges as "lower-upper", e.g. "240-240". */
  ranges: string[];
  maxFps?: number;
}

export interface HighSpeedRecording {
  path: string;
  requestedFps: number;
  /** The range CameraX actually granted — compare against the request. */
  grantedRange: string;
}

export interface Camera2Capabilities {
  supported: boolean;
  declaresCapability?: boolean;
  /** e.g. "1920x1080@240-240" — straight from CameraCharacteristics. */
  configurations?: string[];
  /** The ORDINARY-session ceiling. Samsung is reported to cap third parties here (D38). */
  normalFpsRanges?: string[];
  reason?: string;
}

interface HighSpeedCameraModule {
  getSupportedFrameRates(): Promise<HighSpeedSupport>;
  record(fps: number, seconds: number): Promise<HighSpeedRecording>;
  /** Camera2 constrained-high-speed — the only API that reads the sensor's real config list. */
  camera2Capabilities(): Promise<Camera2Capabilities>;
  camera2Record(fps: number, seconds: number): Promise<HighSpeedRecording>;
}

/**
 * CameraX 1.5 high-speed capture (D37). Android only exposes 120/240 through a constrained
 * high-speed session, which react-native-vision-camera v5 does not open.
 *
 * `slowMotionEnabled` is hardcoded false on the native side — with it on, CameraX rewrites the
 * stream to a 30fps file and the analyzer would read every frame index wrong.
 */
export default requireNativeModule<HighSpeedCameraModule>("HighSpeedCamera");
