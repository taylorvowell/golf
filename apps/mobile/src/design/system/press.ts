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
