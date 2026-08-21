import { useEffect, useRef } from "react";

import ShutterRemote from "../../../modules/shutter-remote/src";

/**
 * A Bluetooth camera shutter remote (or the phone's own volume rocker) as the record button.
 *
 * Mounted only by the session screen: the native side claims the shutter keys for exactly as
 * long as this hook is live, so volume behaves normally everywhere else in the app. The
 * handler rides in a ref so re-renders never re-register the native listener; on platforms
 * without the module (iOS, Jest) the hook is a no-op.
 */
export function useShutterRemote(onPress: () => void) {
  const handler = useRef(onPress);
  useEffect(() => {
    handler.current = onPress;
  }, [onPress]);

  useEffect(() => {
    const remote = ShutterRemote;
    if (!remote) return;
    const sub = remote.addListener("onShutterKey", () => handler.current());
    void remote.setActive(true);
    return () => {
      sub.remove();
      void remote.setActive(false);
    };
  }, []);
}
