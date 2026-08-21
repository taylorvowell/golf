import { NativeModule, requireOptionalNativeModule } from "expo";

export interface ShutterKeyEvent {
  keyCode: number;
}

type ShutterRemoteEvents = {
  onShutterKey(event: ShutterKeyEvent): void;
};

declare class ShutterRemoteNativeModule extends NativeModule<ShutterRemoteEvents> {
  /** Claim (or release) the shutter keys for the current activity. Idempotent. */
  setActive(active: boolean): Promise<void>;
}

/**
 * Bluetooth shutter remotes as a record trigger — Android only. `null` on other platforms
 * and under Jest, so callers no-op instead of throwing; the native module's comment holds
 * the mechanics (HID keyboard → volume-key events → decor-view unhandled-key claim).
 */
export default requireOptionalNativeModule<ShutterRemoteNativeModule>("ShutterRemote");
