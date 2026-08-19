import { Award, Medal, Trophy } from "lucide-react-native";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { CelebrationToast } from "./CelebrationToast";
import { ConfettiBurst } from "./Confetti";
import { advanceCelebration, enqueueCelebration, type Celebration } from "./celebration";
import { useDebugGroups } from "../debug/DebugOverlay";
import type { DebugGroup } from "../session/sheets/DebugSheet";

/**
 * The one mouth for toast-level celebrations, app-wide.
 *
 * Mounted in `App.tsx` between `DebugProvider` and `Root` — below the debug registry because it
 * contributes the debug sheet's "Celebrations" group, above the navigator so a celebration
 * lands on whatever screen the golfer happens to be on. Every badge / rank-up / personal-best
 * moment calls `useCelebrate()`; nothing renders its own toast. (The focus-goal celebration is
 * a bigger, separate moment owned by `goal-progression` — it outranks these, D62.)
 *
 * Queue-serialised: one toast at a time, extras wait, duplicate ids dropped (see
 * `celebration.ts`). Toast and confetti are keyed by celebration id so each moment mounts
 * fresh — no animation state survives from the previous one.
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
 * Sample moments for the debug sheet — one per kind, so the toast's three shapes (with points,
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
  const [queue, setQueue] = useState<Celebration[]>([]);

  const celebrate = useCallback((c: Celebration) => {
    setQueue((q) => enqueueCelebration(q, c));
  }, []);
  const dismiss = useCallback(() => {
    setQueue((q) => advanceCelebration(q));
  }, []);
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

  const current = queue[0];

  return (
    <CelebrationContext.Provider value={api}>
      {children}
      {current ? (
        <>
          <ConfettiBurst key={`confetti-${current.id}`} />
          <CelebrationToast key={current.id} celebration={current} onDismiss={dismiss} />
        </>
      ) : null}
    </CelebrationContext.Provider>
  );
}
