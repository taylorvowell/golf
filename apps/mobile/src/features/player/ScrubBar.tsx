import { StyleSheet, View } from "react-native";

import { DECK } from "../../design/deck";
import { stepFrame, type Extent } from "./frames";
import type { ScrubMap } from "./phaseBands";
import { useSeekSurface } from "./useSeekSurface";

/**
 * The scrub strip.
 *
 * Built on `PanResponder` from React Native itself (via `useSeekSurface`) rather than a slider
 * package or `react-native-gesture-handler` — the latter is deliberately excluded from autolinking
 * (D47) and a slider that speaks percentages would put a second frame↔position conversion in the
 * app. This one converts once, through `frames.ts`, and reports whole frames. The phase bar above
 * it shares that surface, which is what keeps the two agreeing about where frame N is.
 *
 * The track is thin and the touch target is not: §41's bar is one-handed use in bright sunlight on
 * a driving range, so the grabbable area is 40pt tall around a 3pt line.
 */

export interface ScrubBarProps {
  frame: number;
  /** For the spoken position. A scrub bar that only announces a percentage is not a transport. */
  fps?: number;
  /**
   * The span the bar spans — the playback window once the analysis has loaded, the whole file
   * before that. Not a frame count: the window rarely starts at zero (swing1's opens at frame 90
   * of 396), so a bar mapping its left edge to frame 0 would spend a fifth of its travel outside
   * the span it is drawing.
   */
  bounds: Extent;
  /** The transport's one x↔frame mapping — weighted bands included. See `scrubMap`. */
  map: ScrubMap;
  onSeek: (frame: number) => void;
  /** Fires on touch-down and release so the caller can show that the scrub is live. */
  onScrubbingChange?: (scrubbing: boolean) => void;
  disabled?: boolean;
}

export function ScrubBar({
  frame,
  fps = 0,
  bounds,
  map,
  onSeek,
  onScrubbingChange,
  disabled = false,
}: ScrubBarProps) {
  const surface = useSeekSurface(map.toFrame, onSeek, disabled, onScrubbingChange);
  const fraction = map.toFraction(frame);

  /**
   * A drag is not a gesture a screen reader can make.
   *
   * `adjustable` plus the two actions is the whole of how this control is reachable without sight
   * — TalkBack swipes up and down on it and gets a frame at a time. Announcing a percentage would
   * be useless here: the unit a golfer works in is the frame, so that is what is spoken.
   */
  const spoken =
    fps > 0 ? `frame ${frame}, ${(frame / fps).toFixed(2)} seconds` : `frame ${frame}`;

  return (
    <View
      testID="scrub-bar"
      style={styles.touch}
      onLayout={surface.onLayout}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel="Swing position"
      accessibilityState={{ disabled }}
      accessibilityValue={{ text: spoken }}
      accessibilityActions={ADJUST_ACTIONS}
      onAccessibilityAction={(e) => {
        if (disabled) return;
        if (e.nativeEvent.actionName === "increment") onSeek(stepFrame(frame, 1, bounds));
        if (e.nativeEvent.actionName === "decrement") onSeek(stepFrame(frame, -1, bounds));
      }}
      {...surface.panHandlers}
    >
      <View style={[styles.track, disabled && styles.trackDisabled]}>
        <View style={[styles.fill, { width: `${fraction * 100}%` }]} />
      </View>
      {!disabled ? (
        <View
          testID="scrub-thumb"
          pointerEvents="none"
          style={[styles.thumb, { left: `${fraction * 100}%` }]}
        />
      ) : null}
    </View>
  );
}

const ADJUST_ACTIONS = [{ name: "increment" }, { name: "decrement" }] as const;

/**
 * The drawn track is a hairline and the touch target is not.
 *
 * `SCRUB_TOUCH` is also load-bearing for layout: the playhead line above this bar terminates at the
 * thumb, and it finds it at `SCRUB_TOUCH / 2` from this view's top. Change one and the line stops
 * halfway.
 */
const TRACK = 3;
const THUMB = 20;
export const SCRUB_TOUCH = 40;

const styles = StyleSheet.create({
  touch: { height: SCRUB_TOUCH, justifyContent: "center" },
  track: {
    height: TRACK,
    borderRadius: TRACK / 2,
    backgroundColor: "rgba(255,255,255,0.18)",
    overflow: "hidden",
  },
  trackDisabled: { opacity: 0.4 },
  fill: { height: "100%", backgroundColor: DECK.accent },
  // A ring, not a dot: it sits over the picture, and a filled disc the size of a fingertip hides
  // exactly the part of the frame the golfer is scrubbing towards.
  thumb: {
    position: "absolute",
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    marginLeft: -THUMB / 2,
    borderWidth: 5,
    borderColor: DECK.accent,
    backgroundColor: "#0b0e0c",
  },
});
