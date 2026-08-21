/**
 * How long a finger must rest on a Pressable inside a SCROLL surface before the pressed
 * visual shows. `pressIn` fires the instant the finger lands, and only afterwards does the
 * ScrollView claim the gesture — so with no delay, every scroll that starts on a card
 * flashes that card's pressed state (Taylor, 2026-08-19). A deliberate tap holds still
 * longer than this; a drag has moved on and never shows anything.
 *
 * Only for pressables that live in something that scrolls. Fixed chrome (nav docks, the
 * floating back orb, headers) keeps instant feedback — nothing competes for its gesture.
 */
export const SCROLL_PRESS_DELAY_MS = 90;

/**
 * The pressed treatment for controls used OUTDOORS, over footage — capture and review.
 *
 * Scale is what carries: an opacity-only press is close to invisible in sunlight, which is
 * exactly where these screens are used, and a golfer who cannot see the press taps again.
 * The system's ordinary answer stays `Button`'s `translateY(1)`; this is the louder one for
 * a control read at arm's length. One token because four hand-written scales had accumulated
 * (0.9 / 0.94 / 0.97 / opacity-only), each with a comment claiming to be the right value.
 */
export const PRESS_SUNK = { transform: [{ scale: 0.94 }], opacity: 0.85 } as const;

/** The record/stop face, which is round, large, and the one control that must not be missed. */
export const PRESS_SUNK_HARD = { transform: [{ scale: 0.9 }] } as const;
