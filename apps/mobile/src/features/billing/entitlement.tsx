import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import {
  PLANS,
  REQUIRED_TIER,
  TRIAL_ANALYSES,
  TRIAL_DAYS,
  type Capability,
  type Tier,
} from "./plans";

/**
 * The entitlement seam, client side — and today, a mock behind it.
 *
 * **Every gate in the app asks this and only this.** No screen compares a tier name inline
 * (`if (tier === "pro")`), because that is the per-screen hard-coding §30.1 exists to forbid:
 * the moment tier limits become server configuration, an inline comparison is a lie the deploy
 * cannot fix. Screens ask `can(capability)` and render `deny(capability)`.
 *
 * The `Denial` shape below is deliberately the shape platform-foundation step 08 specifies for
 * the server's 402 body — capability, the tier that unlocks it, and current usage. That is what
 * makes swapping the mock for the real resolver a one-file change: the paywall already renders
 * from the payload rather than from a hardcoded switch, so the server owns the rules and the
 * client owns only the pixels.
 *
 * Until billing exists every capability that the *tier* grants is allowed — the mock's job is to
 * let the upgrade experience be walked and judged on a device, not to enforce anything. The
 * debug sheet's Subscription state group is how each state is reached without a purchase.
 */

/**
 * Every state a subscription can really be in — including the two payment-recovery states the
 * stores drive and the app does not, which are the ones a hand-written status enum always misses.
 *
 * - `in_grace` — renewal payment failed and the store is retrying. **Access continues.** Play's
 *   `queryPurchasesAsync` keeps returning the purchase, so an app that only asks "is there a
 *   purchase" handles this by accident; one that models status itself must decide deliberately.
 * - `on_hold`  — grace ran out without recovery. **Access stops**, but the golfer is not gone:
 *   Play holds for up to 60 days (raised from 30 in Dec 2025) and a recovered payment restarts
 *   the same subscription. Treating hold as `expired` throws away a subscriber who is coming back.
 * - `paused`   — Play-only, golfer-initiated. Access stops; it resumes on a date they chose.
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
  requiredTier: Tier;
  /** Present only when the refusal was a spent allowance rather than a missing tier. */
  usage: Usage | null;
  /** Which of the two refusals this is — the sheet that renders differs. */
  reason: "tier" | "allowance";
}

export interface Entitlement {
  tier: Tier;
  status: SubscriptionStatus;
  /** Null unless `status === "trialing"`. */
  trialDaysLeft: number | null;
  usage: Usage;
  /** Human, short — "1 Sep 2027". Null when nothing renews. */
  renewsOn: string | null;
  can: (capability: Capability) => boolean;
  deny: (capability: Capability) => Denial | null;
  /** Fraction of the allowance still unspent, 0–1. */
  remainingFraction: number;
  remaining: number;
}

const TIER_RANK: Record<Tier, number> = { free: 0, pro: 1, instructor: 2 };

/** A tier grants a capability when it sits at or above the capability's required tier. */
function tierGrants(tier: Tier, capability: Capability): boolean {
  return TIER_RANK[tier] >= TIER_RANK[REQUIRED_TIER[capability]];
}

/** Capabilities that spend the monthly allowance. Everything else is a pure tier gate. */
const METERED: ReadonlySet<Capability> = new Set<Capability>(["analysis"]);

// ---------------------------------------------------------------------------
// Scenarios — the mock's whole surface. Each is a state a golfer can really be in.
// ---------------------------------------------------------------------------

export interface Scenario {
  id: string;
  /** What this state IS, in the words you would use walking someone through it. */
  label: string;
  tier: Tier;
  status: SubscriptionStatus;
  trialDaysLeft: number | null;
  used: number;
  /** Overrides the plan allowance — used by the trial, which has its own ceiling. */
  included?: number;
  renewsOn: string | null;
  resetsOn: string;
}

