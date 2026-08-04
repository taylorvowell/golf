import type { Analysis } from "./swings";

/* ===========================================================================
 * MOCK SCORING — placeholder data, not measurements.
 *
 * Nothing in this file is derived from the golfer's swing. The scoring engine is doc 05 Part C
 * and the coach narrative is doc 07's `AIProvider`; neither is built, and the player needs to
 * be designed and reviewed as the scored product it will be rather than as a wall of empty
 * slots. So this stands in until they land.
 *
 * Three rules it follows, and the reason for each:
 *
 *   1. **Deterministic per swing.** Seeded from the swing id, so a score does not change when
 *      you scrub, switch tabs or reload. Random numbers would make the screen feel broken and
 *      would make any UI bug impossible to reproduce.
 *   2. **Labelled everywhere it surfaces.** Every consumer renders the `DEMO` marker. A
 *      plausible unlabelled swing score is exactly the number a golfer believes, and shipping
 *      one is the thing CLAUDE.md forbids outright.
 *   3. **One file.** When the scoring engine lands, `mockScoring()` is replaced by the real
 *      scorecard and nothing else in the UI changes shape — the fields below are the contract.
 *
 * Real measurements NEVER pass through here. Tempo, angles, coverage, confidences and the club
 * face all come straight from `analysis.json` in the components that show them.
 * =========================================================================== */

/** Flip to false the moment a real scorecard exists; every consumer reads it. */
export const SCORING_IS_MOCK = true;

export interface Finding {
  tone: "positive" | "negative";
  icon: string;
  title: string;
  detail: string;
}

export interface CheckpointScore {
  /** P1…P10 */
  p: string;
  score: number;
  /** Change against this golfer's own recent average, as the sample renders it. */
  delta: number;
}

export interface MockScorecard {
  overall: number;
  /** Named band for the score, the sample's "Pure" chip. */
  band: string;
  /** Signed −50…+50 motion tendency, the sample's ArcShift™. */
  arcShift: number;
  arcShiftLabel: string;
  /** Change over the last five swings, for the floating card by the gauge. */
  recentDelta: number;
  headline: string;
  takeaway: string;
  findings: Finding[];
  checkpoints: Record<string, CheckpointScore>;
  primary: { title: string; copy: string; moment: string; score: number };
  drill: { title: string; copy: string; dose: string; doseNote: string };
  priorities: { key: string; label: string; score: number; cue: string }[];
}

/* ------------------------------------------------------------------ seeding */

/** FNV-1a. Small, stable across platforms, and enough to spread ids over the pools below. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 — one line, uniform enough, and reproducible from the same seed. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T,>(r: () => number, xs: T[]) => xs[Math.floor(r() * xs.length)];
const between = (r: () => number, lo: number, hi: number) => Math.round(lo + r() * (hi - lo));

/* -------------------------------------------------------------------- pools */

const NEGATIVE: Finding[] = [
  { tone: "negative", icon: "↘", title: "Too steep of an attack", detail: "Downswing" },
  { tone: "negative", icon: "⌒", title: "Too bent over at address", detail: "Posture" },
  { tone: "negative", icon: "↑", title: "Head lifts too early", detail: "Impact" },
  { tone: "negative", icon: "→", title: "Early extension through the ball", detail: "Downswing" },
  { tone: "negative", icon: "↷", title: "Shoulders unwind before the pelvis", detail: "Transition" },
  { tone: "negative", icon: "⌇", title: "Trail elbow drifts behind the body", detail: "Backswing" },
  { tone: "negative", icon: "⇠", title: "Weight hangs back at impact", detail: "Impact" },
  { tone: "negative", icon: "⤾", title: "Club releases early from the top", detail: "Delivery" },
];

const POSITIVE: Finding[] = [
  { tone: "positive", icon: "◎", title: "Excellent club angle at impact", detail: "Impact" },
  { tone: "positive", icon: "◜", title: "Lead arm stays wide and straight", detail: "Backswing" },
  { tone: "positive", icon: "✓", title: "Balanced, held finish", detail: "Finish" },
  { tone: "positive", icon: "↗", title: "Wide, connected takeaway", detail: "Takeaway" },
  { tone: "positive", icon: "◉", title: "Head stays centred through the turn", detail: "Backswing" },
  { tone: "positive", icon: "⟳", title: "Full shoulder turn without sway", detail: "Top" },
  { tone: "positive", icon: "⌁", title: "Tempo stays even under speed", detail: "Transition" },
  { tone: "positive", icon: "⌂", title: "Stance and ball position are repeatable", detail: "Setup" },
];

const PRIMARY = [
  {
    title: "Start the downswing from the ground up.",
    copy: "Your shoulders unwind before your pelvis creates separation. This is the largest weighted gap in the swing and the clearest route to a higher score.",
    moment: "Transition",
  },
  {
    title: "Hold your posture through the strike.",
    copy: "Your hips move toward the ball through impact and the spine stands up to make room. Keeping the tilt costs nothing in speed and centres the contact.",
    moment: "Impact",
  },
  {
    title: "Keep the wrist angle two frames longer.",
    copy: "The club releases from the top rather than being delivered. The rest of the sequence is good enough that holding the angle is the single change worth making.",
    moment: "Delivery",
  },
  {
    title: "Let the trail elbow stay in front of the seam.",
    copy: "The arm works behind the body going back, which forces a rerouting move coming down. Fixing it at the top removes a compensation instead of adding one.",
    moment: "Backswing",
  },
];

