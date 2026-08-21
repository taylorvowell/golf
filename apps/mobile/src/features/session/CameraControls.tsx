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
/** The rail is the width of the handle that rides it — one column, not a pill on a hairline. */
const TRACK_WIDTH = 34;
/** The handle is a circle of the rail's width, and it travels INSIDE the rail — never past it. */
const THUMB = TRACK_WIDTH;
/** The travelled part of the rail: aqua, but translucent enough that the pill still reads. */
const AQUA_FILL = "rgba(67,205,208,0.34)";
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
      const travel = h - THUMB;
      if (travel <= 0) return;
      // Top of the rail is the most zoom — the direction a finger expects to push for "closer".
      // Measured against the handle's TRAVEL, not the raw height, so the circle's centre sits
      // under the finger at both ends instead of running out of rail half a handle early.
      const pos = 1 - Math.min(1, Math.max(0, (y - THUMB / 2) / travel));
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
  // The handle rides between the rail's ends; the fill stops at its centre, so the two agree.
  const thumbBottom = pos * Math.max(0, height - THUMB);
  const fillHeight = thumbBottom + THUMB / 2;

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
            <View style={[styles.trackFill, { height: fillHeight }]} pointerEvents="none" />
            <View style={[styles.thumb, { bottom: thumbBottom }]} pointerEvents="none">
              <Text style={styles.thumbText}>{label(zoom)}</Text>
            </View>
          </View>
          {/* Names the rail (Taylor) — a bare column reads as decoration otherwise. Bare text,
              no chip: the rail already carries the glass, and a second one stacks two. */}
          <Text style={styles.zoomTagText} pointerEvents="none">
            Zoom
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Positioned by the screen — the stack only owns its own layout.
  // Room to breathe above the rail (Taylor) — the flip orb was crowding it.
  stack: { gap: 18, alignItems: "center" },
  orb: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(11,16,28,0.66)",
  },
  zoomGroup: { alignItems: "center", gap: 6 },
  zoomTagText: {
    color: "rgba(255,255,255,0.8)",
    fontFamily: FONT_DISPLAY.black,
    fontSize: 9,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  // The touch target stays a thumb wide; the rail now reads at the pill's own width (Taylor),
  // so the control is one column rather than a pill riding a hairline.
  slider: { width: 44, height: TRACK_HEIGHT, alignItems: "center", justifyContent: "flex-end" },
  track: {
    position: "absolute",
    width: TRACK_WIDTH,
    top: 0,
    bottom: 0,
    borderRadius: TRACK_WIDTH / 2,
    // Barely-there glass (Taylor): at full width the old opacity read as a solid bar over the
    // footage, and the framing behind it is what the golfer is actually looking at.
    backgroundColor: "rgba(11,16,28,0.28)",
  },
  trackFill: {
    position: "absolute",
    bottom: 0,
    width: TRACK_WIDTH,
    // Rounded at the foot only: the top edge dies under the circular handle, and a radius
    // there leaves a visible crescent of unfilled rail beside it (Taylor).
    borderBottomLeftRadius: TRACK_WIDTH / 2,
    borderBottomRightRadius: TRACK_WIDTH / 2,
    backgroundColor: AQUA_FILL,
  },
  thumb: {
    position: "absolute",
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.aqua,
  },
  thumbText: { color: COLORS.onAqua, fontFamily: FONT_DISPLAY.black, fontSize: 10 },
  pressed: { opacity: 0.6 },
});
