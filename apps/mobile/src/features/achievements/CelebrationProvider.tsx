import { Award, Medal, Trophy } from "lucide-react-native";
import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";

import { celebrationToast, type Celebration } from "./celebration";
import { useDebugGroups } from "../debug/DebugOverlay";
import { useToast } from "../toast/ToastProvider";
import type { DebugGroup } from "../session/sheets/DebugSheet";

/**
 * The achievements layer's mouth: `useCelebrate()` translates a celebration into the app-wide
 * toaster's voice (confetti, kind eyebrow, XP chip — see `celebration.ts`) and hands it to
 * `useToast()`. Renders nothing itself — the `toast` feature owns the surface, this provider
 * owns what a CELEBRATION means, plus the debug-sheet triggers.
 *
 * Mounted in `App.tsx` inside both `DebugProvider` (it contributes the Celebrations group)
 * and `ToastProvider` (it speaks through it). The focus-goal celebration stays a bigger,
 * separate moment owned by `goal-progression` — it outranks these (D62).
 */

interface CelebrationApi {
  celebrate: (c: Celebration) => void;
}

const CelebrationContext = createContext<CelebrationApi | null>(null);

export function useCelebrate(): (c: Celebration) => void {
  const api = useContext(CelebrationContext);
  if (!api) throw new Error("useCelebrate needs a CelebrationProvider above it");
  return api.celebrate;
}

/**
 * Sample moments for the debug sheet — one per kind, so the toast's three shapes (with chip,
 * without, long detail) are all reachable on demand. Stable ids on purpose: pressing RUN twice
 * while one is on screen exercises the dedupe path rather than stacking twins.
 */
const SAMPLE_BADGE: Celebration = {
  id: "debug-badge",
  kind: "badge",
  title: "First Session in the Books",
  detail: "You completed your first practice session.",
  icon: Award,
  points: 50,
};
const SAMPLE_RANK: Celebration = {
  id: "debug-rank",
  kind: "rank",
  title: "Ball Striker",
  detail: "Rank 3 of 8 — keep stacking sessions.",
  icon: Medal,
};
const SAMPLE_RECORD: Celebration = {
  id: "debug-record",
  kind: "record",
  title: "New Personal Best",
  detail: "Swing score 84 — your highest yet.",
  icon: Trophy,
  points: 25,
};

export function CelebrationProvider({ children }: { children: ReactNode }) {
  const showToast = useToast();

  const celebrate = useCallback(
    (c: Celebration) => showToast(celebrationToast(c)),
    [showToast],
  );
  const api = useMemo<CelebrationApi>(() => ({ celebrate }), [celebrate]);

  const debugGroups = useMemo<DebugGroup[]>(
    () => [
      {
        title: "Celebrations",
        inline: true,
        actions: [
          { key: "celebrate-badge", label: "Badge", onPress: () => celebrate(SAMPLE_BADGE) },
          { key: "celebrate-rank", label: "Rank-up", onPress: () => celebrate(SAMPLE_RANK) },
          { key: "celebrate-record", label: "Best", onPress: () => celebrate(SAMPLE_RECORD) },
          {
            key: "celebrate-queue",
            /* All three back to back — proves the one-at-a-time queue. */
            label: "Queue ×3",
            onPress: () => {
              celebrate(SAMPLE_BADGE);
              celebrate(SAMPLE_RANK);
              celebrate(SAMPLE_RECORD);
            },
          },
        ],
      },
    ],
    [celebrate],
  );
  useDebugGroups("celebrations", debugGroups);

  return <CelebrationContext.Provider value={api}>{children}</CelebrationContext.Provider>;
}
