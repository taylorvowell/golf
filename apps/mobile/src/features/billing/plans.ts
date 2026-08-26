/**
 * The subscription model is TWO-DIMENSIONAL (the instructor-platform architecture, accepted
 * 2026-08-26): a **personal tier** (free | pro — the golfer ladder) and, for accounts holding
 * the instructor role, an **instructor membership** (free | gold | platinum). The one
 * derivation rule lives in `entitlement.tsx`: Gold and Platinum INCLUDE personal Pro.
 * A single rank ladder cannot express "a free-membership instructor on personal Pro", which is
 * why the old `Tier = free | pro | instructor` union is gone rather than extended — a rank
 * compare across the two dimensions must be a type error, not a plausible bug.
 *
 * Prices and the allowance are the accepted decision in `docs/decisions/commerce-entitlement.md`.
 * They live here as **fallback copy only**: on a real device the price string comes from StoreKit
 * or Play Billing (`storeProducts.ts`), because the stores localize, tax-adjust and discount per
 * storefront and a hardcoded "$119.99" is wrong everywhere except the US. Gold/Platinum carry no
 * fallback price yet — pricing is TBD and lands with `billing-iap`.
 *
 * Nothing here decides whether a capability is allowed — that is `entitlement.tsx`, resolving a
 * server payload later. This file is what the paywalls *say*, never what the app *enforces*
 * (§30.1).
 */

export type PersonalTier = "free" | "pro";
export type InstructorMembership = "free" | "gold" | "platinum";

/**
 * Named capabilities — the client mirror of the closed set `packages/schema` will own
 * (platform-foundation step 08). Gating on a string outside these unions is a compile error,
 * which is the point: an ungated capability cannot be discovered after launch.
 *
 * Split along the model's own line: golfer capabilities gate on the personal tier, instructor
 * capabilities on the membership. The maps are kept rather than collapsed to booleans because
 * the *reason* a capability is refused still has to reach the person by name.
 */
export type GolferCapability =
  | "analysis"
  | "ai_coach_chat"
  | "overlays"
  | "swing_comparison"
  | "pro_comparison"
  | "dual_device"
  | "export_share";

export type InstructorCapability = "instructor_tools";

export type Capability = GolferCapability | InstructorCapability;

export const REQUIRED_PERSONAL: Record<GolferCapability, PersonalTier> = {
  analysis: "pro",
  ai_coach_chat: "pro",
  overlays: "pro",
  swing_comparison: "pro",
  pro_comparison: "pro",
  dual_device: "pro",
  export_share: "pro",
};

/** Any instructor — the free membership included — holds the tools; the DIALS differ by
 *  membership (`MEMBERSHIP_LIMITS`). */
export const REQUIRED_MEMBERSHIP: Record<InstructorCapability, InstructorMembership> = {
  instructor_tools: "free",
};

export function isGolferCapability(c: Capability): c is GolferCapability {
  return c in REQUIRED_PERSONAL;
}

/**
 * §30.1's instructor dials, per membership — configuration, not code. Every value below is a
 * PLACEHOLDER until Gold/Platinum pricing is decided (`billing-iap`); the shape is what step 08
 * builds server-side. `Infinity` is deliberate for "unlimited": comparisons stay plain numbers
 * and no sentinel null threads through the UI.
 */
export interface MembershipLimits {
  rosterSize: number;
  lessonsPerMonth: number;
  maxLessonMinutes: number;
  drillLibrarySize: number;
  broadcastsPerMonth: number;
}

export const MEMBERSHIP_LIMITS: Record<InstructorMembership, MembershipLimits> = {
  free: { rosterSize: 3, lessonsPerMonth: 2, maxLessonMinutes: 3, drillLibrarySize: 5, broadcastsPerMonth: 2 },
  gold: { rosterSize: 30, lessonsPerMonth: 30, maxLessonMinutes: 10, drillLibrarySize: 100, broadcastsPerMonth: 20 },
  platinum: {
    rosterSize: Infinity,
    lessonsPerMonth: Infinity,
    maxLessonMinutes: 15,
    drillLibrarySize: Infinity,
    broadcastsPerMonth: Infinity,
  },
};

export interface Plan {
  tier: PersonalTier;
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

export const PLANS: Record<PersonalTier, Plan> = {
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
};

export interface MembershipPlan {
  membership: InstructorMembership;
  name: string;
  pitch: string;
  /** Fallback only, and null until priced (billing-iap). Free is never a store product. */
  priceMonthly: string | null;
  priceAnnual: string | null;
  /** Whether personal Pro rides along — the §2 derivation rule, stated as copy. */
  includesPro: boolean;
  unlocks: string[];
}

/**
 * The instructor ladder. Free is granted at instructor onboarding (a grant, no store
 * transaction); Gold/Platinum are sold ONLY on the instructor-mode paywall — the golfer paywall
 * never mentions them. Store SKUs in `storeProducts.ts`; all four paid products share one
 * subscription group so a membership upgrade from personal Pro is a store-native prorated
 * crossgrade (the §3 billing invariant).
 */
export const MEMBERSHIPS: Record<InstructorMembership, MembershipPlan> = {
  free: {
    membership: "free",
    name: "Instructor",
    pitch: "Your listing, your students, the tools to teach them.",
    priceMonthly: null,
    priceAnnual: null,
    includesPro: false,
    unlocks: [
      "A directory listing golfers can find",
      "A small roster and 1:1 messaging",
      "Review and annotate student swings",
    ],
  },
  gold: {
    membership: "gold",
    name: "Instructor Gold",
    pitch: "A working teaching business, with Pro for your own game included.",
    priceMonthly: null,
    priceAnnual: null,
    includesPro: true,
    unlocks: [
      "SwingSage Pro for your own swings — included",
      "A full roster with groups and broadcasts",
      "Video lessons and your own drill library",
    ],
  },
  platinum: {
    membership: "platinum",
    name: "Instructor Platinum",
    pitch: "No ceilings — every tool, every student, Pro included.",
    priceMonthly: null,
    priceAnnual: null,
    includesPro: true,
    unlocks: [
      "Everything in Gold, without limits",
      "Unlimited roster, lessons and drills",
      "Longer video lessons",
    ],
  },
};

/** The only tier sold on the GOLFER paywall. Memberships sell in instructor mode only. */
export const PAID_TIER: PersonalTier = "pro";

/** Person-facing name for a capability. A refusal says this, never the enum. */
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
  instructor_tools: "Your student roster, their swings, and the tools to teach them.",
};

/**
 * The safety valve, not a tier. A consumable that never renews, so it does not make the ladder
 * three-deep — it is what lets ONE paid plan carry a golfer who practises far above the average
 * without either an unlimited allowance (whose cost rises forever) or a second subscription.
 * It surfaces only at the moment the month runs out — and it works the same for an instructor
 * whose included-Pro allowance runs out.
 */
export const TOP_UP = {
  analyses: 50,
  price: "$9.99",
} as const;

export const TRIAL_DAYS = 21;
/** The trial's own analysis ceiling — separate from the plan allowance. */
export const TRIAL_ANALYSES = 15;
