import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import {
  MEMBERSHIPS,
  PLANS,
  REQUIRED_MEMBERSHIP,
  REQUIRED_PERSONAL,
  TRIAL_ANALYSES,
  TRIAL_DAYS,
  isGolferCapability,
  type Capability,
  type InstructorMembership,
  type PersonalTier,
} from "./plans";

/**
 * The entitlement seam, client side — and today, a mock behind it.
 *
 * **Every gate in the app asks this and only this.** No screen compares a tier or membership
 * name inline, because that is the per-screen hard-coding §30.1 exists to forbid: the moment
 * limits become server configuration, an inline comparison is a lie the deploy cannot fix.
 * Screens ask `can(capability)` and render `deny(capability)`.
 *
 * The model is TWO-DIMENSIONAL (instructor-platform architecture, accepted 2026-08-26):
 * a personal tier (free | pro) and, for instructor-role accounts, a membership
 * (free | gold | platinum). **The one derivation rule:** an ENTITLED Gold or Platinum
 * membership includes personal Pro — `personal.tier` is the EFFECTIVE tier after inclusion,
 * with `source: "included"` saying where it came from. Everything else survives from the
 * one-dimension seam unchanged: status outranks tier (in both dimensions), only `analysis`
 * meters the allowance, and the `Denial` mirrors the server's planned 402 body (step 08) —
 * now carrying which dimension refused.
 *
 * Until billing exists every capability the *state* grants is allowed — the mock's job is to
 * let the upgrade and instructor experiences be walked and judged on a device, not to enforce
 * anything. The debug sheet's Subscription state group is how each state is reached without a
 * purchase.
 */

/**
 * Every state a subscription can really be in — including the two payment-recovery states the
 * stores drive and the app does not, which are the ones a hand-written status enum always misses.
 *
 * - `in_grace` — renewal payment failed and the store is retrying. **Access continues.**
 * - `on_hold`  — grace ran out without recovery. **Access stops**, but the person is not gone:
 *   Play holds for up to 60 days and a recovered payment restarts the same subscription.
 *   Treating hold as `expired` throws away a subscriber who is coming back.
 * - `paused`   — Play-only, golfer-initiated. Access stops; it resumes on a date they chose.
 *
 * A FREE instructor membership is a grant, not a store subscription — it is modelled as
 * `active`, because a grant that exists is entitled and there is nothing for a store to recover.
 */
export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "in_grace"
  | "on_hold"
  | "paused"
  | "expired"
  | "none";

/** The statuses that still grant what the tier includes. Grace does; hold and pause do not. */
const ENTITLED: ReadonlySet<SubscriptionStatus> = new Set<SubscriptionStatus>([
  "trialing",
  "active",
  "in_grace",
]);

/** True while the store is recovering a payment or the golfer paused — never "expired". */
export function isRecoverable(status: SubscriptionStatus): boolean {
  return status === "in_grace" || status === "on_hold" || status === "paused";
}

export interface Usage {
  used: number;
  included: number;
  /** Human, short — "1 Sep". A raw ISO date on a golfer's screen is diagnostics. */
  resetsOn: string;
}

/** What a refused capability returns. Mirrors the server's denial body (step 08). */
export interface Denial {
  capability: Capability;
  /** Which dimension refused — the sheet's copy and CTA differ completely. */
  dimension: "personal" | "instructor";
  /** Set when `dimension === "personal"`. */
  requiredTier: PersonalTier | null;
  /** Set when `dimension === "instructor"`. */
  requiredMembership: InstructorMembership | null;
  /** Present only when the refusal was a spent allowance rather than a missing tier. */
  usage: Usage | null;
  /** Which of the two refusals this is — the sheet that renders differs. */
  reason: "tier" | "allowance";
}

export interface PersonalEntitlement {
  /** The EFFECTIVE tier, after membership inclusion. */
  tier: PersonalTier;
  /** Where Pro came from. `included` = granted by Gold/Platinum; `none` = free. */
  source: "purchase" | "included" | "none";
  /** For `included`, this is the MEMBERSHIP's status — the granting subscription's. */
  status: SubscriptionStatus;
  /** Null unless `status === "trialing"`. */
  trialDaysLeft: number | null;
  usage: Usage;
  /** Human, short — "1 Sep 2027". Null when nothing renews. */
  renewsOn: string | null;
}

