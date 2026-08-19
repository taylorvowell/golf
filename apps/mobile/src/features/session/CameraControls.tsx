import { Pressable, StyleSheet, Text, View } from "react-native";
import { SwitchCamera } from "lucide-react-native";

import { FONT_DISPLAY } from "../../design/system/typography";
import { COLORS } from "../../theme";
import { CAMERA_ZOOMS, type CameraFacing, type CameraZoom } from "./sessionState";

/**
 * The camera's own controls (Taylor, step-03 iteration), stacked on the LEFT edge above the
 * bar: the front/back flip orb on top, the zoom stops beneath it. Glass orbs over footage —
 * the help orb's language, mirrored side.
 *
 * UI phase: the stops are the stub 0.5/1/2 and the flip is state only; step 04 binds both
 * to the real Camera2 session (and replaces the stops with the device's probed range).
 */

export interface CameraControlsProps {
  facing: CameraFacing;
  zoom: CameraZoom;
  onFlip: () => void;
  onZoom: (zoom: CameraZoom) => void;
}

export function CameraControls({ facing, zoom, onFlip, onZoom }: CameraControlsProps) {
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
      {CAMERA_ZOOMS.map((stop) => {
        const active = stop === zoom;
        return (
          <Pressable
            key={stop}
            accessibilityRole="button"
            accessibilityLabel={`${stop}x zoom`}
            accessibilityState={{ selected: active }}
            onPress={() => onZoom(stop)}
            style={({ pressed }) => [
              styles.orb,
              styles.zoomOrb,
              active && styles.zoomOrbActive,
              pressed && styles.pressed,
            ]}
            testID={`camera-zoom-${stop}`}
          >
            <Text style={[styles.zoomText, active && styles.zoomTextActive]}>
              {active ? `${stop}x` : `${stop}`}
            </Text>
          </Pressable>
        );
      })}
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
  zoomOrb: { width: 38, height: 38, borderRadius: 19 },
  zoomOrbActive: { backgroundColor: COLORS.aqua },
  zoomText: {
    color: "rgba(255,255,255,0.85)",
    fontFamily: FONT_DISPLAY.black,
    fontSize: 11,
  },
  zoomTextActive: { color: COLORS.onAqua },
  pressed: { opacity: 0.6 },
});
