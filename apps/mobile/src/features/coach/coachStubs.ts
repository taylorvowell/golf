import type { StickFigure } from "../../design/system";
import type { StanceAnnotation } from "../../design/system";
import { CATEGORY_FIGURES } from "../progress/viewModel";

/**
 * The Coach page's stub view-model — coach-surface step 01's single swap point, every entry
 * `placeholder: true`.
 *
 * What replaces what when the engines land:
 * - The ranking and personal scores come from the coach report's own Leverage Score
 *   (`priorities[]` + per-check `leverage_breakdown` — severity + impact + ease, disclosed),
 *   aggregated across recent swings the way home's `aggregateFocus` already does.
 * - The drills come from the drill library's finding→drill mappings (D59), never invented
 *   per-response.
 * - The focus-area imagery becomes the golfer's own `frame?checkpoint=` grab with the area's
 *   overlay drawn on it; the pose-art stage here is the stand-in with the same layer.
 *
 * Categories name only what the scoring config actually scores — never an invented theme.
 */

export interface CoachTip {
  eyebrow: string;
  title: string;
  copy: string;
  /** The tip's suggested drill — the "top drill to do". */
  drill: { title: string; dose: string };
  placeholder: true;
}

export interface CoachFocusArea {
  category: string;
  ordinal: string;
  title: string;
  copy: string;
  /** The personal score for this area — canned until the report seam feeds it. */
  score: number;
  level: "high" | "med" | "low";
  levelLabel: string;
  figure: StickFigure;
  /** The featured area draws its overlay on the stance stage (the screen-grab slot). */
  featured?: { view: "dtl" | "face_on"; annotations: StanceAnnotation[] };
  placeholder: true;
}

export interface CoachDrill {
  key: string;
  title: string;
  copy: string;
  dose: string;
  /** Which focus area this drill serves — the selection rationale, worn on the row. */
  area: string;
  placeholder: true;
}

export const COACH_TIP: CoachTip = {
  eyebrow: "Next up",
  title: "Settle your setup before you swing",
  copy:
    "Your setup is the highest-leverage fix on the list — a stable address unlocks a cleaner transition and more centered contact on everything after it.",
  drill: { title: "Club-on-spine posture drill", dose: "3 × 5 slow reps" },
  placeholder: true,
};

export const COACH_FOCUS_AREAS: readonly CoachFocusArea[] = [
  {
    category: "setup_posture",
    ordinal: "Priority 01",
    title: "Setup posture",
    copy: "Hinge from the hips and let the shaft point at your belt buckle.",
    score: 68,
    level: "high",
    levelLabel: "High",
    figure: CATEGORY_FIGURES.setup,
    featured: {
      view: "dtl",
      annotations: [
        { id: "shaft", kind: "line", from: [0.1, 0.94], to: [0.52, 0.5], tone: "guide" },
        {
          id: "extend",
          kind: "line",
          from: [0.52, 0.5],
          to: [0.74, 0.43],
          tone: "guide",
          dashed: true,
        },
        { id: "buckle", kind: "dot", at: [0.74, 0.43], tone: "good" },
      ],
    },
    placeholder: true,
  },
  {
    category: "impact",
    ordinal: "Priority 02",
    title: "Impact position",
    copy: "Impact is where a swing becomes a shot — delivery is the biggest scoring opportunity.",
    score: 74,
    level: "med",
    levelLabel: "Medium",
    figure: CATEGORY_FIGURES.impact,
    placeholder: true,
  },
  {
    category: "transition_tempo",
    ordinal: "Priority 03",
    title: "Transition tempo",
    copy: "A repeatable tempo stabilises path and face from the top down.",
    score: 82,
    level: "low",
    levelLabel: "On track",
    figure: CATEGORY_FIGURES.tempo,
    placeholder: true,
  },
  {
    category: "arm_structure",
    ordinal: "Priority 04",
    title: "Arm structure",
    copy: "Arms draped from the shoulders keep the club's arc where you set it.",
    score: 77,
    level: "low",
    levelLabel: "On track",
    figure: CATEGORY_FIGURES.posture,
    placeholder: true,
  },
];

export const COACH_DRILLS: readonly CoachDrill[] = [
  {
    key: "club-on-spine",
    title: "Club-on-spine posture drill",
    copy: "Hold a club along your spine and hinge from the hips until the shaft stays touching.",
    dose: "3 × 5",
    area: "Setup",
    placeholder: true,
  },
  {
    key: "hang-loose",
    title: "Hang-loose spacing check",
    copy: "A shaka's width between your body and the butt of the club at address — check, then swing.",
    dose: "5 checks",
    area: "Setup",
    placeholder: true,
  },
  {
    key: "pump-impact",
    title: "Pump-to-impact holds",
    copy: "Rehearse to your impact position and hold — hips open, hands ahead, weight left.",
    dose: "3 × 8",
    area: "Impact",
    placeholder: true,
  },
  {
    key: "one-two-tempo",
    title: "One-and-two tempo counts",
    copy: "Count the backswing on one-and, strike on two — same count, every club.",
    dose: "10 swings",
    area: "Tempo",
    placeholder: true,
  },
];
