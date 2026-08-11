import { requireNativeModule } from "expo";

export interface Camera2Capabilities {
  supported: boolean;
  declaresCapability?: boolean;
  /** e.g. "1920x1080@240-240" — straight from CameraCharacteristics. */
  configurations?: string[];
  /** The ORDINARY-session ceiling, for contrast. Measured 60 on the S25+ (D39). */
  normalFpsRanges?: string[];
  reason?: string;
}

export interface HighSpeedRecording {
  path: string;
  requestedFps: number;
  api: string;
}

interface HighSpeedCameraModule {
  camera2Capabilities(): Promise<Camera2Capabilities>;
  camera2Record(fps: number, seconds: number): Promise<HighSpeedRecording>;
}

/**
 * Camera2 constrained-high-speed capture. 1080p at 231fps measured on a Galaxy S25+ (D39).
 *
 * The CameraX and vision-camera paths were both implemented, measured and removed — see the
 * native module's comment. Capability is probed at runtime via `camera2Capabilities`, never
 * assumed: §2.3 forbids degrading silently, and this device is a flagship.
 */
export default requireNativeModule<HighSpeedCameraModule>("HighSpeedCamera");
