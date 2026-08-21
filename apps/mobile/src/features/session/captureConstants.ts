/**
 * The capture subsystem's tunable constants, in one home (capture spec §11.7 — these are the
 * values that must stay configurable, so none of them may be baked into a component or the
 * native layer). `.claude/golf_swing_capture_spec/` is the governing contract for this
 * subsystem; the section references below point into it.
 */

/** §00.6 — the longest the app waits for a shot before ending the attempt. */
export const MAX_IMPACT_WAIT_SEC = 20;

/** §01.4.4 — "about three seconds left" tone, distinct from countdown and stop cues. */
export const WARNING_AT_SEC = 17;

/** §00.5 — the retained clip is impact − PRE_ROLL … impact + POST_ROLL, always. */
export const PRE_ROLL_SEC = 3;
export const POST_ROLL_SEC = 3;

/** The fixed review-window width. Slid as a whole, never resized (§01.5.6). */
export const REVIEW_WINDOW_S = PRE_ROLL_SEC + POST_ROLL_SEC;

/**
 * The recorder's hard cap: the impact-detection window plus the post-roll. Without live
 * impact detection (auto-stop is iceboxed; audio runs post-hoc — the spec's Tier C), the
 * app cannot know whether a shot near second 19 still needs its follow-through, and losing
 * one is the worst failure the spec names (§00.5: never lose a valid swing) — so the cap
 * always allows the late-impact extension. When live detection lands, an impact-free take
 * ends at MAX_IMPACT_WAIT_SEC instead.
 */
export const MAX_TAKE_SEC = MAX_IMPACT_WAIT_SEC + POST_ROLL_SEC;

/**
 * The rate ceiling handed to the recorder — §02.4's priority order (240 → 120 → 60) is
 * implemented natively as "highest offered rate at or below this", and the session resolves
 * with the rate the device actually configured, never this number.
 */
export const MAX_FPS_REQUEST = 240;