const DRILLS = [
  {
    title: "Pump drill with a transition pause",
    copy: "Pause at the top, begin with the belt buckle, retain the wrist angle, and pump twice before swinging through.",
    dose: "3 × 5",
    doseNote: "Three sets of five rehearsals, then hit one full-speed shot.",
  },
  {
    title: "Chair drill for posture through impact",
    copy: "Set up with your seat just brushing a chair back and keep the contact all the way to the finish.",
    dose: "2 × 8",
    doseNote: "Two sets of eight rehearsals, then two shots at half speed.",
  },
  {
    title: "Split-hands release drill",
    copy: "Grip with hands two inches apart and make slow half swings — the trail hand cannot throw the club without the lead hand feeling it.",
    dose: "3 × 6",
    doseNote: "Three sets of six, alternating with one normal-grip swing.",
  },
];

const CUES = [
  "Pelvis must lead the chest.", "Retain wrist angle longer.", "Complete the turn without extra depth.",
  "Keep the seat against the wall.", "Cover the ball with the chest.", "Finish tall and hold it.",
];

const BANDS: [number, string][] = [[90, "Elite"], [75, "Pure"], [60, "Solid"], [40, "Building"], [0, "Reset"]];

export function scoreBand(score: number) {
  return (BANDS.find(([min]) => score >= min) ?? BANDS[BANDS.length - 1])[1];
}

/** Sample ramp: violet under 72, blue-ish under 80, acid above. */
export function scoreColor(score: number) {
  return score < 72 ? "#8b7bff" : score < 80 ? "#6e92ff" : "#5ed0ff";
}

/* ------------------------------------------------------------------- output */

export function mockScorecard(analysis: Analysis, id: string): MockScorecard {
  const r = rng(hash(id));

  const overall = between(r, 68, 90);
  const arcShift = between(r, -28, 18);
  const recentDelta = between(r, -4, 11);

  // Four faults and four strengths, drawn without replacement so nothing repeats in the grid.
  const neg = [...NEGATIVE].sort(() => r() - 0.5).slice(0, 4);
  const pos = [...POSITIVE].sort(() => r() - 0.5).slice(0, 4);

  const primaryBase = pick(r, PRIMARY);
  const primaryScore = between(r, 58, 74);

  const checkpoints: Record<string, CheckpointScore> = {};
  for (const c of analysis.checkpoints ?? []) {
    checkpoints[c.p] = {
      p: c.p,
      // Spread around the overall so the rail reads as one swing with weak spots, not noise.
      score: Math.max(48, Math.min(97, overall + between(r, -16, 12))),
      delta: between(r, -8, 9),
    };
  }
  // The primary fix should visibly be the weakest thing on the rail.
  const weakest = Object.values(checkpoints).sort((a, b) => a.score - b.score)[0];
  if (weakest) weakest.score = primaryScore;

  const priorities = Object.values(checkpoints)
    .sort((a, b) => a.score - b.score)
    .slice(0, 3)
    .map((c, i) => ({
      key: c.p,
      label: analysis.checkpoints?.find((x) => x.p === c.p)?.label ?? c.p,
      score: c.score,
      cue: CUES[(hash(id) + i) % CUES.length],
    }));

  return {
    overall,
    band: scoreBand(overall),
    arcShift,
    arcShiftLabel:
      arcShift < -15 ? "Early-loaded tendency"
      : arcShift > 15 ? "Late-loaded tendency"
      : arcShift < 0 ? "Slightly early-loaded"
      : arcShift > 0 ? "Slightly late-loaded"
      : "Centred on ideal",
    recentDelta,
    headline: overall >= 85
      ? "Strong swing. The details are what is left."
      : overall >= 75
        ? `Strong swing. Your ${primaryBase.moment.toLowerCase()} is the clearest opportunity.`
        : `Solid shape. Your ${primaryBase.moment.toLowerCase()} is costing the most.`,
    takeaway: pick(r, [
      "Begin the downswing with the pelvis while retaining wrist angle for two more frames.",
      "Keep your chest covering the ball an instant longer before you let it rotate open.",
      "Feel the lead hip clear behind you rather than sliding toward the target.",
      "Let the arms fall before the body turns — the sequence, not the speed, is the fix.",
    ]),
    // Interleaved so a row of four is never all-red or all-green — two rows of four on the
    // Overview grid, and the eye should read them as one balanced set.
    findings: [neg[0], pos[0], neg[1], pos[1], neg[2], pos[2], neg[3], pos[3]].filter(Boolean),
    checkpoints,
    primary: { ...primaryBase, score: primaryScore },
    drill: pick(r, DRILLS),
    priorities,
  };
}
