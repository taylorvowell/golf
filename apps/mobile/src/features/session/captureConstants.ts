/**
 * The capture subsystem's tunable constants, in one home (capture spec §11.7 — these are the
 * values that must stay configurable, so none of them may be baked into a component or the
 * native layer). `.claude/golf_swing_capture_spec/` is the governing contract for this
 * subsystem; the section references below point into it.
 */

/**
 * The recorder's hard cap — the longest a single take can run (Taylor, 2026-08-21).
 *
 * Enforced by `MediaRecorder.setMaxDuration`, so the file is finalised by the recorder itself
 * and a cap reached while JS is busy still yields a playable MP4.
 */
export const MAX_TAKE_SEC = 30;

/**
 * The take's last seconds are counted down on screen (Taylor, 2026-08-21) — the golfer is
 * standing at the ball, away from the phone, and a recording that simply stops is
 * indistinguishable from one that failed.
 */
export const AUTOSTOP_COUNTDOWN_SEC = 5;

/** The fixed review-window width. Slid as a whole, never resized (§01.5.6). */
export const REVIEW_WINDOW_S = 5;

/** Half of it, either side of the heard strike — where the window seeds. */
export const PRE_ROLL_SEC = REVIEW_WINDOW_S / 2;

/**
 * Slack added to each end of the SAVED clip, beyond the window the golfer sees.
 *
 * The box on screen is the promise — everything inside it is kept — and the golfer lands it by
 * dragging, not by frame-counting. A tenth of a second either side absorbs the difference
 * between where they meant to put the edge and where their finger left it, so a takeaway or a
 * finish is never clipped by a pixel of drag. It is invisible by design: showing the padding
 * would just make the box they are aiming with less honest.
 */
export const SAVE_PAD_S = 0.1;

/**
 * The rate ceiling handed to the recorder — §02.4's priority order (240 → 120 → 60) is
 * implemented natively as a ladder of real configurations, and the session resolves with the
 * rate the device actually configured, never this number.
 */
export const MAX_FPS_REQUEST = 240;
