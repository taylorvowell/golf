import { useEffect, useMemo } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { SnapCarousel } from "../../design/system";
import type { DebugGroup } from "../session/sheets/DebugSheet";
import { useDebugGroups } from "../debug/DebugOverlay";
import { useAuth } from "../auth/AuthProvider";
import { useEntitlement } from "../billing/entitlement";
import { useSessions } from "../swings/useSessions";
import { useSwings } from "../swings/useSwings";
import type { Navigation } from "../../navigation";
import { SPOTLIGHTS, spotlightKey, type SpotlightContext } from "./registry";
import { dismissKey, resetDismissals, useDismissals } from "./useDismissals";

/**
 * The Home hero's spotlight carousel — registry × eligibility × dismissals × `SnapCarousel`.
 *
 * Renders NOTHING until the dismissal mirror has loaded (a dismissed card must never flash)
 * and nothing when the deck is empty (the slot collapses; Home owes an empty carousel no
 * space). Eligibility reads only data Home already fetches — `useSwings`/`useSessions` are
 * module-cached stores Home mounts regardless, so this rail adds exactly one request to the
 * screen: the dismissals GET.
 */

/** One height for the whole deck — the carousel's geometry contract. */
export const SPOTLIGHT_CARD_HEIGHT = 172;

/**
 * The two retired device-local intro-card dismissals (`useDeepIntro`/`useStanceIntro`),
 * replayed into the server-backed store so nobody who already waved a card away sees it
 * again. Reads the legacy keys until they are gone, then never again — and removes each
 * only AFTER `dismissKey` has it (mirror + pending queue), so a killed app mid-migration
 * re-runs harmlessly.
 */
const LEGACY_KEYS: ReadonlyArray<{ storage: string; id: string }> = [
  { storage: "swingsage.deep-intro-dismissed.v1", id: "deep-intro.v1" },
  { storage: "swingsage.stance-intro-dismissed.v1", id: "stance-intro.v1" },
];

async function migrateLegacyIntroDismissals(): Promise<void> {
  for (const legacy of LEGACY_KEYS) {
    try {
      const raw = await AsyncStorage.getItem(legacy.storage);
      if (raw === null) continue;
      if (raw === "true") dismissKey(spotlightKey(legacy.id));
      await AsyncStorage.removeItem(legacy.storage);
    } catch {
      // Unreadable legacy state shows a card again — the harmless direction.
    }
  }
}

export interface SpotlightRailProps {
  navigation: Navigation;
  /** Mockup mode (Home's filler toggle): show every eligible card regardless of dismissals —
   *  and without waiting on the dismissal store, whose no-flash gate otherwise blanks the
   *  deck when the GET has not landed. Never set from product logic. */
  showDismissed?: boolean;
}

export function SpotlightRail({ navigation, showDismissed = false }: SpotlightRailProps) {
  const dismissals = useDismissals();
  const entitlement = useEntitlement();
  const { session } = useAuth();
  const { state } = useSwings();
  const { sessions } = useSessions();

  useEffect(() => {
    void migrateLegacyIntroDismissals();
  }, []);

  const debugGroups = useMemo<DebugGroup[]>(
    () => [
      {
        title: "Spotlights",
        inline: true,
        actions: [
          {
            key: "reset-dismissals",
            label: "Reset dismissals",
            detail:
              "Brings every dismissed spotlight card back — clears the server rows (dev-only DELETE), the AsyncStorage mirror, and memory.",
            onPress: () => {
              void resetDismissals();
            },
          },
        ],
      },
    ],
    [],
  );
  useDebugGroups("spotlights", debugGroups);

  const createdAt = session?.user.created_at;
  const ctx = useMemo<SpotlightContext>(() => {
    const created = createdAt ? Date.parse(createdAt) : Number.NaN;
    return {
      tier: entitlement.tier,
      can: entitlement.can,
      // The golfer's own swings — the bundled pro references are not their milestones.
      swingCount:
        state.kind === "ok" ? state.swings.filter((s) => !s.referenceLabel).length : 0,
      sessionCount: sessions.length,
      accountAgeDays: Number.isFinite(created)
        ? Math.floor((Date.now() - created) / 86_400_000)
        : 0,
      triggers: new Set<string>(),
    };
  }, [entitlement, createdAt, state, sessions]);

  // After every hook: the no-flash gate, then the empty-deck collapse.
  if (!showDismissed && dismissals.kind !== "ready") return null;

  const dismissed = dismissals.kind === "ready" ? dismissals.keys : new Set<string>();
  const deck = SPOTLIGHTS.filter(
    (def) => (showDismissed || !dismissed.has(spotlightKey(def.id))) && def.eligible(ctx),
  );
  if (deck.length === 0) return null;

  const byKey = new Map(deck.map((def) => [spotlightKey(def.id), def]));

  return (
    <SnapCarousel
      testID="home-spotlights"
      items={deck.map((def) => ({
        key: spotlightKey(def.id),
        render: (width) => def.render({ width, navigation }),
      }))}
      cardHeight={SPOTLIGHT_CARD_HEIGHT}
      onDismiss={dismissKey}
      dismissLabel={(key) => `Dismiss ${byKey.get(key)?.label ?? "this card"}`}
    />
  );
}
