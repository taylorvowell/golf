import { useCallback, useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  IMPACT_METHODS,
  IMPACT_METHOD_LABELS,
  type ImpactMethod,
} from "../../../modules/high-speed-camera/src";
import { useDebugGroups } from "../debug/DebugOverlay";
import type { DebugGroup } from "./sheets/DebugSheet";

/**
 * Which audio detector seeds the review mark — switchable, so the four can be compared against
 * real footage instead of argued about.
 *
 * **There is no ground truth for impact time in this project.** No clip is hand-labelled, so
 * nothing here can produce an accuracy number, and whichever method ends up preferred is
 * preferred because a person watched the seed land on 29 clips. That is a judgement and must be
 * written down as one — this codebase has already shipped a "verified ±2 frames" claim that was
 * 48 frames wrong, and a switchable detector makes that mistake easier to make, not harder.
 *
 * `__DEV__` only — the picker is. The DEFAULT it starts from ships to everyone.
 */

/**
 * Bumped to v2 when the default became `hf`.
 *
 * A stored preference wins over the default, so without a new key every device that had ever
 * opened this menu would keep seeding with `attack` and the change would look like it had not
 * landed.
 */
const STORAGE_KEY = "swingsage.impactMethod.v2";
const EDGE_KEY = "swingsage.impactEdgeWeighting.v1";

/**
 * The shipped seeder (Taylor, 2026-08-22).
 *
 * `hf` keys on the high-frequency CLICK of a strike rather than its loudness, which is the
 * property that actually separates a golf shot from the other loud events at a range. Chosen on
 * judgement watching real clips — there are still no labelled strike frames in this project, so
 * this is a preference and must never be recorded as an accuracy figure.
 */
export const DEFAULT_IMPACT_METHOD: ImpactMethod = "hf";

function isMethod(v: unknown): v is ImpactMethod {
  return typeof v === "string" && (IMPACT_METHODS as string[]).includes(v);
}

export interface ImpactSeeding {
  method: ImpactMethod;
  /** Whether the first/last five seconds are down-weighted. */
  edgeWeighting: boolean;
}

export function useImpactMethod(): ImpactSeeding {
  const [method, setMethod] = useState<ImpactMethod>(DEFAULT_IMPACT_METHOD);
  const [edgeWeighting, setEdgeWeighting] = useState(true);

  useEffect(() => {
    if (!__DEV__) return;
    void AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (isMethod(raw)) setMethod(raw);
      })
      .catch(() => {});
    void AsyncStorage.getItem(EDGE_KEY)
      .then((raw) => {
        if (raw != null) setEdgeWeighting(raw === "1");
      })
      .catch(() => {});
  }, []);

  const choose = useCallback((next: ImpactMethod) => {
    setMethod(next);
    void AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
  }, []);

  const chooseEdge = useCallback((next: boolean) => {
    setEdgeWeighting(next);
    void AsyncStorage.setItem(EDGE_KEY, next ? "1" : "0").catch(() => {});
  }, []);

  const groups = useMemo<DebugGroup[]>(() => {
    if (!__DEV__) return [];
    return [
      {
        title: `Impact detection — ${method}`,
        inline: true,
        actions: IMPACT_METHODS.map((candidate) => ({
          key: `impact-${candidate}`,
          // The chip is the short name; the full description lives in the code, where the
          // person choosing can read what the method actually measures.
          label: candidate === method ? `● ${candidate}` : candidate,
          detail: IMPACT_METHOD_LABELS[candidate],
          onPress: () => choose(candidate),
        })),
        toggles: [
          {
            key: "impact-edge-weighting",
            label: "Ignore first/last 5s",
            detail:
              "Down-weights both ends, where the walk out and the walk back live. A prior, " +
              "not a filter — an edge strike still wins if nothing else comes close.",
            value: edgeWeighting,
            onChange: chooseEdge,
          },
        ],
      },
    ];
  }, [choose, chooseEdge, edgeWeighting, method]);

  useDebugGroups("session-impact-method", groups);

  return useMemo(() => ({ method, edgeWeighting }), [method, edgeWeighting]);
}
