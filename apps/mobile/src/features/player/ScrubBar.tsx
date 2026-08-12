import { useMemo, useRef, useState } from "react";
import { PanResponder, StyleSheet, View, type LayoutChangeEvent } from "react-native";

import { DECK } from "../../design/deck";
import { fractionToFrame, frameToFraction, type Extent } from "./frames";

/**
 * The scrub strip.
 *
 * Built on `PanResponder` from React Native itself rather than a slider package or
 * `react-native-gesture-handler` — the latter is deliberately excluded from autolinking (D47) and
 * a slider that speaks percentages would put a second frame↔position conversion in the app. This
 * one converts once, through `frames.ts`, and reports whole frames.
 *
 * The track is thin and the touch target is not: §41's bar is one-handed use in bright sunlight on
 * a driving range, so the grabbable area is 44pt tall around a 6pt line.
 */

export interface ScrubBarProps {
  frame: number;
  /**
   * The span the bar spans — the playback window once the analysis has loaded, the whole file
   * before that. Not a frame count: the window rarely starts at zero (swing1's opens at frame 90
   * of 396), so a bar mapping its left edge to frame 0 would spend a fifth of its travel outside
   * the span it is drawing.
   */
  bounds: Extent;
  onSeek: (frame: number) => void;
  /** Fires on touch-down and release so the caller can show that the scrub is live. */
  onScrubbingChange?: (scrubbing: boolean) => void;
  disabled?: boolean;
}

export function ScrubBar({
  frame,
  bounds,
  onSeek,
  onScrubbingChange,
  disabled = false,
}: ScrubBarProps) {
  const [width, setWidth] = useState(0);

  /**
   * Mirrors of everything the gesture callbacks read.
   *
   * `PanResponder` is created once and its handlers close over whatever was in scope then, so
   * reading `width` or `onSeek` directly would scrub against first render's layout — zero width,
   * every touch mapping to frame 0. The symptom is a bar that works only after some unrelated
   * re-render, which is why this is refs rather than a dependency array.
   */
  const widthRef = useRef(0);
  const seekRef = useRef(onSeek);
  const boundsRef = useRef(bounds);
  const disabledRef = useRef(disabled);
  const scrubbingRef = useRef(onScrubbingChange);
  widthRef.current = width;
  seekRef.current = onSeek;
  boundsRef.current = bounds;
  disabledRef.current = disabled;
  scrubbingRef.current = onScrubbingChange;

  /**
   * Page-space x of the bar's left edge, captured when the gesture starts.
   *
   * A drag routinely leaves the bar — a finger travelling along a 6pt line does not stay on it —
   * and `locationX` stops describing this view once it does. `pageX` always describes the screen,
   * so the origin is derived once from the pair at grant and every move is measured against it.
   */
  const originRef = useRef(0);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !disabledRef.current,
        onMoveShouldSetPanResponder: () => !disabledRef.current,
        onPanResponderGrant: (e) => {
          const { pageX, locationX } = e.nativeEvent;
          originRef.current = pageX - locationX;
          scrubbingRef.current?.(true);
          seekAtPage(pageX);
        },
        onPanResponderMove: (e) => seekAtPage(e.nativeEvent.pageX),
        onPanResponderRelease: () => scrubbingRef.current?.(false),
        onPanResponderTerminate: () => scrubbingRef.current?.(false),
      }),
    [],
  );

  function seekAtPage(pageX: number) {
    const w = widthRef.current;
    if (w <= 0 || disabledRef.current) return;
    seekRef.current(fractionToFrame((pageX - originRef.current) / w, boundsRef.current));
  }

  function onLayout(e: LayoutChangeEvent) {
    const next = e.nativeEvent.layout.width;
    setWidth(next);
    widthRef.current = next;
  }

  const fraction = frameToFraction(frame, bounds);

  return (
    <View testID="scrub-bar" style={styles.touch} onLayout={onLayout} {...responder.panHandlers}>
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

/**
 * The drawn track is a hairline and the touch target is not.
 *
 * `TOUCH` is also load-bearing for layout: the playhead line above this bar terminates at the
 * thumb, and it finds it at `TOUCH / 2` from this view's top. Change one and the line stops
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
