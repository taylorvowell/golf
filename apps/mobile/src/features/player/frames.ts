/**
 * Frame arithmetic for the mobile player.
 *
 * Kept apart from anything that renders because this is the half that can be wrong without looking
 * wrong. A player off by one frame plays perfectly well; it only becomes visible in step 02, when
 * a skeleton drawn for frame N lands on the picture of N+1 and the whole overlay reads as
 * "the pose model is bad".
 *
 * Two conventions are load-bearing here and both are project rules rather than preferences:
 *
 *   * **`frame = round(t · fps)`** is exact because Stage 0 normalizes every analysed clip to CFR.
 *     On a variable-frame-rate source it is not exact and this player would be wrong — which is
 *     why the analyzer normalizes rather than the client compensating.
 *   * **The seek target is `frame / fps`, never `(frame + 0.5) / fps`.** That arithmetic lives in
 *     the native module (`seekTargetMs`) so there is exactly one copy of it; D40 measured the
 *     midpoint rule landing one frame late on every seek. Nothing in this file computes a seek
 *     target — if you find yourself adding one, it belongs there instead.
 *
 * Bounds are a VALUE here, not a constant. Step 01 was bounded by the file; step 02 bounds the
 * transport by `playback_window` — the 1s approach and run-out the analyzer publishes — because
 * that is the span worth playing and it is a property of the swing rather than of the viewer. Both
 * are the same arithmetic over a different extent, which is why every function below takes an
 * `Extent`: a bare frame count still means the whole file, so nothing that only knows about the
 * file had to change.
 */

/**
 * A seekable span, first and last inclusive.
 *
 * `first` exists because the playback window rarely starts at zero — swing1's opens at frame 90 of
 * 396 — and a scrub bar that maps its left edge to frame 0 would spend a fifth of its travel
 * outside the span it is drawing.
 */
export interface Bounds {
  first: number;
  last: number;
}

/**
 * Either an explicit span, or a frame count meaning "the whole file".
 *
 * The number form is not a shortcut: the file IS an extent, and it is the right one for anything
 * that must reach frames outside the window (step 04's dual-view alignment, a future head-marker
 * editor whose most-needed frames sit in the approach, before the window opens).
 */
export type Extent = number | Bounds;

/**
 * The highest seekable index, or `-1` when there is nothing to seek.
 *
 * Returned rather than assumed so a zero-frame clip is a case a caller must handle, not a seek to
 * frame `-1` that the native side silently clamps to zero and reports as success.
 */
export function lastFrame(frameCount: number): number {
  return Number.isFinite(frameCount) && frameCount > 0 ? Math.floor(frameCount) - 1 : -1;
}

/** The whole file as bounds. `first` is 0; `last` is `-1` when there is nothing to seek. */
export function fileBounds(frameCount: number): Bounds {
  return { first: 0, last: lastFrame(frameCount) };
}

/**
 * The playback window as bounds, held inside the file.
 *
 * A null window is the whole file rather than an empty span — artifacts older than schema 5 carry
 * no window, and refusing to play one would be a client deciding an old swing is unplayable.
 * A window that does not intersect the file is discarded for the same reason.
 */
export function windowBounds(frameCount: number, window: readonly number[] | null): Bounds {
  const file = fileBounds(frameCount);
  if (!window || window.length !== 2 || file.last < 0) return file;
  const first = Math.max(file.first, Math.round(window[0]));
  const last = Math.min(file.last, Math.round(window[1]));
  return last > first ? { first, last } : file;
}

function extent(e: Extent): Bounds {
  return typeof e === "number" ? fileBounds(e) : e;
}

/** Round to a whole frame and hold it inside the extent. Non-finite input lands on the start. */
export function clampFrame(frame: number, e: Extent): number {
  const { first, last } = extent(e);
  if (last < 0) return 0;
  if (!Number.isFinite(frame)) return first;
  return Math.min(Math.max(Math.round(frame), first), last);
}

/**
 * Step by `delta` frames, stopping at each end.
 *
 * Clamping rather than wrapping: at the last frame, "+1 frame" must do nothing visible. A wrap
 * would jump the golfer from the finish back to address, which reads as the control being broken
 * at exactly the moment they are studying the end of the swing.
 */
export function stepFrame(current: number, delta: number, e: Extent): number {
  return clampFrame(clampFrame(current, e) + Math.trunc(delta), e);
}

/** The player's reported position as a frame index — the project's `round(t · fps)`. */
export function msToFrame(ms: number, fps: number): number {
  if (!Number.isFinite(ms) || !Number.isFinite(fps) || fps <= 0) return 0;
  return Math.round((ms / 1000) * fps);
}

/** Where a frame sits in the extent, 0–1. Drives the scrub thumb; inverse of `fractionToFrame`. */
export function frameToFraction(frame: number, e: Extent): number {
  const { first, last } = extent(e);
  if (last <= first) return 0;
  return Math.min(Math.max((clampFrame(frame, e) - first) / (last - first), 0), 1);
}

/** A position along the scrub bar as a frame. */
export function fractionToFrame(fraction: number, e: Extent): number {
  const { first, last } = extent(e);
  if (last < 0) return 0;
  if (!Number.isFinite(fraction)) return first;
  return clampFrame(first + fraction * (last - first), e);
}

/**
 * Whether the container's own frame rate disagrees with the rate the analysis was measured at.
 *
 * This is a real failure mode with no visible symptom: every frame index would be wrong while the
 * video, the transport and the numbers each look individually correct. `0` means the container did
 * not declare a rate — unknown is not a disagreement, and claiming one would be the same class of
 * mistake this check exists to catch.
 */
export function fpsDisagrees(containerFps: number, declaredFps: number): boolean {
  if (!Number.isFinite(containerFps) || containerFps <= 0) return false;
  if (!Number.isFinite(declaredFps) || declaredFps <= 0) return false;
  return Math.abs(containerFps - declaredFps) > 0.5;
}

/**
 * Whether this swing can be driven frame by frame at all.
 *
 * A transport that cannot compute a frame index must not be drawn: buttons that move nothing and a
 * scrub bar that reports a position it made up are worse than an honest plain video, because the
 * golfer has no way to tell the difference between a broken control and a swing that genuinely
 * sits still.
 */
export function isSeekable(e: Extent, fps: number): boolean {
  return extent(e).last >= 0 && Number.isFinite(fps) && fps > 0;
}
