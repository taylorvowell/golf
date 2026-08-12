import { useMemo, useRef, useState } from "react";
import { PanResponder, type LayoutChangeEvent } from "react-native";

import { fractionToFrame, type Extent } from "./frames";

/**
 * Turns any full-width view into something you can scrub with.
 *
 * Two things need this — the thumbnail strip and the scrub bar under it — and they must agree
 * exactly about where frame N is, because they sit one above the other with a playhead crossing
 * both. Two copies of "x over width, mapped onto the window" is precisely the kind of duplication
 * that drifts by one frame and then reads as a sync bug.
 *
 * ## Everything the gesture reads lives in a ref
 *
 * `PanResponder` is created once and its handlers close over whatever was in scope then, so reading
 * `width` or `onSeek` directly would scrub against first render's layout — zero width, every touch
 * mapping to the first frame. The symptom is a surface that works only after some unrelated
 * re-render, which is why this is refs rather than a dependency array.
 *
 * ## And the origin comes from `pageX`
 *
 * A drag routinely leaves the surface — a finger travelling along a 40pt strip does not stay on it
 * — and `locationX` stops describing this view once it does. `pageX` always describes the screen,
 * so the origin is derived once from the pair at grant and every move is measured against it.
 */

export interface SeekSurface {
  /** Spread onto the view. */
  panHandlers: ReturnType<typeof PanResponder.create>["panHandlers"];
  onLayout: (e: LayoutChangeEvent) => void;
  /** The measured width, for anything that has to draw at a fraction of it. */
  width: number;
}

export function useSeekSurface(
  bounds: Extent,
  onSeek: (frame: number) => void,
  disabled: boolean,
  onScrubbingChange?: (scrubbing: boolean) => void,
): SeekSurface {
  const [width, setWidth] = useState(0);

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

  const originRef = useRef(0);

  const responder = useMemo(() => {
    function seekAtPage(pageX: number) {
      const w = widthRef.current;
      if (w <= 0 || disabledRef.current) return;
      seekRef.current(fractionToFrame((pageX - originRef.current) / w, boundsRef.current));
    }

    return PanResponder.create({
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
    });
  }, []);

  return {
    panHandlers: responder.panHandlers,
    onLayout: (e: LayoutChangeEvent) => {
      const next = e.nativeEvent.layout.width;
      setWidth(next);
      widthRef.current = next;
    },
    width,
  };
}
