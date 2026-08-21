import { useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import { Check, RefreshCw } from "lucide-react-native";

import { FONT_BODY, FONT_DISPLAY } from "../../design/system/typography";
import { COLORS, SEMANTIC } from "../../theme";
import { DUAL_SYNC_CODE, viewLabel } from "./dualSync";
import type { CaptureView } from "./sessionState";

/**
 * The moment a second camera joins (Taylor, step-03 iteration).
 *
 * Pairing used to land as a card quietly swapping inside the sheet, which reads as nothing
 * happening. This is the confirmation instead: the whole screen takes the handshake, the sync
 * glyph spins while it negotiates, then it snaps to a full green CONNECTED and gets out of the
 * way — back to the capture screen, where the second angle is now a live tile under the thumb.
 *
 * It owns only its own timing. The parent decides when it exists and what `onDone` means.
 */

/** How long the handshake is shown before it resolves. */
const CONNECTING_MS = 2000;
/** How long the green confirmation holds before handing the screen back. */
const CONNECTED_MS = 900;

export interface DualSyncConnectOverlayProps {
  /** The angle the SECOND camera takes — the one this phone is not filming. */
  view: CaptureView;
  /** Fired once the confirmation has been seen; the parent marks the pair connected here. */
  onDone: () => void;
}

export function DualSyncConnectOverlay({ view, onDone }: DualSyncConnectOverlayProps) {
  const [connected, setConnected] = useState(false);
  const spin = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(0)).current;
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  // Fade the scrim in, then run the two phases on timers the component cleans up itself, so a
  // screen left mid-handshake never fires a stale `onDone`.
  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    const toConnected = setTimeout(() => setConnected(true), CONNECTING_MS);
    const toDone = setTimeout(() => onDoneRef.current(), CONNECTING_MS + CONNECTED_MS);
    return () => {
      clearTimeout(toConnected);
      clearTimeout(toDone);
    };
  }, [fade]);

  // The spin is the only thing on screen that says the handshake is still running.
  useEffect(() => {
    if (connected) return;
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 1100,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    spin.setValue(0);
    loop.start();
    return () => loop.stop();
  }, [connected, spin]);

  // The green disc arrives with a single overshoot — the beat that makes it a confirmation
  // rather than another state swap.
  useEffect(() => {
    if (!connected) return;
    pop.setValue(0);
    Animated.spring(pop, {
      toValue: 1,
      friction: 6,
      tension: 90,
      useNativeDriver: true,
    }).start();
  }, [connected, pop]);

  const angle = viewLabel(view).toLowerCase();

  return (
    <Animated.View
      pointerEvents="auto"
      style={[styles.root, { opacity: fade }]}
      testID="dual-sync-connect-overlay"
    >
      {connected ? (
        <Animated.View
          style={[
            styles.stack,
            {
              opacity: pop,
              transform: [
                { scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }) },
              ],
            },
          ]}
        >
          <View style={styles.disc}>
            <Check size={78} color="#FFFFFF" strokeWidth={3.4} />
          </View>
          <Text style={styles.connectedTitle}>Synced</Text>
          <Text style={styles.detail}>Second camera filming {angle}</Text>
        </Animated.View>
      ) : (
        <View style={styles.stack}>
          <Animated.View
            style={{
              transform: [
                {
                  rotate: spin.interpolate({
                    inputRange: [0, 1],
                    outputRange: ["0deg", "360deg"],
                  }),
                },
              ],
            }}
          >
            <RefreshCw size={78} color={COLORS.aqua} strokeWidth={2} />
          </Animated.View>
          <Text style={styles.connectingTitle}>Connecting…</Text>
          <Text style={styles.detail}>Pairing code {DUAL_SYNC_CODE}</Text>
        </View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(6,10,18,0.9)",
  },
  stack: { alignItems: "center", gap: 18, paddingHorizontal: 32 },
  disc: {
    width: 132,
    height: 132,
    borderRadius: 66,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: SEMANTIC.good,
  },
  connectingTitle: {
    color: "#FFFFFF",
    fontFamily: FONT_DISPLAY.black,
    fontSize: 26,
    letterSpacing: 0.4,
  },
  connectedTitle: {
    color: SEMANTIC.good,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 34,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  detail: {
    color: "rgba(255,255,255,0.7)",
    fontFamily: FONT_BODY.regular,
    fontSize: 13.5,
    textAlign: "center",
  },
});