export const SCENARIOS: Scenario[] = [
  {
    id: "trial-fresh",
    label: "On trial, day 1",
    tier: "pro",
    status: "trialing",
    trialDaysLeft: TRIAL_DAYS,
    used: 0,
    included: TRIAL_ANALYSES,
    renewsOn: null,
    resetsOn: "when your trial ends",
  },
  {
    id: "trial-ending",
    label: "On trial, 3 days left",
    tier: "pro",
    status: "trialing",
    trialDaysLeft: 3,
    used: 11,
    included: TRIAL_ANALYSES,
    renewsOn: null,
    resetsOn: "when your trial ends",
  },
  {
    id: "pro-healthy",
    label: "Pro, plenty left",
    tier: "pro",
    status: "active",
    trialDaysLeft: null,
    used: 22,
    renewsOn: "1 Sep 2027",
    resetsOn: "1 Sep",
  },
  {
    id: "instructor",
    label: "Instructor",
    tier: "instructor",
    status: "active",
    trialDaysLeft: null,
    used: 18,
    renewsOn: "1 Sep 2027",
    resetsOn: "1 Sep",
  },
  {
    id: "pro-low",
    label: "Pro, running low",
    tier: "pro",
    status: "active",
    trialDaysLeft: null,
    used: 84,
    renewsOn: "1 Sep 2027",
    resetsOn: "1 Sep",
  },
  {
    id: "pro-spent",
    label: "Pro, allowance spent",
    tier: "pro",
    status: "active",
    trialDaysLeft: null,
    used: 100,
    renewsOn: "1 Sep 2027",
    resetsOn: "1 Sep",
  },
  {
    id: "grace",
    label: "Payment failed — in grace",
    tier: "pro",
    status: "in_grace",
    trialDaysLeft: null,
    used: 40,
    renewsOn: null,
    resetsOn: "1 Sep",
  },
  {
    id: "hold",
    label: "Payment failed — on hold",
    tier: "pro",
    status: "on_hold",
    trialDaysLeft: null,
    used: 40,
    renewsOn: null,
    resetsOn: "1 Sep",
  },
  {
    id: "free-never",
    label: "Free — never subscribed",
    tier: "free",
    status: "none",
    trialDaysLeft: null,
    used: 0,
    renewsOn: null,
    resetsOn: "—",
  },
  {
    id: "free-expired",
    label: "Free — trial is over",
    tier: "free",
    status: "expired",
    trialDaysLeft: null,
    used: 0,
    renewsOn: null,
    resetsOn: "—",
  },
];

/**
 * Free, never subscribed — the state the upgrade experience is being judged in, so it is the
 * one the app boots into. Every other state is one tap away in the debug sheet.
 */
export const DEFAULT_SCENARIO = "free-never";

// ---------------------------------------------------------------------------

function build(scenario: Scenario): Entitlement {
  const included = scenario.included ?? PLANS[scenario.tier].analysesPerMonth;
  const usage: Usage = { used: scenario.used, included, resetsOn: scenario.resetsOn };
  const remaining = Math.max(0, included - scenario.used);

  const deny = (capability: Capability): Denial | null => {
    // Status outranks tier: a Pro golfer on account hold holds the tier and none of its
    // capabilities. Checking tier alone is how a lapsed payment keeps its entitlement.
    if (!tierGrants(scenario.tier, capability) || !ENTITLED.has(scenario.status)) {
      return { capability, requiredTier: REQUIRED_TIER[capability], usage: null, reason: "tier" };
    }
    if (METERED.has(capability) && remaining <= 0) {
      // The tier is fine; the month is spent. A Pro golfer with nothing left is offered
      // capacity, never a tier they already hold — hence reason and requiredTier are separate.
      return { capability, requiredTier: scenario.tier, usage, reason: "allowance" };
    }
    return null;
  };

  return {
    tier: scenario.tier,
    status: scenario.status,
    trialDaysLeft: scenario.trialDaysLeft,
    usage,
    renewsOn: scenario.renewsOn,
    can: (capability) => deny(capability) == null,
    deny,
    remaining,
    remainingFraction: included === 0 ? 0 : remaining / included,
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
