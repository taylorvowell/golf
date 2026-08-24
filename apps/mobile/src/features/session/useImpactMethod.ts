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
 * Which audio detector seeds the review mark — switchable, so the nine can be compared against
 * real footage instead of argued about.
 *
 * **There IS now ground truth, and it is five clips.** `services/analyzer/scripts/audio_truth.json`
 * holds hand-labelled strike frames for the five long takes in `fixtures/raw`, read off
 * frame-accurate strips (ball on the mat / ball gone), and `checkaudio.py --truth` scores every
 * method against them. That is what picked `swish`, and it is the first falsifiable claim this
 * subsystem has had.
 *
 * It is also one golfer, indoors, in one simulator bay, right-handed, down-the-line. It is enough
 * to REJECT a method and nowhere near enough to call one accurate — this codebase has already
 * shipped a "verified ±2 frames" claim that was 48 frames wrong, and five clips is exactly the
 * sample size that makes that mistake easy to repeat.
 *
 * `__DEV__` only — the picker is. The DEFAULT it starts from ships to everyone.
 */

/**
 * Bumped to v3 when the default became `swish`.
 *
 * A stored preference wins over the default, so without a new key every device that had ever
 * opened this menu would keep seeding with the old method and the change would look like it had
 * not landed. (v1 -> `attack`, v2 -> `hf`, v3 -> `swish`.)
 */
const STORAGE_KEY = "swingsage.impactMethod.v3";
const EDGE_KEY = "swingsage.impactEdgeWeighting.v1";

/**
 * The shipped seeder.
 *
 * `swish` keys on a high-frequency click WITH a club audibly swinging in front of it. The second
 * half is what the other eight methods were all missing: they describe the transient, so they
 * lose to a louder transient, and on a real take the louder transient is routinely a ball dropped
 * on the mat, a club tapped on the floor or a shot from the next bay.
 *
 * It replaced `hf`, which on the same clips seeded four seconds into the walk back.
 */
export const DEFAULT_IMPACT_METHOD: ImpactMethod = "swish";

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
