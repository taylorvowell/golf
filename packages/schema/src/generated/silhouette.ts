/* GENERATED from schemas/silhouette.schema.json - do not edit.
 * Run: pnpm --filter @swingsage/schema generate */

/**
 * @minItems 2
 *
 * This interface was referenced by `Silhouette`'s JSON-Schema
 * via the `definition` "point".
 */
export type SilhouettePoint = [number, number];

/**
 * The golfer's outline per frame — its own artifact rather than part of `analysis.json` because it is large (0.3–1.1 MB) and only wanted when its overlay is on. Fetched lazily; never part of a first load.
 *
 * `p` is a list of closed rings with NO outer/hole distinction, deliberately: filling them all under an even-odd rule puts the holes back by itself (the gap between the arms at the top of the backswing is a hole), so no consumer has to classify them.
 *
 * The same shape carries the isolation and club-only masks, which differ only in what was segmented.
 */
export interface Silhouette {
  schema: number;
  source: string;
  model: string;
  /**
   * Douglas–Peucker tolerance the rings were simplified at, in pixels.
   */
  eps: number;
  width: number;
  height: number;
  frame_count: number;
  coverage: number;
  notes: string[];
  frames: SilhouetteFrame[];
}
/**
 * This interface was referenced by `Silhouette`'s JSON-Schema
 * via the `definition` "silhouetteFrame".
 */
export interface SilhouetteFrame {
  f: number;
  /**
   * Closed rings, each a list of normalized [x, y] points.
   */
  p: SilhouettePoint[][];
}
