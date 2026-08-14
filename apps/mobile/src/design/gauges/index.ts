/**
 * **Gauges** — the designed score meters, drawn with `react-native-svg` and animated.
 *
 * This is the one place in the app allowed to import SVG. The overlay stays on plain `View`s —
 * D23 measured that and the rule holds — and the transport glyphs stay drawn; SVG is here
 * because a gradient arc with a smooth sweep is exactly what a vector runtime is for, and these
 * meters render on cold surfaces (summaries, sessions, goals), never on the 60 Hz path.
 */
export { ArcGauge, type ArcGaugeProps } from "./ArcGauge";
export { RingGauge, type RingGaugeProps } from "./RingGauge";
export { TrendLine, type TrendLineProps } from "./TrendLine";