export interface InstructorEntitlement {
  membership: InstructorMembership;
  status: SubscriptionStatus;
  renewsOn: string | null;
}

export interface Entitlement {
  personal: PersonalEntitlement;
  /** Null unless the account holds the instructor role. */
  instructor: InstructorEntitlement | null;
  can: (capability: Capability) => boolean;
  deny: (capability: Capability) => Denial | null;
  /** The metered allowance, surfaced top-level — there is exactly one, and it is personal. */
  usage: Usage;
  remaining: number;
  /** Fraction of the allowance still unspent, 0–1. */
  remainingFraction: number;
}

/**
 * An instructor cannot HAVE an instructor (Taylor, 2026-08-24) — the find-an-instructor
 * directory, the connected-instructor card and every link-an-instructor door hide when the
 * account holds the role. A rule keyed on the DIMENSION existing, not on any rank — which is
 * exactly what the old rank ladder could not express.
 */
export function canHaveInstructor(entitlement: Entitlement): boolean {
  return entitlement.instructor == null;
}

const TIER_RANK: Record<PersonalTier, number> = { free: 0, pro: 1 };
const MEMBERSHIP_RANK: Record<InstructorMembership, number> = { free: 0, gold: 1, platinum: 2 };

/** Capabilities that spend the monthly allowance. Everything else is a pure gate. */
const METERED: ReadonlySet<Capability> = new Set<Capability>(["analysis"]);

// ---------------------------------------------------------------------------
// Scenarios — the mock's whole surface. Each is a state a person can really be in.
// The one-subscription invariant (§3 of the architecture) is why no scenario holds a
// personal purchase AND a paid membership: Gold/Platinum replace Pro at the store.
// ---------------------------------------------------------------------------

export interface Scenario {
  id: string;
  /** What this state IS, in the words you would use walking someone through it. */
  label: string;
  personal: {
    tier: PersonalTier;
    status: SubscriptionStatus;
    trialDaysLeft: number | null;
    used: number;
    /** Overrides the plan allowance — used by the trial, which has its own ceiling. */
    included?: number;
    renewsOn: string | null;
    resetsOn: string;
  };
  /** Absent on every golfer scenario — the account holds no instructor role. */
  instructor?: {
    membership: InstructorMembership;
    status: SubscriptionStatus;
    renewsOn: string | null;
  };
}

