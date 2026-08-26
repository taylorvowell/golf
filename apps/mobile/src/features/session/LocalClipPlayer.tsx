import { useCallback, useEffect, useRef } from "react";
import { AppState, StyleSheet } from "react-native";

import type {
  FrameClockHandle,
  FrameRenderedEvent,
  ReadyEvent,
} from "../../../modules/frame-clock/src/FrameClock.types";
import FrameClockView from "../../../modules/frame-clock/src/FrameClockView";
import type { SwingClipRef } from "./sessionState";

/**
 * The just-recorded clip, looping — what the post-swing screen plays until analysis swaps in
 * the served swing. The whole trimmed clip IS the loop: it was cut to the review
 * window on Save, so there is no sub-range to manage here.
 */
export function LocalClipPlayer({ clip }: { clip: SwingClipRef }) {
  const player = useRef<FrameClockHandle>(null);

  /** The container's own duration, not the trim window's arithmetic — a keyframe-aligned cut
   * starts earlier than asked, and looping on the claimed length would clip the reseek. */
  const durationMsRef = useRef(clip.durationMs);

  const onReady = useCallback((e: { nativeEvent: ReadyEvent }) => {
    durationMsRef.current = e.nativeEvent.durationMs;
    // An IMPORTED phone slow-mo runs 8× slower than the world in its own timeline — play it at
    // real speed, like every preview of it did. Anything this app records is factor 1.
    const speed = Math.max(1, clip.slowMoFactor ?? 1);
    if (speed !== 1) void player.current?.setPlaybackSpeed(speed);
    void player.current?.seekToFrame(0);
    void player.current?.play();
  }, [clip.slowMoFactor]);

  /** True between reaching the end and the seek landing — without it, every frame past the
   * last one re-fires the seek instead of one seek re-firing the loop. */
  const looping = useRef(false);

  const onFrameRendered = useCallback(
    (e: { nativeEvent: FrameRenderedEvent }) => {
      const lastFrame = Math.floor((durationMsRef.current / 1000) * clip.fps) - 1;
      if (e.nativeEvent.frame >= lastFrame) {
        if (looping.current) return;
        looping.current = true;
        void player.current?.seekToFrame(0);
      } else {
        looping.current = false;
      }
    },
    [clip.fps],
  );

  /**
   * Nothing plays while the app is backgrounded (`.claude/rules/react-native.md`, Lifecycle).
   * Without this the decoder keeps running behind the home button — battery on a screen the
   * golfer cannot see, and the one rule the report player already keeps.
   */
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") void player.current?.play();
      else void player.current?.pause();
    });
    return () => sub.remove();
  }, []);

  return (
    <FrameClockView
      ref={player}
      source={`file://${clip.path}`}
      fps={clip.fps}
      emitFrames
      onReady={onReady}
      onFrameRendered={onFrameRendered}
      // The house rule (`.claude/rules/react-native.md`): every video passes this. This screen
      // lives inside the session surface's own slide, and a SurfaceView ignores ancestor
      // transforms and z-order — the last un-migrated player in the app.
      surfaceType="textureView"
      style={StyleSheet.absoluteFill}
    />
  );
}
