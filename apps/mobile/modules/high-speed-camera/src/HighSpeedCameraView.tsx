import { requireNativeView } from "expo";
import type { StyleProp, ViewStyle } from "react-native";

export interface HighSpeedCameraViewProps {
  /** Which lens. Changing it tears down and reopens the preview session. */
  facing: "back" | "front";
  /** CONTROL_ZOOM_RATIO, clamped natively to the device's real range. */
  zoom: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * The live Camera2 preview surface (Android). Mount ONLY behind a granted CAMERA
 * permission — the native side assumes the grant. Recording still goes through the
 * module's constrained high-speed path; merging the two into one session is the rest of
 * session-mode step 04.
 */
export default requireNativeView<HighSpeedCameraViewProps>("HighSpeedCamera");
