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
 */
export { DeckButton, DeckToggle, type DeckButtonProps } from "./DeckButton";
export { DeckRow, DeckSurface, type DeckSurfaceProps } from "./DeckSurface";
export { LoopGlyph, PauseGlyph, PlayGlyph, StepGlyph } from "./Glyphs";
export { DECK, type DeckDepth } from "./tokens";
