import { useEffect, useMemo, useRef, useState } from "react";
import { PanResponder, Pressable, StyleSheet, Text, View } from "react-native";
import { SwitchCamera } from "lucide-react-native";

import { FONT_DISPLAY } from "../../design/system/typography";
import { COLORS } from "../../theme";
import {
  zoomIsAdjustable,
  type CameraFacing,
  type CameraZoom,
  type ZoomRange,
} from "./sessionState";

/**
 * The camera's own controls (Taylor, step-03 iteration), stacked on the LEFT edge above the
 * bar: the front/back flip orb on top, a continuous zoom slider beneath it. Glass over
 * footage — the help orb's language, mirrored side.
 *
 * Continuous, not stops (Taylor, 2026-08-18): Camera2 takes an arbitrary
 * `CONTROL_ZOOM_RATIO`, so stops were only ever a stand-in. The rail spans the lens's
 * PROBED range — never a guessed 0.5/1/2, which clamps to 1x on a phone with no ultra-wide
 * and would leave two dead buttons. A lens with nothing to give (`min === max`, the usual
 * front camera) renders no rail rather than a slider that does nothing.
 */

const TRACK_HEIGHT = 148;
/** Ratios within this much of 1x land exactly on it — the one stop worth keeping. */
const DETENT = 0.06;

/** Log mapping: linear would bury 1x in the first 5% of a 0.5–10x rail. */
function posFromZoom(zoom: number, range: ZoomRange): number {
  const span = Math.log(range.max) - Math.log(range.min);
  if (span <= 0) return 0;
  return (Math.log(zoom) - Math.log(range.min)) / span;
}

function zoomFromPos(pos: number, range: ZoomRange): number {
  const span = Math.log(range.max) - Math.log(range.min);
  const raw = Math.exp(Math.log(range.min) + pos * span);
  if (Math.abs(raw - 1) < DETENT && range.min <= 1 && range.max >= 1) return 1;
  return Math.round(raw * 10) / 10;
}

function label(zoom: number): string {
  return Number.isInteger(zoom) ? `${zoom}x` : `${zoom.toFixed(1)}x`;
}

export interface CameraControlsProps {
  facing: CameraFacing;
  zoom: CameraZoom;
  /** What the open lens actually supports, reported by the native preview. */
  zoomRange: ZoomRange;
  onFlip: () => void;
  onZoom: (zoom: CameraZoom) => void;
}

export function CameraControls({ facing, zoom, zoomRange, onFlip, onZoom }: CameraControlsProps) {
  const [height, setHeight] = useState(TRACK_HEIGHT);

  // The pan responder is built once; it reads the live range and callback through a ref so
  // a re-render mid-drag cannot swap the handler out from under the gesture.
  const latest = useRef({ zoomRange, onZoom, height });
  useEffect(() => {
    latest.current = { zoomRange, onZoom, height };
  });

  const responder = useMemo(() => {
    const grantY = { current: 0 };
    const applyY = (y: number) => {
      const { zoomRange: range, onZoom: emit, height: h } = latest.current;
      if (h <= 0) return;
      // Top of the rail is the most zoom — the direction a finger expects to push for "closer".
      const pos = 1 - Math.min(1, Math.max(0, y / h));
      emit(zoomFromPos(pos, range));
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        grantY.current = e.nativeEvent.locationY;
        applyY(grantY.current);
      },
      onPanResponderMove: (_e, g) => applyY(grantY.current + g.dy),
    });
  }, []);

  const adjustable = zoomIsAdjustable(zoomRange);
  const pos = adjustable ? posFromZoom(zoom, zoomRange) : 0;
  const thumbBottom = pos * height;

  return (
    <View style={styles.stack} pointerEvents="box-none">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={facing === "back" ? "Switch to front camera" : "Switch to back camera"}
        onPress={onFlip}
        style={({ pressed }) => [styles.orb, pressed && styles.pressed]}
        testID="camera-flip"
      >
        <SwitchCamera size={20} color="rgba(255,255,255,0.85)" strokeWidth={2.2} />
      </Pressable>

      {adjustable ? (
        <View style={styles.zoomGroup} pointerEvents="box-none">
          <View
            accessibilityRole="adjustable"
            accessibilityLabel="Zoom"
            accessibilityValue={{
              min: Math.round(zoomRange.min * 10),
              max: Math.round(zoomRange.max * 10),
              now: Math.round(zoom * 10),
              text: label(zoom),
            }}
            accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
            onAccessibilityAction={(e) => {
              const step = e.nativeEvent.actionName === "increment" ? 0.05 : -0.05;
              const next = Math.min(1, Math.max(0, posFromZoom(zoom, zoomRange) + step));
              onZoom(zoomFromPos(next, zoomRange));
            }}
            style={styles.slider}
            testID="camera-zoom-slider"
            onLayout={(e) => setHeight(e.nativeEvent.layout.height)}
            {...responder.panHandlers}
          >
            <View style={styles.track} pointerEvents="none" />
            <View style={[styles.trackFill, { height: thumbBottom }]} pointerEvents="none" />
            <View style={[styles.thumb, { bottom: thumbBottom - 14 }]} pointerEvents="none">
              <Text style={styles.thumbText}>{label(zoom)}</Text>
            </View>
          </View>
          {/* Names the rail (Taylor) — a bare vertical line reads as decoration otherwise. */}
          <View style={styles.zoomTag} pointerEvents="none">
            <Text style={styles.zoomTagText}>Zoom</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Positioned by the screen — the stack only owns its own layout.
  stack: { gap: 8, alignItems: "center" },
  orb: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(11,16,28,0.66)",
  },
  zoomGroup: { alignItems: "center", gap: 4 },
  zoomTag: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 9,
    backgroundColor: "rgba(11,16,28,0.66)",
  },
  zoomTagText: {
    color: "rgba(255,255,255,0.8)",
    fontFamily: FONT_DISPLAY.black,
    fontSize: 9,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  // 44 wide so the touch target is a thumb's width even though the rail reads as 4.
  slider: { width: 44, height: TRACK_HEIGHT, alignItems: "center", justifyContent: "flex-end" },
  track: {
    position: "absolute",
    width: 4,
    top: 0,
    bottom: 0,
    borderRadius: 2,
    backgroundColor: "rgba(11,16,28,0.66)",
  },
  trackFill: { position: "absolute", bottom: 0, width: 4, borderRadius: 2, backgroundColor: COLORS.aqua },
  thumb: {
    position: "absolute",
    width: 34,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.aqua,
  },
  thumbText: { color: COLORS.onAqua, fontFamily: FONT_DISPLAY.black, fontSize: 10 },
  pressed: { opacity: 0.6 },
});
