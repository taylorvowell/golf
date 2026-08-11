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

interface HighSpeedCameraModule {
  getSupportedFrameRates(): Promise<HighSpeedSupport>;
  record(fps: number, seconds: number): Promise<HighSpeedRecording>;
}

/**
 * CameraX 1.5 high-speed capture (D37). Android only exposes 120/240 through a constrained
 * high-speed session, which react-native-vision-camera v5 does not open.
 *
 * `slowMotionEnabled` is hardcoded false on the native side — with it on, CameraX rewrites the
 * stream to a 30fps file and the analyzer would read every frame index wrong.
 */
export default requireNativeModule<HighSpeedCameraModule>("HighSpeedCamera");
