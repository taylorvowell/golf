/**
 * **Deck** — the tactile control surface.
 *
 * Read `tokens.ts` before adding anything: the whole system is one rule (light from directly
 * above) plus three depths, and a component that lights itself differently breaks the illusion for
 * every other component on the same slab.
 *
 * It is a control-surface system, not the app's design system. Type scale, spacing rhythm,
 * iconography and §41's contrast bar belong to `mobile-app-shell` step 03, which absorbs this
 * folder rather than colliding with it.
 *
 * Three parts, and nothing else belongs here until something outside the player needs it:
 * `DeckButton` (a cap you press), `DeckSheet` (a panel that comes up from the bottom edge), and
 * the glyphs, which are drawn from `View`s because this app ships no icon font and no SVG runtime.
 */
export { DeckButton, type DeckButtonProps } from "./DeckButton";
export { DeckSheet, type DeckSheetProps } from "./DeckSheet";
export { BarsGlyph, ChevronGlyph, LayersGlyph, LoopGlyph, PauseGlyph, PlayGlyph } from "./Glyphs";
export { DECK, type DeckDepth } from "./tokens";
