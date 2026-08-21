import type { GolferProfilePrivate } from "@swingsage/schema/contract";

/**
 * The golfer-language layer over the profile — every field the app ASKS FOR, in one registry
 * that My profile and onboarding both render from.
 *
 * **Exactly six questions** (Taylor, 2026-08-20, third and final cut): handedness, swing
 * style, handicap, age, driver speed, 7-iron carry. Nothing else — goals moved out of the
 * profile entirely (they will be handled by the guidance features, not here), and every other
 * §5.5 field was removed from product, API, contract and database together (migrations
 * 0014/0015), never parked. Re-asking a field later is an additive migration plus one entry
 * here.
 *
 * Copy rules: labels are short nouns a golfer already uses, values read as answers
 * ("Right-handed", "95 mph"), no explanatory subtitles.
 */

type Priv = GolferProfilePrivate;
export type ChoiceKey = "handedness" | "selfReportedStyle" | "handicapRange" | "ageRange";
export type NumberKey = "driverSwingSpeedMph" | "sevenIronCarryYds";

export interface ChoiceOption {
  value: string;
  label: string;
  /** Only where the choice needs it to MEAN anything (swing styles). Never decoration. */
  detail?: string;
}

export interface ChoiceField {
  kind: "choice";
  key: ChoiceKey;
  label: string;
  options: ChoiceOption[];
}

export interface NumberField {
  kind: "number";
  key: NumberKey;
  label: string;
  min: number;
  max: number;
  step: number;
  /** A sensible first value when unset, so the stepper opens mid-range, not at a wall. */
  start: number;
  format: (n: number) => string;
}

export type ProfileField = ChoiceField | NumberField;

/** §5.4's styles in golfer language — the phrase IS the choice, so `detail` earns its place. */
export const STYLE_OPTIONS: ChoiceOption[] = [
  { value: "sty_01", label: "Rotational", detail: "Smooth and connected, swinging around the body" },
  { value: "sty_02", label: "Free swinging", detail: "Upright, with a big free arm swing" },
  { value: "sty_03", label: "Power first", detail: "Aggressive, with a big weight shift" },
  { value: "sty_04", label: "Compact", detail: "Centered and consistent above all" },
  { value: "unsure", label: "Not sure", detail: "Work it out from my swings" },
];

export const HANDICAP_OPTIONS: ChoiceOption[] = [
  { value: "plus", label: "Plus" },
  { value: "scratch_5", label: "Scratch–5" },
  { value: "6_10", label: "6–10" },
  { value: "11_15", label: "11–15" },
  { value: "16_20", label: "16–20" },
  { value: "21_28", label: "21–28" },
  { value: "29_plus", label: "29+" },
];

/** The six, in display order — My profile renders exactly this, two tiles per row. */
export const PROFILE_FIELDS: ProfileField[] = [
  {
    kind: "choice", key: "handedness", label: "Handedness",
    options: [
      { value: "right", label: "Right-handed" },
      { value: "left", label: "Left-handed" },
    ],
  },
  { kind: "choice", key: "selfReportedStyle", label: "Swing style", options: STYLE_OPTIONS },
  { kind: "choice", key: "handicapRange", label: "Handicap", options: HANDICAP_OPTIONS },
  {
    kind: "choice", key: "ageRange", label: "Age",
    options: [
      { value: "under_18", label: "Under 18" },
      { value: "18_29", label: "18–29" },
      { value: "30_39", label: "30–39" },
      { value: "40_49", label: "40–49" },
      { value: "50_59", label: "50–59" },
      { value: "60_69", label: "60–69" },
      { value: "70_plus", label: "70+" },
    ],
  },
  {
    kind: "number", key: "driverSwingSpeedMph", label: "Driver speed",
    min: 60, max: 140, step: 1, start: 95, format: (n) => `${Math.round(n)} mph`,
  },
  {
    kind: "number", key: "sevenIronCarryYds", label: "7-iron carry",
    min: 80, max: 220, step: 5, start: 150, format: (n) => `${Math.round(n)} yds`,
  },
];

/**
 * What a field's current answer looks like on its tile — golfer language, or null for "not
 * answered yet" (the tile renders that state itself; this never invents a default).
 */
export function displayValue(field: ProfileField, priv: Priv): string | null {
  if (field.kind === "choice") {
    const v = priv[field.key];
    if (v === null || v === undefined) return null;
    const hit = field.options.find((o) => o.value === v);
    return hit ? hit.label : String(v);
  }
  const v = priv[field.key];
  return typeof v === "number" ? field.format(v) : null;
}
