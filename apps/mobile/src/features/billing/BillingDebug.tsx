import { useMemo, useState } from "react";

import { useDebugGroups } from "../debug/DebugOverlay";
import { PERSONA_SCENARIOS, usePersona } from "../debug/persona";
import type { Denial } from "./entitlement";
import { SCENARIOS, useEntitlement, useEntitlementScenario } from "./entitlement";
import { REQUIRED_MEMBERSHIP, REQUIRED_PERSONAL } from "./plans";
import { UpgradeSheet } from "./UpgradeSheet";

/**
 * Every subscription state, forceable from the debug menu.
 *
 * Each of these is reachable in production only by waiting weeks or spending money, which is
 * exactly why an upgrade experience normally goes unjudged until launch. The standing rule
 * (Taylor, 2026-08-19) is that a feature with forceable states contributes them to the app-wide
 * debug sheet in the same change — and *only* there. None of this is a row in Settings: a
 * developer control in the product UI is the thing the rule exists to prevent.
 *
 * Registered app-wide next to the overlay rather than from a screen, because the states it
 * forces change Settings, the profile drawer and every gated control at once — "which screen
 * owns the switch" is the question that placement removes.
 *
 * Renders the refusal sheet itself, so both variants can be opened without first reaching the
 * flow that will trigger them. `DebugProvider` no-ops in release, and the caller gates on
 * `__DEV__`, so neither the controls nor their layout can reach a store build.
 */
export function BillingDebug() {
  const { scenarioId, setScenarioId } = useEntitlementScenario();
  const { usage, personal } = useEntitlement();
  const persona = usePersona();
  const [denial, setDenial] = useState<Denial | null>(null);

  const groups = useMemo(() => {
    // Only the states the ACTIVE persona can coherently be in — a Pro subscriber cannot be
    // mid-trial, and a brand-new free user has no billing history at all (the group hides).
    // Taylor's own account (null persona) keeps the full list, minus "never subscribed",
    // which the free personas carry.
    const allowed = persona ? PERSONA_SCENARIOS[persona] : null;
    const scenarios = SCENARIOS.filter((s) =>
      allowed ? allowed.includes(s.id) : s.id !== "free-never",
    );
    return [
      {
        title: "Subscription state",
        inline: true,
        // Pinned: subscription state lives up top with the persona picker.
        pinned: true,
        actions: scenarios.map((scenario) => ({
          key: `scenario-${scenario.id}`,
          label: scenario.id === scenarioId ? `● ${scenario.label}` : scenario.label,
          detail:
            "Forces the app's entitlement to this state — the plan row, the allowance meter, " +
            "the profile upgrade card and every gated control follow it.",
          onPress: () => setScenarioId(scenario.id),
        })),
      },
      {
        title: "Upgrade moments",
        inline: true,
        pinned: true,
        actions: [
          {
            key: "denial-allowance",
            label: "Allowance spent",
            detail: "The refusal a golfer meets when the month's analyses run out.",
            onPress: () =>
              setDenial({
                capability: "analysis",
                dimension: "personal",
                requiredTier: personal.tier,
                requiredMembership: null,
                usage,
                reason: "allowance",
              }),
          },
          {
            key: "denial-tier",
            label: "Locked capability",
            detail: "The refusal on a Pro-only control while on Free.",
            onPress: () =>
              setDenial({
                capability: "dual_device",
                dimension: "personal",
                requiredTier: REQUIRED_PERSONAL.dual_device,
                requiredMembership: null,
                usage: null,
                reason: "tier",
              }),
          },
          {
            key: "denial-membership",
            label: "Locked instructor tools",
            detail: "The instructor-dimension refusal — names a membership, never a golfer plan.",
            onPress: () =>
              setDenial({
                capability: "instructor_tools",
                dimension: "instructor",
                requiredTier: null,
                requiredMembership: REQUIRED_MEMBERSHIP.instructor_tools,
                usage: null,
                reason: "tier",
              }),
          },
        ],
      },
    ];
  }, [persona, scenarioId, setScenarioId, personal.tier, usage]);

  useDebugGroups("billing", groups);

  return <UpgradeSheet denial={denial} onClose={() => setDenial(null)} />;
}
