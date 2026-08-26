import type { SyncSubject } from "@swingsage/schema/contract";

/**
 * Filling half a phone screen with a golfer instead of with the room they are standing in.
 *
 * ## The problem this solves is arithmetic, not taste
 *
 * A swing clip is portrait — 1080×1920 — and a comparison puts two of them side by side. On an
 * S25+ that is 411 dp of width for two columns, so each is 203 dp, and a 9:16 picture fitted into
 * 203 dp is 203×361 in a space nearly 900 dp tall. Forty per cent of the screen is used, and the
 * golfer — who occupies about a fifth of the frame's width, measured across the ten fixtures — is
 * roughly forty display pixels wide. Two golfers that size cannot be compared; the whole feature
 * would be technically correct and useless.
 *
 * Cropping to the analyzer's own subject box roughly doubles them, and does something the extra
 * size alone does not: it makes the two golfers **the same apparent size**, which is the first
 * requirement for comparing shapes at all. One filmed from six feet and one from twelve are not
 * comparable pictures until this runs.
 *
 * ## And the reason it is capped
 *
 * `6iron-1`'s subject box is 22 % of the frame's width — filling a column with it is a 3× upscale
 * of the source pixels, which is visibly soft. A cap trades some size back for sharpness. It binds
 * on the tightest fixtures only; most land near 2×.
 */

/** How far past its natural size the picture may be scaled. Beyond this the upscale shows. */
const MAX_ZOOM = 2.2;

export interface PaneCrop {
  /** The video view's size inside the pane — larger than the pane whenever anything is cropped. */
  width: number;
  height: number;
  /** Where to put it, relative to the pane's top-left. Zero or negative. */
  left: number;
  top: number;
  /** Flip the picture horizontally — the two golfers swing from opposite sides. */
  mirrored: boolean;
}

/**
 * Lay one swing's picture out inside a pane.
 *
 * `subject` null (no confident pose, or an artifact too old to carry one) is not a failure: the
 * picture is simply shown whole, which is what every player in this app already does.
 *
 * `mirrored` flips the video **and the crop with it**, because the two are one transform: mirroring
 * a view about its own centre moves the golfer to the other side of it, and an offset computed for
 * the unmirrored picture would then push them off the pane entirely. The subject's centre is
 * reflected here so the caller can apply a plain `scaleX: -1` and get a centred golfer.
 */
export function paneCrop(
  subject: SyncSubject | null | undefined,
  aspect: number,
  paneWidth: number,
  paneHeight: number,
  mirrored = false,
): PaneCrop {
  const whole: PaneCrop = {
    width: paneWidth,
    height: paneHeight,
    left: 0,
    top: 0,
    mirrored,
  };
  if (!(aspect > 0) || paneWidth <= 0 || paneHeight <= 0) return whole;

  const w = subject ? subject.x1 - subject.x0 : 0;
  const h = subject ? subject.y1 - subject.y0 : 0;
  if (!subject || !(w > 0) || !(h > 0)) return whole;

  // Contain the subject, never cover it: scaling until the box FILLS the pane would crop the
  // golfer's own extremities off one axis, which is worse than the letterboxing it removes.
  const byWidth = paneWidth / w;
  const byHeight = (paneHeight * aspect) / h;
  const natural = Math.max(paneWidth, paneHeight * aspect);
  const videoWidth = Math.min(Math.min(byWidth, byHeight), natural * MAX_ZOOM);
  // A pane already narrower than the whole picture (the fit was by height) must not be "cropped"
  // to something smaller than it started at.
  if (videoWidth <= natural) return whole;

  const videoHeight = videoWidth / aspect;

  // Reflected for a mirrored pane — see the note above.
  const cx = mirrored ? 1 - (subject.x0 + subject.x1) / 2 : (subject.x0 + subject.x1) / 2;
  const cy = (subject.y0 + subject.y1) / 2;

  // Centre the subject, then hold the picture over the pane: sliding past an edge would show
  // background where footage should be, which reads as a rendering fault rather than as framing.
  const clamp = (v: number, min: number) => Math.min(0, Math.max(min, v));
  return {
    width: videoWidth,
    height: videoHeight,
    left: clamp(paneWidth / 2 - cx * videoWidth, paneWidth - videoWidth),
    top: clamp(paneHeight / 2 - cy * videoHeight, paneHeight - videoHeight),
    mirrored,
  };
}
