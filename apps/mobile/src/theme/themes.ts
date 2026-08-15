import {
  AQUA,
  BLACK,
  COBALT,
  DARK_SURFACES,
  LAVENDER,
  LIGHT_SURFACES,
  NAVY,
  ON_DARK,
  SEMANTIC,
} from "./palette";
import { legacyAliases, type LegacyTokens } from "./legacy";

/**
 * The semantic layer — what a colour is *for*, not what it looks like.
 *
 * Every themed surface reads these tokens through `useTheme()`; no component may reach into
 * `palette.ts` or hand-mix an rgba beside a token that nearly matches (the standing deck rule,
 * app-wide). Adding a colour means adding a token here with a name that says its job, then
 * giving it a value in BOTH themes — the compiler enforces the "both" via the `Theme` type.
 *
 * The token set is the Ideal Swing design system's
 * (`.claude/ideal-swing-design-system.html`); light is the product's default face. The old
 * token names (`panel`, `accent`, `violet`, …) survive as aliases in `legacy.ts` so untouched
 * screens keep compiling in the new colours — that layer, not this one, dies in step 09.
 */

/**
 * A ready-to-spread RN shadow: iOS `shadow*` plus an Android `elevation` approximation.
 * `shadowRadius` is the CSS blur halved — iOS blurs roughly twice as wide per point.
 */
export interface ShadowStyle {
  shadowColor: string;
  shadowOffset: { width: number; height: number };
  shadowRadius: number;
  shadowOpacity: number;
  elevation: number;
}

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

  shadowSm: ShadowStyle;
  shadowMd: ShadowStyle;
  shadowLg: ShadowStyle;
  shadowCobalt: ShadowStyle;
  shadowAqua: ShadowStyle;
}

/** What components consume: the Ideal Swing tokens plus the step-09-doomed aliases. */
export interface Theme extends IdealTokens, LegacyTokens {}

const LIGHT_BASE: IdealTokens = {
  mode: "light",
  ...LIGHT_SURFACES,
  cobalt: COBALT[600],
  cobaltPressed: COBALT[700],
  aqua: AQUA[500],
  aquaSoft: AQUA[100],
  lavender: LAVENDER[500],
  good: SEMANTIC.good,
  bad: SEMANTIC.bad,
  onDark: ON_DARK,
  // Mockup: 0 4px 12px rgba(20,36,79,.055) / 0 12px 30px .085 / 0 26px 70px .16
  shadowSm: {
    shadowColor: NAVY[800],
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 6,
    shadowOpacity: 0.055,
    elevation: 2,
  },
  shadowMd: {
    shadowColor: NAVY[800],
    shadowOffset: { width: 0, height: 12 },
    shadowRadius: 15,
    shadowOpacity: 0.085,
    elevation: 6,
  },
  shadowLg: {
    shadowColor: NAVY[800],
    shadowOffset: { width: 0, height: 26 },
    shadowRadius: 35,
    shadowOpacity: 0.16,
    elevation: 14,
  },
  // 0 12px 28px rgba(47,70,207,.20) / rgba(67,205,208,.22)
  shadowCobalt: {
    shadowColor: COBALT[600],
    shadowOffset: { width: 0, height: 12 },
    shadowRadius: 14,
    shadowOpacity: 0.2,
    elevation: 8,
  },
  shadowAqua: {
    shadowColor: AQUA[500],
    shadowOffset: { width: 0, height: 12 },
    shadowRadius: 14,
    shadowOpacity: 0.22,
    elevation: 8,
  },
};

const DARK_BASE: IdealTokens = {
  mode: "dark",
  ...DARK_SURFACES,
  // The dark token table swaps cobalt one step lighter so it reads on a navy ground.
  cobalt: COBALT[500],
  cobaltPressed: COBALT[600],
  aqua: AQUA[500],
  aquaSoft: "rgba(67,205,208,0.16)",
  lavender: LAVENDER[500],
  good: SEMANTIC.good,
  bad: SEMANTIC.bad,
  onDark: ON_DARK,
  // Mockup dark: 0 4px 12px rgba(0,0,0,.20) / 0 12px 30px .28 / 0 26px 70px .42
  shadowSm: {
    shadowColor: BLACK,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 6,
    shadowOpacity: 0.2,
    elevation: 2,
  },
  shadowMd: {
    shadowColor: BLACK,
    shadowOffset: { width: 0, height: 12 },
    shadowRadius: 15,
    shadowOpacity: 0.28,
    elevation: 6,
  },
  shadowLg: {
    shadowColor: BLACK,
    shadowOffset: { width: 0, height: 26 },
    shadowRadius: 35,
    shadowOpacity: 0.42,
    elevation: 14,
  },
  // 0 12px 30px rgba(47,70,207,.25) / rgba(67,205,208,.16)
  shadowCobalt: {
    shadowColor: COBALT[600],
    shadowOffset: { width: 0, height: 12 },
    shadowRadius: 15,
    shadowOpacity: 0.25,
    elevation: 8,
  },
  shadowAqua: {
    shadowColor: AQUA[500],
    shadowOffset: { width: 0, height: 12 },
    shadowRadius: 15,
    shadowOpacity: 0.16,
    elevation: 8,
  },
};

export const LIGHT: Theme = { ...LIGHT_BASE, ...legacyAliases(LIGHT_BASE) };

export const DARK: Theme = { ...DARK_BASE, ...legacyAliases(DARK_BASE) };
