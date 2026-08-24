import { StyleSheet, Text, View } from "react-native";

import { FONT_DISPLAY } from "../../design/system/typography";

/**
 * The capture-rate badge (Taylor, 2026-08-23) — the anti-silent-degrade instrument made
 * visible. §2.3 forbids recording slower than asked without saying so; this is where it
 * gets said: the rate the running take actually CONFIGURED, which is the ladder's resolved
 * answer and never the request. There is no picker — capture is always the highest rate the
 * open lens offers, so the only honest thing to show is what it landed on.
 *
 * Glass over footage: the ground is the REC chip's own `rgba(11,16,28,…)`, one chip family
 * per surface.
 */

/** The recording overlay's face: the configured rate, quietly, or nothing until known. */
export function FpsBadge({ fps }: { fps: number | null }) {
  if (fps === null) return null;
  return (
    <View style={styles.badge} pointerEvents="none" testID="fps-badge">
      <Text style={styles.badgeText}>{`${fps} FPS`}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  /** Subtler than a control on purpose — while recording it is information, not something
   *  to touch. */
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "rgba(11,16,28,0.5)",
  },
  badgeText: {
    color: "rgba(255,255,255,0.72)",
    fontFamily: FONT_DISPLAY.black,
    fontSize: 10,
    letterSpacing: 0.7,
  },
});