export const SCENARIOS: Scenario[] = [
  {
    id: "trial-fresh",
    label: "On trial, day 1",
    personal: {
      tier: "pro",
      status: "trialing",
      trialDaysLeft: TRIAL_DAYS,
      used: 0,
      included: TRIAL_ANALYSES,
      renewsOn: null,
      resetsOn: "when your trial ends",
    },
  },
  {
    id: "trial-ending",
    label: "On trial, 3 days left",
    personal: {
      tier: "pro",
      status: "trialing",
      trialDaysLeft: 3,
      used: 11,
      included: TRIAL_ANALYSES,
      renewsOn: null,
      resetsOn: "when your trial ends",
    },
  },
  {
    id: "pro-healthy",
    label: "Pro, plenty left",
    personal: {
      tier: "pro",
      status: "active",
      trialDaysLeft: null,
      used: 22,
      renewsOn: "1 Sep 2027",
      resetsOn: "1 Sep",
    },
  },
  {
    id: "pro-low",
    label: "Pro, running low",
    personal: {
      tier: "pro",
      status: "active",
      trialDaysLeft: null,
      used: 84,
      renewsOn: "1 Sep 2027",
      resetsOn: "1 Sep",
    },
  },
  {
    id: "pro-spent",
    label: "Pro, allowance spent",
    personal: {
      tier: "pro",
      status: "active",
      trialDaysLeft: null,
      used: 100,
      renewsOn: "1 Sep 2027",
      resetsOn: "1 Sep",
    },
  },
  {
    id: "grace",
    label: "Payment failed — in grace",
    personal: {
      tier: "pro",
      status: "in_grace",
      trialDaysLeft: null,
      used: 40,
      renewsOn: null,
      resetsOn: "1 Sep",
    },
  },
  {
    id: "hold",
    label: "Payment failed — on hold",
    personal: {
      tier: "pro",
      status: "on_hold",
      trialDaysLeft: null,
      used: 40,
      renewsOn: null,
      resetsOn: "1 Sep",
    },
  },
  {
    id: "free-never",
    label: "Free — never subscribed",
    personal: {
      tier: "free",
      status: "none",
      trialDaysLeft: null,
      used: 0,
      renewsOn: null,
      resetsOn: "—",
    },
  },
  {
    id: "free-expired",
    label: "Free — trial is over",
    personal: {
      tier: "free",
      status: "expired",
      trialDaysLeft: null,
      used: 0,
      renewsOn: null,
      resetsOn: "—",
    },
  },
  // ---- instructor states ------------------------------------------------------------------
  {
    id: "inst-free",
    label: "Instructor — free membership",
    personal: {
      tier: "free",
      status: "none",
      trialDaysLeft: null,
      used: 0,
      renewsOn: null,
      resetsOn: "—",
    },
    instructor: { membership: "free", status: "active", renewsOn: null },
  },
  {
    id: "inst-free-pro",
    label: "Instructor — free membership, personal Pro",
    personal: {
      tier: "pro",
      status: "active",
      trialDaysLeft: null,
      used: 31,
      renewsOn: "1 Sep 2027",
      resetsOn: "1 Sep",
    },
    instructor: { membership: "free", status: "active", renewsOn: null },
  },
  {
    id: "inst-gold",
    label: "Instructor Gold — Pro included",
    personal: {
      tier: "free",
      status: "none",
      trialDaysLeft: null,
      used: 18,
      renewsOn: null,
      resetsOn: "1 Sep",
    },
    instructor: { membership: "gold", status: "active", renewsOn: "1 Sep 2027" },
  },
  {
    id: "inst-platinum",
    label: "Instructor Platinum — Pro included",
    personal: {
      tier: "free",
      status: "none",
      trialDaysLeft: null,
      used: 42,
      renewsOn: null,
      resetsOn: "1 Sep",
    },
    instructor: { membership: "platinum", status: "active", renewsOn: "1 Sep 2027" },
  },
  {
    id: "inst-gold-grace",
    label: "Instructor Gold — payment in grace",
    personal: {
      tier: "free",
      status: "none",
      trialDaysLeft: null,
      used: 18,
      renewsOn: null,
      resetsOn: "1 Sep",
    },
    instructor: { membership: "gold", status: "in_grace", renewsOn: null },
  },
  {
    id: "inst-gold-hold",
    label: "Instructor Gold — payment on hold",
    personal: {
      tier: "free",
      status: "none",
      trialDaysLeft: null,
      used: 18,
      renewsOn: null,
      resetsOn: "—",
    },
    instructor: { membership: "gold", status: "on_hold", renewsOn: null },
  },
];

/**
 * Free, never subscribed — the state the upgrade experience is being judged in, so it is the
 * one the app boots into. Every other state is one tap away in the debug sheet.
 */
export const DEFAULT_SCENARIO = "free-never";

// ---------------------------------------------------------------------------

