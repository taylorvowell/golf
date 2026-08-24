import type { AngleField, Analysis } from "@swingsage/schema/contract";

/**
 * What can be drawn over the video on a phone, as data.
 *
 * The table is ported from `apps/web/src/lib/overlays.ts`; the menu *renderer* is not, because a
 * dropdown in a 300px rail is not a phone control. Keeping it as data is what makes adding an
 * overlay one entry rather than a checkbox plus a label plus a caveat in three places.
 *
 * **The mobile set is deliberately smaller than the web set.** The silhouette, isolation and butt
 * line are out of this step: the scrim depends on `Path2D` + even-odd fill to put its holes back,
 * which plain `View`s cannot express — the analyzer stores rings with no outer/hole distinction
 * precisely because even-odd handles it. The debug layers (raw detector boxes, every detected head,
 * the ffmpeg frame stamp) are desk tools, not phone ones. Naming them as absent is the point; they
 * are not gaps to be discovered later.
 */

export type ToggleKey = "skeleton" | "orient" | "club" | "trace" | "grow";

export type Toggles = Record<ToggleKey, boolean>;

/**
 * Defaults: the stick figure, and nothing else.
 *
 * The club-head trace is OFF until it is reliable (Taylor, 2026-08-22). It is the most
 * compelling image the pipeline can produce and it is also the one most likely to be wrong, and
 * a drawn line that misses the ball reads as the whole analysis being wrong — the opposite of
 * what a default is for. The Overlays sheet still offers it; `grow` stays on so that whenever
 * trace is turned back on it behaves as before.
 */
export const DEFAULT_TOGGLES: Toggles = {
  skeleton: true,
  orient: false,
  club: false,
  trace: false,
  grow: true,
};

/** Every overlay off. Derived, so adding one cannot leave it stuck on with no way to clear it. */
export const CLEARED_TOGGLES: Toggles = Object.freeze(
  Object.fromEntries(Object.keys(DEFAULT_TOGGLES).map((k) => [k, false])),
) as Toggles;

export type Capability = "club" | "angles";

export interface OverlayItem {
  key: ToggleKey;
  label: string;
  /** One line under the label. Kept short. */
  hint?: string;
}

export interface OverlayGroup {
  title: string;
  items: OverlayItem[];
  /** The capability the whole group needs. The group is HIDDEN when the artifact lacks it. */
  needs?: Capability;
}

export const OVERLAY_GROUPS: OverlayGroup[] = [
  {
    title: "Body",
    items: [
      { key: "skeleton", label: "Stick figure" },
      {
        key: "orient",
        label: "Shoulder + hip lines",
        hint: "rotation at a glance — dim means the bar is holding its last trusted angle",
      },
    ],
  },
  {
    title: "Club",
    needs: "club",
    items: [
      { key: "club", label: "Club shaft + head" },
      { key: "trace", label: "Club head trace", hint: "dashed where the club was not measured" },
      { key: "grow", label: "Trace follows the frame", hint: "draws up to the playhead as you scrub" },
    ],
  },
];

/**
 * Whether this artifact can support a group at all.
 *
 * Hidden, never disabled: a control a golfer cannot use and cannot fix is indistinguishable from a
 * broken one. A native client cannot be force-updated, so an artifact older than the build is
 * permanent reality here in a way it never was on web — every block below is genuinely optional.
 */
export function hasCapability(a: Analysis | null, cap: Capability): boolean {
  if (!a) return false;
  if (cap === "club") return !!a.club?.frames?.length;
  return !!a.metrics?.angle_fields?.some((f) => f.geom);
}

/** The groups this artifact can actually render. */
export function availableGroups(a: Analysis | null): OverlayGroup[] {
  return OVERLAY_GROUPS.filter((g) => !g.needs || hasCapability(a, g.needs));
}

/**
 * The angles this swing can be asked to draw.
 *
 * Two filters, both from the artifact rather than from a hardcoded list. `geom: null` marks a field
 * with no drawable geometry — the width-derived rotation estimates — and a field whose `view` is
 * not this clip's is *computed but misleading here*, because every 2D joint angle is
 * projection-sensitive. Offering one would be presenting a number that does not mean what its name
 * says.
 */
export function drawableAngles(a: Analysis | null): AngleField[] {
  const fields = a?.metrics?.angle_fields;
  if (!fields || !a) return [];
  const view = a.video.view;
  return fields.filter((f) => f.geom && (f.view === "both" || f.view === view));
}
