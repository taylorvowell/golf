import { type ReactNode } from "react";
import { Film, Gauge, ScanLine, Sparkles } from "lucide-react-native";

import type { Capability, Tier } from "../billing/plans";
import { PLANS } from "../billing/plans";
import type { Navigation } from "../../navigation";
import { ON_DARK } from "../../theme/palette";
import { FeatureSpotlight } from "./templates/FeatureSpotlight";
import { MilestoneSpotlight } from "./templates/MilestoneSpotlight";
import { MultiviewCard } from "./MultiviewCard";

/**
 * The spotlight deck — every card that can appear in the Home hero carousel, in curation
 * order. Code-defined on purpose: a card is a React component with an eligibility rule,
 * not a CMS row, and shipping one is a registry entry.
 *
 * **Ids are versioned** (`multiview.v1`) and the id IS the dismissal identity
 * (`spotlight.<id>` in the `user_dismissals` store): re-launching a reworked card is a
 * version bump — a fresh, undismissed key — never an un-dismissal.
 *
 * **Eligibility is a pure function of `SpotlightContext`**, built entirely from data Home
 * already holds — eligibility must never cost a network request. `triggers` is the
 * personalization seam: always empty today, later fed by server-granted events
 * (`user_spotlight_triggers`, an additive extension of the dismissals GET), so an
 * event-driven card is a registry entry gated on `ctx.triggers.has(...)`, not a redesign.
 */

export interface SpotlightContext {
  tier: Tier;
  /** The entitlement seam — capability questions go here, never an inline tier compare. */
  can: (capability: Capability) => boolean;
  /** The golfer's own analysed swings — bundled pro references excluded. */
  swingCount: number;
  sessionCount: number;
  accountAgeDays: number;
  /** Server-granted triggers. EMPTY in v1 — the future-personalization seam. */
  triggers: ReadonlySet<string>;
}

export interface SpotlightCardApi {
  width: number;
  navigation: Navigation;
}

export interface SpotlightDef {
  /** Versioned: `<name>.vN`. Dismissal key = `spotlight.<id>`. */
  id: string;
  /** Short human name — the dismiss X's accessibility label says it. */
  label: string;
  eligible: (ctx: SpotlightContext) => boolean;
  render: (api: SpotlightCardApi) => ReactNode;
}

const KEY_PREFIX = "spotlight.";

/** The `user_dismissals` key for a card. */
export function spotlightKey(id: string): string {
  return `${KEY_PREFIX}${id}`;
}

export const SPOTLIGHTS: SpotlightDef[] = [
  {
    // The flagship. Multiview itself ships with the dual-device tracks; the card sells the
    // capture door today and can be gated behind a trigger later if that reads wrong on the
    // step 04 walk (a one-line `eligible` change).
    id: "multiview.v1",
    label: "the multiview card",
    eligible: () => true,
    render: ({ navigation }) => (
      <MultiviewCard testID="spotlight-multiview" onPress={() => navigation.navigate("Record")} />
    ),
  },
  {
    // Migrated from the stacked DeepIntroCard (its dismissal replays into this key). Same
    // contract as ever: only the X hides it — walking the session leaves the door open.
    id: "deep-intro.v1",
    label: "the deep analysis card",
    eligible: () => true,
    render: ({ navigation }) => (
      <FeatureSpotlight
        testID="spotlight-deep-intro"
        icon={<DeepIcon />}
        eyebrow="Guided session"
        title="Deep swing analysis"
        copy="Your coach plays your swing, pausing at the moments that matter — drawn on your own video."
        cta={{ label: "Start", onPress: () => navigation.navigate("DeepAnalysis") }}
      />
    ),
  },
  {
    // Migrated from the stacked StanceIntroCard, same replay.
    id: "stance-intro.v1",
    label: "the stance analysis card",
    eligible: () => true,
    render: ({ navigation }) => (
      <FeatureSpotlight
        testID="spotlight-stance-intro"
        icon={<StanceIcon />}
        eyebrow="Your coach is ready"
        title="Guided stance analysis"
        copy="A two-minute walkthrough of your setup, drawn over your own address — your first session with your coach."
        cta={{ label: "Start", onPress: () => navigation.navigate("StanceAnalysis") }}
      />
    ),
  },
  {
    // The upsell. Tier read, not a capability check, because "should we sell Pro" IS a tier
    // question — the same read ProfileScreen's upgrade door makes. Only Free sees it:
    // Pro already bought, and an Instructor holds everything Pro has.
    id: "pro.v1",
    label: "the SwingSage Pro card",
    eligible: (ctx) => ctx.tier === "free",
    render: ({ navigation }) => (
      <FeatureSpotlight
        testID="spotlight-pro"
        icon={<ProIcon />}
        eyebrow="SwingSage Pro"
        title={PLANS.pro.pitch}
        copy="100 analyses a month, overlays, pro comparison and two-phone capture."
        cta={{ label: "See Pro", onPress: () => navigation.navigate("Upgrade") }}
      />
    ),
  },
  {
    id: "capture-240.v1",
    label: "the slow-motion capture card",
    eligible: () => true,
    render: ({ navigation }) => (
      <FeatureSpotlight
        testID="spotlight-capture-240"
        icon={<SpeedIcon />}
        eyebrow="High-speed capture"
        title="Catch it at 240 frames a second"
        copy="Record in slow motion and scrub the exact frame your club meets the ball."
        cta={{ label: "Record", onPress: () => navigation.navigate("Record") }}
      />
    ),
  },
  {
    id: "milestone.swings-50.v1",
    label: "the 50 swings milestone card",
    eligible: (ctx) => ctx.swingCount >= 50,
    render: ({ navigation }) => (
      <MilestoneSpotlight
        testID="spotlight-swings-50"
        emblem="50"
        title="Fifty swings analysed"
        line="Your trend lines mean something now — see how far you've come."
        onPress={() => navigation.navigate("Progress")}
      />
    ),
  },
  {
    id: "anniversary.1yr.v1",
    label: "the one year card",
    eligible: (ctx) => ctx.accountAgeDays >= 365,
    render: () => (
      <MilestoneSpotlight
        testID="spotlight-anniversary"
        emblem="1 yr"
        title="A year with SwingSage"
        line="Twelve months of swings, sessions and work on your game."
      />
    ),
  },
];

/* Icon wrappers keep the registry entries declarative — the template sizes its tile, the
   glyphs stay one size/stroke so the deck reads as one family. */

function DeepIcon() {
  return <Film size={22} color={ON_DARK} strokeWidth={2.1} />;
}

function StanceIcon() {
  return <ScanLine size={22} color={ON_DARK} strokeWidth={2.1} />;
}

function ProIcon() {
  return <Sparkles size={22} color={ON_DARK} strokeWidth={2.1} />;
}

function SpeedIcon() {
  return <Gauge size={22} color={ON_DARK} strokeWidth={2.1} />;
}
