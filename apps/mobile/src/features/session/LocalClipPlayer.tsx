import { useCallback, useRef } from "react";
import { StyleSheet } from "react-native";

import type {
  FrameClockHandle,
  FrameRenderedEvent,
  ReadyEvent,
} from "../../../modules/frame-clock/src/FrameClock.types";
import FrameClockView from "../../../modules/frame-clock/src/FrameClockView";
import type { SwingClipRef } from "./sessionState";

/**
 * The just-recorded clip, looping — what the post-swing screen plays until analysis swaps in
 * the served swing (step 06). The whole trimmed clip IS the loop: it was cut to the review
 * window on Save, so there is no sub-range to manage here.
 */
export function LocalClipPlayer({ clip }: { clip: SwingClipRef }) {
  const player = useRef<FrameClockHandle>(null);

  /** The container's own duration, not the trim window's arithmetic — a keyframe-aligned cut
   * starts earlier than asked, and looping on the claimed length would clip the reseek. */
  const durationMsRef = useRef(clip.durationMs);

  const onReady = useCallback((e: { nativeEvent: ReadyEvent }) => {
    durationMsRef.current = e.nativeEvent.durationMs;
    void player.current?.seekToFrame(0);
    void player.current?.play();
  }, []);

  const onFrameRendered = useCallback(
    (e: { nativeEvent: FrameRenderedEvent }) => {
      const lastFrame = Math.floor((durationMsRef.current / 1000) * clip.fps) - 1;
      if (e.nativeEvent.frame >= lastFrame) void player.current?.seekToFrame(0);
    },
    [clip.fps],
  );

  return (
    <FrameClockView
      ref={player}
      source={`file://${clip.path}`}
      fps={clip.fps}
      emitFrames
      onReady={onReady}
      onFrameRendered={onFrameRendered}
      style={StyleSheet.absoluteFill}
    />
  );
}
