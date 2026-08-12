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
 * Everything here is bounded by the FILE. The web player bounds its controls by `playback_window`
 * — the 1s approach and run-out from `analysis.json` — which this step deliberately does not load,
 * because loading the analysis is what step 02 does for the overlay. Adopting the window is that
 * step's job, and it narrows these bounds rather than changing this math.
 */

/**
 * The highest seekable index, or `-1` when there is nothing to seek.
 *
 * Returned rather than assumed so a zero-frame clip is a case a caller must handle, not a seek to
 * frame `-1` that the native side silently clamps to zero and reports as success.
 */
export function lastFrame(frameCount: number): number {
  return Number.isFinite(frameCount) && frameCount > 0 ? Math.floor(frameCount) - 1 : -1;
}

/** Round to a whole frame and hold it inside the clip. Non-finite input lands on 0, not `NaN`. */
export function clampFrame(frame: number, frameCount: number): number {
  const last = lastFrame(frameCount);
  if (last < 0) return 0;
  if (!Number.isFinite(frame)) return 0;
  return Math.min(Math.max(Math.round(frame), 0), last);
}

/**
 * Step by `delta` frames, stopping at each end.
 *
 * Clamping rather than wrapping: at the last frame, "+1 frame" must do nothing visible. A wrap
 * would jump the golfer from the finish back to address, which reads as the control being broken
 * at exactly the moment they are studying the end of the swing.
 */
export function stepFrame(current: number, delta: number, frameCount: number): number {
  return clampFrame(clampFrame(current, frameCount) + Math.trunc(delta), frameCount);
}

/** The player's reported position as a frame index — the project's `round(t · fps)`. */
export function msToFrame(ms: number, fps: number): number {
  if (!Number.isFinite(ms) || !Number.isFinite(fps) || fps <= 0) return 0;
  return Math.round((ms / 1000) * fps);
}

/** Where a frame sits in the clip, 0–1. Drives the scrub thumb; the inverse of `fractionToFrame`. */
export function frameToFraction(frame: number, frameCount: number): number {
  const last = lastFrame(frameCount);
  if (last <= 0) return 0;
  return Math.min(Math.max(clampFrame(frame, frameCount) / last, 0), 1);
}

/** A position along the scrub bar as a frame. */
export function fractionToFrame(fraction: number, frameCount: number): number {
  const last = lastFrame(frameCount);
  if (last < 0) return 0;
  if (!Number.isFinite(fraction)) return 0;
  return clampFrame(fraction * last, frameCount);
}

/**
 * `frame · seconds` — what the transport shows.
 *
 * The frame number leads because it is the number this product is judged on and the one every
 * debug script speaks; the time is there so a viewer can relate it to a video they filmed.
 */
export function formatPosition(frame: number, fps: number): string {
  const seconds = Number.isFinite(fps) && fps > 0 ? frame / fps : 0;
  return `${frame} · ${seconds.toFixed(2)}s`;
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
export function isSeekable(frameCount: number, fps: number): boolean {
  return lastFrame(frameCount) >= 0 && Number.isFinite(fps) && fps > 0;
}
