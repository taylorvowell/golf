import {
  AQUA,
  COBALT,
  DARK_SURFACES,
  LAVENDER,
  LIGHT_SURFACES,
  ON_DARK,
  SEMANTIC,
} from "./palette";

/**
 * The semantic layer — what a colour is *for*, not what it looks like.
 *
 * Every themed surface reads these tokens through `useTheme()`; no component may reach into
 * `palette.ts` or hand-mix an rgba beside a token that nearly matches (the standing deck rule,
 * app-wide). Adding a colour means adding a token here with a name that says its job, then
 * giving it a value in BOTH themes — the compiler enforces the "both" via the `Theme` type.
 *
 * The token set is the Ideal Swing design system's
 * (`.claude/ideal-swing-design-system.html`); light is the product's default face. The legacy
 * alias layer (`panel`, `accent`, `violet`, …) died in step 09 — every screen reads these
 * names and only these.
 */

/** The Ideal Swing token set proper — everything a rebuilt screen reads. */
export interface IdealTokens {
  mode: "light" | "dark";

  /** The screen's ground. */
  bg: string;
  /** A raised ground — the sticky top bar's fade, a sheet about to lift. */
  bgElevated: string;
  /** Cards and controls. */
  surface: string;
  /** A nested surface on a card — wells, chip beds, input grounds. */
  surface2: string;
  /** The deepest nesting level — a chip on a well. */
  surface3: string;
  /** The blue-tinted surface — selected rows, info beds. */
  surfaceBlue: string;
  /**
   * The round bed behind a bare glyph while it is pressed — a translucent grey state layer
   * (Taylor, 2026-08-19). Translucent so it reads as "held" on any bar fill, in both themes,
   * without joining the opaque surface ramp.
   */
  pressBed: string;

  /** Primary reading text. */
  text: string;
  /** Secondary text — body copy, descriptions. */
  textSoft: string;
  /** Muted text — metadata, captions. */
  muted: string;
  /** The faintest legible text — footnotes, disabled labels. */
  muted2: string;

  /** The hero gradient's three stops (navy → cobalt), for `expo-linear-gradient`. */
  heroStart: string;
  heroMid: string;
  heroEnd: string;
  /** The glass surface floating controls sit on (near-opaque; RN has no backdrop blur). */
  glass: string;

  /** Primary actions and selected states. */
  cobalt: string;
  /** A `cobalt` fill while pressed. */
  cobaltPressed: string;
  /** Action, trajectory, motion, improvement. */
  aqua: string;
  /** A whisper of aqua — soft chips, meter tracks. */
  aquaSoft: string;
  /** The secondary voice — coach glyphs, quiet emphasis. */
  lavender: string;

  /** Positive outcomes — a good score, an improvement. */
  good: string;
  /** Negative outcomes — a fault, a drop, destructive actions. */
  bad: string;
  /** Text/glyphs on a cobalt, hero or photo fill — white in both themes. */
  onDark: string;
}

/** What components consume: the Ideal Swing tokens, nothing else. */
export type Theme = IdealTokens;

const LIGHT_BASE: IdealTokens = {
  mode: "light",
  ...LIGHT_SURFACES,
  // 13%, not subtler: at 7% the blend over the pure-white nav bar was ~#EFF0F2 — invisible on
  // glass during a real tap (Taylor, 2026-08-19, "the circle is not showing").
  pressBed: "rgba(23,43,78,0.13)",
  cobalt: COBALT[600],
  cobaltPressed: COBALT[700],
  aqua: AQUA[500],
  aquaSoft: AQUA[100],
  lavender: LAVENDER[500],
  good: SEMANTIC.good,
  bad: SEMANTIC.bad,
  onDark: ON_DARK,
};

const DARK_BASE: IdealTokens = {
  mode: "dark",
  ...DARK_SURFACES,
  pressBed: "rgba(255,255,255,0.12)",
  // The dark token table swaps cobalt one step lighter so it reads on a navy ground.
  cobalt: COBALT[500],
  cobaltPressed: COBALT[600],
  aqua: AQUA[500],
  aquaSoft: "rgba(45,240,251,0.16)",
  lavender: LAVENDER[500],
  good: SEMANTIC.good,
  bad: SEMANTIC.bad,
  onDark: ON_DARK,
};

export const LIGHT: Theme = LIGHT_BASE;

export const DARK: Theme = DARK_BASE;
