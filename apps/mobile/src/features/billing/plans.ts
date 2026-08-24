/**
 * Three plans. Free, Pro, and Instructor (Taylor, 2026-08-24: instructors are their own tier —
 * everything Pro has, plus the instructor tools).
 *
 * The prices and the allowance are the accepted decision in
 * `docs/decisions/commerce-entitlement.md`. They live here as **fallback copy only**: on a real
 * device the price string comes from StoreKit or Play Billing (`storeProducts.ts`), because the
 * stores localize, tax-adjust and discount per storefront and a hardcoded "$119.99" is wrong
 * everywhere except the US.
 *
 * Nothing here decides whether a capability is allowed — that is `entitlement.ts`, resolving a
 * server payload. This file is what the paywall *says*, never what the app *enforces* (§30.1).
 */

export type Tier = "free" | "pro" | "instructor";

/**
 * Named capabilities — the client mirror of the closed set `packages/schema` will own
 * (platform-foundation step 08). Gating on a string outside this union is a compile error, which
 * is the point: an ungated capability cannot be discovered after launch.
 *
 * With one paid tier, every entry requires `pro`. The map is kept rather than collapsed to a
 * boolean because the *reason* a capability is refused still has to reach the golfer by name,
 * and because a second paid tier later becomes a value change here rather than a new concept.
 */
export type Capability =
  | "analysis"
  | "ai_coach_chat"
  | "overlays"
  | "swing_comparison"
  | "pro_comparison"
  | "dual_device"
  | "export_share"
  | "instructor_tools";

export interface Plan {
  tier: Tier;
  name: string;
  /** One line. What this tier IS — not a feature list. */
  pitch: string;
  /** Analyses included per month. `0` on Free is deliberate — see the decision register. */
  analysesPerMonth: number;
  /** Fallback only. The store's localized string wins when it loads. */
  priceMonthly: string | null;
  priceAnnual: string | null;
  annualNote: string | null;
  /** Bullets. What you get — kept to what a golfer would act on. */
  unlocks: string[];
  /** How long swings and video are kept. §30.2 wants this visible before it bites. */
  retention: string;
}

export const PLANS: Record<Tier, Plan> = {
  free: {
    tier: "free",
    name: "Free",
    pitch: "Everything you have already analysed stays yours.",
    analysesPerMonth: 0,
    priceMonthly: null,
    priceAnnual: null,
    annualNote: null,
    unlocks: [
      "Re-watch every report you have already run",
      "Your full swing history and progress",
      "Find and message an instructor",
    ],
    retention: "Kept for 30 days",
  },
  pro: {
    tier: "pro",
    name: "Pro",
    pitch: "Every swing analysed, with your coach on all of them.",
    analysesPerMonth: 100,
    priceMonthly: "$16.99",
    priceAnnual: "$119.99",
    annualNote: "Save 41%",
    unlocks: [
      "100 swing analyses a month",
      "AI coach on every swing",
      "Overlays, club trace and swing plane",
      "Compare swings, and compare against the pros",
      "Two-phone synchronised capture",
    ],
    retention: "Kept for as long as you subscribe",
  },
  instructor: {
    tier: "instructor",
    name: "Instructor",
    pitch: "Everything in Pro, plus your students.",
    analysesPerMonth: 100,
    // Not store-buyable yet — the tier is granted through instructor onboarding, so there is
    // no fallback price to show. Store products land with the coach platform.
    priceMonthly: null,
    priceAnnual: null,
    annualNote: null,
    unlocks: [
      "Everything in Pro",
      "Your student roster and their swings",
      "Review, annotate and message students",
      "Lesson notes and drills you assign",
    ],
    retention: "Kept for as long as you subscribe",
  },
};

/** The only tier you can buy in-app. Instructor is granted, never sold on this paywall. */
export const PAID_TIER: Tier = "pro";

/** Every golfer capability is Pro; the instructor tools are the Instructor tier's own. Free
 *  keeps what it already has; it does not produce anything new. */
export const REQUIRED_TIER: Record<Capability, Tier> = {
  analysis: "pro",
  ai_coach_chat: "pro",
  overlays: "pro",
  swing_comparison: "pro",
  pro_comparison: "pro",
  dual_device: "pro",
  export_share: "pro",
  instructor_tools: "instructor",
};

/**
 * An instructor cannot HAVE an instructor (Taylor, 2026-08-24) — the find-an-instructor
 * directory, the connected-instructor card and every link-a-coach door hide on the
 * Instructor tier. A rule, not a capability: rank-based `can()` would grant it upward.
 */
export function canHaveInstructor(tier: Tier): boolean {
  return tier !== "instructor";
}

/** Golfer-facing name for a capability. A refusal says this, never the enum. */
export const CAPABILITY_LABEL: Record<Capability, string> = {
  analysis: "Swing analysis",
  ai_coach_chat: "AI coach conversation",
  overlays: "Overlays and traces",
  swing_comparison: "Swing comparison",
  pro_comparison: "Pro comparison",
  dual_device: "Two-phone capture",
  export_share: "Export and share",
  instructor_tools: "Instructor tools",
};

/** One sentence on why it is worth having. Shown on the refusal sheet. */
export const CAPABILITY_PITCH: Record<Capability, string> = {
  analysis: "Every swing scored, with what to work on first.",
  ai_coach_chat: "Ask your coach anything about a swing you just hit.",
  overlays: "See the skeleton, the club trace and your swing plane on the video.",
  swing_comparison: "Put two of your swings side by side, frame-locked.",
  pro_comparison: "Put your swing beside a tour pro at the same checkpoint.",
  dual_device: "Down-the-line and face-on at once, from two phones, in sync.",
  export_share: "Send a swing to anyone, with the analysis attached.",
  instructor_tools: "Your student roster, their swings, and the tools to coach them.",
};

/**
 * The safety valve, not a tier. A consumable that never renews, so it does not make the ladder
 * three-deep — it is what lets ONE paid plan carry a golfer who practises far above the average
 * without either an unlimited allowance (whose cost rises forever) or a second subscription.
 * It surfaces only at the moment the month runs out.
 */
export const TOP_UP = {
  analyses: 50,
  price: "$9.99",
} as const;

export const TRIAL_DAYS = 21;
/** The trial's own analysis ceiling — separate from the plan allowance. */
export const TRIAL_ANALYSES = 15;
