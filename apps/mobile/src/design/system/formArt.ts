import type { StickFigure } from "./StickThumb";

/**
 * The coaching form-art library: every time the coach mentions something, the surface shows a
 * thumbnail of the CORRECT form for that thing (Taylor, 2026-08-19 — "the correct posture
 * overlay on the homepage item about bending forward more"). One mapping, shared by home,
 * Coach and Progress, so "posture" is always the same picture everywhere the coach says it.
 *
 * Figures are the Progress mockup's stick-figure art, path data verbatim (42×42 space, drawn
 * by `StickThumb`); the accent strokes highlight the limb/line the topic is about — the spine
 * line on posture, the delivery line on impact, the tempo traces on transition.
 *
 * `formFigureFor` maps a coach report's own vocabulary — check ids (`SET-01`, `ANG-56`),
 * labels ("Spine forward bend at address"), drill areas — onto a figure by keyword, most
 * specific first. Unknown topics get the address figure: a neutral golfer, never a wrong
 * lesson.
 */

const FIGURE_SETUP: StickFigure = {
  ground: "M7 33.5h26",
  joints: [{ x: 21, y: 8 }],
  bones: ["M21 11.5 18.5 17.5 17.5 23.5", "M18.5 17.5 24.5 17", "M24.5 17 28 13", "M17.5 23.5 16 31"],
  accents: ["M18.2 17.8 24.5 24", "M24.5 24 25 31"],
  traces: ["M8 12c3 1 5 2 8 6"],
};
const FIGURE_IMPACT: StickFigure = {
  ground: "M7 33.5h26",
  joints: [{ x: 19, y: 8 }],
  bones: ["M19 11.5 18 18 16.5 24", "M18 18 25.5 17", "M16.5 24 14.5 31"],
  accents: ["M25.5 17 31 14", "M18 18 23 25", "M23 25 25.5 31"],
  traces2: ["M22 16c4-1 7-4 11-6"],
};
const FIGURE_TEMPO: StickFigure = {
  ground: "M7 33.5h26",
  joints: [{ x: 20, y: 8 }],
  bones: ["M20 11.5 19 18 18 24", "M19 18 25 19", "M18 24 16 31"],
  accents: ["M25 19 29 16", "M19 18 23.5 23.5", "M23.5 23.5 24.5 31"],
  traces: ["M9 13c4-1 7 0 10 3"],
  traces2: ["M21 18c3 2 6 2 10 0"],
};
const FIGURE_POSTURE: StickFigure = {
  ground: "M7 33.5h26",
  joints: [{ x: 21, y: 8 }],
  bones: ["M21 11.5 18.5 17.5 17.5 23.5", "M18.5 17.5 24.5 17", "M17.5 23.5 16 31"],
  accents: ["M24.5 17 29 14", "M18 18 23.8 24", "M23.8 24 24.6 31"],
};
const FIGURE_STRIKE: StickFigure = {
  ground: "M7 33.5h26",
  joints: [{ x: 18.5, y: 8 }],
  bones: ["M18.5 11.5 17.8 17.2 16.5 23.5", "M17.8 17.2 25.5 16.8", "M16.5 23.5 14.8 31"],
  accents: ["M25.5 16.8 31 13", "M17.8 17.2 23 24.2", "M23 24.2 25.2 31"],
  traces2: ["M22 17c4-1 8-3 12-6"],
};

export const FORM_FIGURES = {
  setup: FIGURE_SETUP,
  impact: FIGURE_IMPACT,
  tempo: FIGURE_TEMPO,
  posture: FIGURE_POSTURE,
  strike: FIGURE_STRIKE,
} as const;

export type FormFigureName = keyof typeof FORM_FIGURES;

/** Ordered most-specific-first; the first matching rule names the picture. */
const RULES: Array<[RegExp, FormFigureName]> = [
  [/tempo|transition|rhythm|timing|TEM-/i, "tempo"],
  [/impact|strike|shaft lean|delivery|smash|IMP-/i, "strike"],
  [/spine|posture|bend|hinge|slouch|upright|POS-/i, "posture"],
  [/setup|address|stance|ball position|grip|alignment|SET-|BAL-/i, "setup"],
  [/takeaway|backswing|top of|turn|rotation|coil|TOP-|TKW-/i, "tempo"],
  [/follow|finish|balance|release/i, "strike"],
  [/arm|elbow|wrist|drape/i, "posture"],
];

/**
 * The figure for whatever the coach just said. Feed it everything you have — id + label +
 * cue concatenated — so "ANG-06 Lead hip hinge at address" lands on posture by its words even
 * though its id prefix says nothing.
 */
export function formFigureFor(hint: string): StickFigure {
  for (const [re, name] of RULES) {
    if (re.test(hint)) return FORM_FIGURES[name];
  }
  return FORM_FIGURES.setup;
}
