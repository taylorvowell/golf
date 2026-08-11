import { requireNativeView } from "expo";
import * as React from "react";

import type { FrameClockHandle, FrameClockViewProps } from "./FrameClock.types";

const NativeView: React.ComponentType<FrameClockViewProps & { ref?: React.Ref<FrameClockHandle> }> =
  requireNativeView("FrameClock");

/**
 * Frame-accurate video surface with a natively-timed measurement loop.
 *
 * Exists because `expo-video` does not surface either platform's per-frame callback — Media3's
 * `VideoFrameMetadataListener` on Android, `AVPlayerItemVideoOutput` + `CADisplayLink` on iOS.
 * Those callbacks are the mobile analogue of `requestVideoFrameCallback`, which is what the web
 * player's overlay sync is built on.
 */
const FrameClockView = React.forwardRef<FrameClockHandle, FrameClockViewProps>((props, ref) => (
  <NativeView {...props} ref={ref} />
));

FrameClockView.displayName = "FrameClockView";

export default FrameClockView;
