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
 * How long the "Processing" overlay may cover the screen before it gives up.
 *
 * Finalising a 30 s 1080p240 MP4 is fast, so this only fires when the recorder has wedged —
 * and then the overlay must come down, because it sits over the Stop button.
 */
export const STOP_TIMEOUT_MS = 8_000;

/**
 * How close to the strongest candidate a LATER one must score to win the seed.
 *
 * The rule it feeds — "the last plausible candidate, not the loudest" — exists because a golfer
 * takes a practice swing before the real one. At 0.45 it was doing far more than that: measured
 * against `services/analyzer/scripts/audio_truth.json`, it is what turned a correct top candidate
 * into a mark four seconds into the walk back on 6iron-1, and it walks straight past 6iron3's
 * strike, which is the FIRST of that take's three bursts.
 *
 * The premise was wrong anyway. A practice swing is a whoosh with no click on the end of it, so
 * a detector that requires the click never ranks one highly — the floor was compensating for a
 * scorer that could not tell them apart, and `swish` can. 0.60 keeps the case this is actually
 * for (two balls genuinely struck in one take, where the second should win) and drops the case it
 * was never for. Detector tuning — spec §11.7 names this class of value as remote-config material.
 */
export const CANDIDATE_FLOOR = 0.6;

/** Filmstrip density and decode width — spec §04.3 asks for 10–24 frames across the source. */
export const STRIP_FRAMES = 12;
export const STRIP_PX = 160;

/**
 * Capture leftovers older than this are swept when the capture screen mounts.
 *
 * Long enough that a take being reviewed right now is never touched, short enough that a
 * crash does not leave a swing-sized file on the phone for a week.
 */
export const CACHE_KEEP_MS = 60 * 60 * 1000;

/**
 * The rate ceiling handed to the recorder — §02.4's priority order (240 → 120 → 60) is
 * implemented natively as a ladder of real configurations, and the session resolves with the
 * rate the device actually configured, never this number.
 */
export const MAX_FPS_REQUEST = 240;
