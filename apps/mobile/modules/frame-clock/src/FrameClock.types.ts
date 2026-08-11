import type { StyleProp, ViewStyle } from "react-native";

/**
 * Summary of one measured quantity.
 *
 * `p95` and `max` are the load-bearing fields, not `mean`. A mean hides the pathology the spike
 * exists to find — an overlay that is perfect almost always and slips several frames a few times
 * a second, which a viewer reads as the picture tearing away from the drawing.
 */
export interface StatSummary {
  count: number;
  mean: number;
  p50: number;
  p95: number;
  max: number;
  /** Share of samples that were exactly 0. The only outcome that counts as "locked". */
  exactShare: number;
}

export interface FrameClockStats {
  /** Frames between the overlay JS committed and the frame actually on the glass. */
  overlayDriftFrames: StatSummary;
  /**
   * Milliseconds of LEAD: how far ahead of a frame's scheduled display time JS learns about it.
   * Positive is good — it is the budget a JS-driven overlay has to draw in before the frame is
   * due on screen.
   */
  leadTimeMs: StatSummary;
  /** Requested frame minus presented frame, after a seek. */
  seekErrorFrames: StatSummary;
  /** The frame actually on screen: newest one whose scheduled display time has passed. */
  onScreenFrame: number;
  /** The newest frame the decoder has queued. Ahead of `onScreenFrame` by the lead time. */
  queuedFrame: number;
  fps: number;
}

export interface FrameRenderedEvent {
  frame: number;
  presentationTimeUs: number;
  releaseTimeNs: number;
}

export interface ReadyEvent {
  durationMs: number;
  width: number;
  height: number;
  /** The container's own frame rate. Compare against the `fps` prop — a mismatch means every
   *  frame index is wrong while each component looks individually correct. */
  containerFps: number;
}

/**
 * Android's default `surfaceView` is faster and lower-power; `textureView` composites
 * conventionally and is the documented workaround for z-ordering problems with overlapping
 * views. Which one an overlay-on-video layout needs is a measurement. No-op on iOS.
 */
export type SurfaceType = "surfaceView" | "textureView";


export type FrameClockViewProps = {
  source?: string | null;
  fps?: number;
  emitFrames?: boolean;
  surfaceType?: SurfaceType;
  onFrameRendered?: (event: { nativeEvent: FrameRenderedEvent }) => void;
  onReady?: (event: { nativeEvent: ReadyEvent }) => void;
  onPlayerError?: (event: { nativeEvent: { message: string } }) => void;
  style?: StyleProp<ViewStyle>;
};

export interface FrameClockHandle {
  play: () => Promise<void>;
  pause: () => Promise<void>;
  /** Seek to the middle of the frame's display interval — `(frame + 0.5) / fps`. */
  seekToFrame: (frame: number) => Promise<void>;
  /** Call immediately after committing an overlay, so native can score the drift. */
  markOverlayCommitted: (frame: number) => Promise<void>;
  /** 1 = real time, 0.25 = quarter speed. A 240fps clip at 0.25 plays at a true 60fps. */
  setPlaybackSpeed: (speed: number) => Promise<void>;
  getStats: () => Promise<FrameClockStats>;
  resetStats: () => Promise<void>;
}
