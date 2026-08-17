/**
 * **Deck** — the tactile control surface.
 *
 * Read `tokens.ts` before adding anything: the whole system is one rule (light from directly
 * above) plus three depths, and a component that lights itself differently breaks the illusion for
 * every other component on the same slab.
 *
 * It is a control-surface system, not the app's design system. The Ideal Swing system
 * (`design/system/`) absorbed the report surfaces and re-tokened this folder onto its palette
 * (design-system step 09); what remains serves the player/after-swing surfaces until
 * in-app-capture rebuilds them, and no NEW surface may adopt Deck.
 *
 * Three parts, and nothing else belongs here until something outside the player needs it:
 * `DeckButton` (a cap you press), `DeckSheet` (a panel that comes up from the bottom edge), and
 * the glyphs, drawn from `View`s — they predate the SVG runtime (`react-native-svg` now ships
 * for `design/gauges` and `design/system`) and stay drawn until in-app-capture rebuilds these
 * surfaces.
 */
export { DeckButton, type DeckButtonProps } from "./DeckButton";
export { DeckSheet, type DeckSheetProps } from "./DeckSheet";
export {
  BarsGlyph,
  ChevronGlyph,
  CompareGlyph,
  LayersGlyph,
  PauseGlyph,
  PlayGlyph,
  SparkGlyph,
} from "./Glyphs";
export { DECK, type DeckDepth } from "./tokens";
