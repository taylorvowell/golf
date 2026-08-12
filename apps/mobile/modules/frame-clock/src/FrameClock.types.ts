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
  /**
   * The player's own reported position, in milliseconds.
   *
   * A third answer to "where are we", and reported alongside the other two because the frame-sync
   * panel exists to show that they can disagree. A position advancing while `onScreenFrame` does
   * not is a stall; a position matching neither is the wrong `fps`.
   */
  positionMs: number;
  /** The player's real state, not JS's intent — the transport reflects this, never its own wish. */
  playing: boolean;
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
  /**
   * Headers sent with every media request — `Authorization` above all.
   *
   * Without it the media route is answered as the development fallback identity and returns **404
   * rather than 401**, so an auth failure renders as a swing that does not exist (D48, D50). Pass
   * `api.mediaSource(path)`'s two fields together; they are produced together for this reason.
   */
  headers?: Record<string, string> | null;
  fps?: number;
  emitFrames?: boolean;
  surfaceType?: SurfaceType;
  onFrameRendered?: (event: { nativeEvent: FrameRenderedEvent }) => void;
  onReady?: (event: { nativeEvent: ReadyEvent }) => void;
  onPlayerError?: (event: { nativeEvent: { message: string } }) => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export interface FrameClockHandle {
  play: () => Promise<void>;
  pause: () => Promise<void>;
  /**
   * Seek to a frame's own presentation timestamp — `frame / fps`, **not** the web player's
   * midpoint rule. media3 resolves a seek forward to the next boundary, so aiming at the middle of
   * frame N lands on N+1 (D40). Measured 100% frame-exact at this target.
   */
  seekToFrame: (frame: number) => Promise<void>;
  /** Call immediately after committing an overlay, so native can score the drift. */
  markOverlayCommitted: (frame: number) => Promise<void>;
  /** Which seek target to aim at: "mid" | "start" | "early" | "prevMid". See seekTargetMs. */
  setSeekMode: (mode: string) => Promise<void>;
  /** 1 = real time, 0.25 = quarter speed. A 240fps clip at 0.25 plays at a true 60fps. */
  setPlaybackSpeed: (speed: number) => Promise<void>;
  getStats: () => Promise<FrameClockStats>;
  resetStats: () => Promise<void>;
}
