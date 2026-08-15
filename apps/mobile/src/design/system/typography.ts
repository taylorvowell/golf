import type { TextStyle } from "react-native";

/**
 * The Ideal Swing type system (`.claude/ideal-swing-design-system.html` §03).
 *
 * Two faces: a narrow, heavy display face for titles, scores and labels, and a body face for
 * coaching copy and metadata. Bahnschrift (the mockup's face) is Windows-licensed and cannot
 * ship in an app, so Barlow Semi Condensed — the closest OFL DIN-family face — stands in;
 * Inter is the body face (the mockup's own first choice). Both load in `App.tsx` before the
 * first frame.
 *
 * RN names a font per weight (the loaded asset's key), so the family constants are weight
 * maps, not a single string. Letter-spacing in RN is absolute px, converted from the mockup's
 * em values against each size (e.g. 32 × -0.035 ≈ -1.12).
 */

/** Display face — narrow, heavy, tightly tracked. Titles, scores, labels, eyebrows. */
export const FONT_DISPLAY = {
  bold: "BarlowSemiCondensed_700Bold",
  extraBold: "BarlowSemiCondensed_800ExtraBold",
  black: "BarlowSemiCondensed_900Black",
} as const;

/** Body face — coaching copy, descriptions, metadata. */
export const FONT_BODY = {
  regular: "Inter_400Regular",
  semiBold: "Inter_600SemiBold",
  bold: "Inter_700Bold",
} as const;

/**
 * The six-step scale, verbatim from the mockup's specimen rows (`.t32`…`.t10`).
 * Spread into a style and add colour; never restate sizes inline.
 */
export const TYPE = {
  /** Page titles, major scores. 32 / 900 / -3.5%. */
  display: {
    fontFamily: FONT_DISPLAY.black,
    fontSize: 32,
    lineHeight: 32,
    letterSpacing: -1.12,
  },
  /** Session headers, card heroes. 24 / 800 / -3%. */
  title: {
    fontFamily: FONT_DISPLAY.extraBold,
    fontSize: 24,
    lineHeight: 25,
    letterSpacing: -0.72,
  },
  /** Section and finding headings. 18 / 800. */
  heading: {
    fontFamily: FONT_DISPLAY.extraBold,
    fontSize: 18,
    lineHeight: 20,
  },
  /** Control and row labels. 14 / 800. */
  label: {
    fontFamily: FONT_DISPLAY.extraBold,
    fontSize: 14,
    lineHeight: 17,
  },
  /** Uppercase kickers above content. 11 / 900 / +8%. */
  eyebrow: {
    fontFamily: FONT_DISPLAY.black,
    fontSize: 11,
    lineHeight: 11,
    letterSpacing: 0.88,
    textTransform: "uppercase",
  },
  /** Timestamps, view names, footnotes — the body face's job. 10 / 700. */
  meta: {
    fontFamily: FONT_BODY.bold,
    fontSize: 10,
    lineHeight: 14,
  },
} as const satisfies Record<string, TextStyle>;