function build(scenario: Scenario): Entitlement {
  const instructor: InstructorEntitlement | null = scenario.instructor ?? null;
  const membershipEntitled = instructor != null && ENTITLED.has(instructor.status);

  // The derivation rule. `personal.tier` is EFFECTIVE: an entitled Gold/Platinum membership
  // includes Pro, and the included Pro's status IS the membership's status — there is one
  // subscription behind both, so there is one payment state.
  const included =
    membershipEntitled && instructor != null && MEMBERSHIP_RANK[instructor.membership] >= 1;
  const tier: PersonalTier = included ? "pro" : scenario.personal.tier;
  const status = included && instructor != null ? instructor.status : scenario.personal.status;
  const source: PersonalEntitlement["source"] = included
    ? "included"
    : scenario.personal.tier === "pro"
      ? "purchase"
      : "none";

  const includedAllowance = scenario.personal.included ?? PLANS[tier].analysesPerMonth;
  const usage: Usage = {
    used: scenario.personal.used,
    included: includedAllowance,
    resetsOn: scenario.personal.resetsOn,
  };
  const remaining = Math.max(0, includedAllowance - scenario.personal.used);

  const personal: PersonalEntitlement = {
    tier,
    source,
    status,
    trialDaysLeft: scenario.personal.trialDaysLeft,
    usage,
    renewsOn: included && instructor != null ? instructor.renewsOn : scenario.personal.renewsOn,
  };

  const deny = (capability: Capability): Denial | null => {
    if (isGolferCapability(capability)) {
      // Status outranks tier: a Pro golfer on account hold holds the tier and none of its
      // capabilities. Checking tier alone is how a lapsed payment keeps its entitlement.
      if (TIER_RANK[tier] < TIER_RANK[REQUIRED_PERSONAL[capability]] || !ENTITLED.has(status)) {
        return {
          capability,
          dimension: "personal",
          requiredTier: REQUIRED_PERSONAL[capability],
          requiredMembership: null,
          usage: null,
          reason: "tier",
        };
      }
      if (METERED.has(capability) && remaining <= 0) {
        // The tier is fine; the month is spent. A Pro golfer with nothing left is offered
        // capacity, never a tier they already hold — hence reason and requiredTier are separate.
        return {
          capability,
          dimension: "personal",
          requiredTier: tier,
          requiredMembership: null,
          usage,
          reason: "allowance",
        };
      }
      return null;
    }

    // Instructor dimension. No role → no membership → refused at the ladder's foot; a held
    // membership is refused the same way a held Pro is — status outranks membership.
    const required = REQUIRED_MEMBERSHIP[capability];
    if (
      instructor == null ||
      !ENTITLED.has(instructor.status) ||
      MEMBERSHIP_RANK[instructor.membership] < MEMBERSHIP_RANK[required]
    ) {
      return {
        capability,
        dimension: "instructor",
        requiredTier: null,
        requiredMembership: required,
        usage: null,
        reason: "tier",
      };
    }
    return null;
  };

  return {
    personal,
    instructor,
    can: (capability) => deny(capability) == null,
    deny,
    usage,
    remaining,
    remainingFraction: includedAllowance === 0 ? 0 : remaining / includedAllowance,
  };
}

interface EntitlementContext {
  entitlement: Entitlement;
  /** Dev-only. Real entitlement changes come from the server after a verified receipt. */
  scenarioId: string;
  setScenarioId: (id: string) => void;
}

const Ctx = createContext<EntitlementContext | null>(null);

export function EntitlementProvider({ children }: { children: ReactNode }) {
  const [scenarioId, setScenarioId] = useState(DEFAULT_SCENARIO);
  const value = useMemo<EntitlementContext>(() => {
    const scenario = SCENARIOS.find((s) => s.id === scenarioId) ?? SCENARIOS[0];
    return { entitlement: build(scenario), scenarioId, setScenarioId };
  }, [scenarioId]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The one hook every gate uses. Throws rather than guessing — a missing provider is a bug. */
export function useEntitlement(): Entitlement {
  const ctx = useContext(Ctx);
  if (ctx == null) throw new Error("useEntitlement must be used inside <EntitlementProvider>");
  return ctx.entitlement;
}

/** Dev-only: the scenario switcher's handle. Not for product code. */
export function useEntitlementScenario() {
  const ctx = useContext(Ctx);
  if (ctx == null)
    throw new Error("useEntitlementScenario must be used inside <EntitlementProvider>");
  return { scenarioId: ctx.scenarioId, setScenarioId: ctx.setScenarioId };
}

/**
 * The gate a screen actually calls: ask for a capability, get back either permission or the
 * denial to render. Returning the denial rather than a boolean is what keeps upgrade copy out
 * of the calling screen.
 */
export function useCapability(capability: Capability): { allowed: boolean; denial: Denial | null } {
  const entitlement = useEntitlement();
  const denial = useMemo(() => entitlement.deny(capability), [entitlement, capability]);
  return { allowed: denial == null, denial };
}

/** Stable across renders so a screen can gate an onPress without re-creating the handler. */
export function useGuard() {
  const entitlement = useEntitlement();
  return useCallback(
    (capability: Capability): Denial | null => entitlement.deny(capability),
    [entitlement],
  );
}

/** The membership's display name, for status lines ("Included with your Gold membership"). */
export function membershipName(membership: InstructorMembership): string {
  return MEMBERSHIPS[membership].name;
}
