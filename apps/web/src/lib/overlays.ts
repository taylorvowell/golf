/**
 * What can be drawn over the video, as data.
 *
 * The list used to be eight hand-written checkboxes in a 300px rail. It is a table here so
 * the dropdown renders itself, and so adding an overlay is one entry rather than a checkbox
 * plus a label plus a caveat paragraph in three places.
 *
 * The canvas stack order is fixed and lives in the draw function, not here (doc 02):
 * `video → trace → club → raw boxes → skeleton → angles`.
 */

export type ToggleKey =
  | "skeleton"
  | "club" | "trace" | "grow" | "rawDet" | "crop"
  | "isolate" | "outline" | "butt";

export type Toggles = Record<ToggleKey, boolean>;

/**
 * Defaults.
 *
 * Exactly three overlays ship ON: the stick figure, the club head trace, and the trace
 * following the frame as it grows. That trio is the single most compelling image the
 * pipeline can produce and what a first-time user should see with no menu digging.
 * Everything else — the raw shaft/head line, crop-to-golfer, etc. — starts OFF so the
 * first render is uncluttered; a viewer can layer them back in.
 */
export const DEFAULT_TOGGLES: Toggles = {
  skeleton: true,
  club: false, trace: true, grow: true, rawDet: false, crop: false,
  isolate: false, outline: false, butt: false,
};

/**
 * Every overlay off — what the menu's "clear all" applies.
 *
 * Derived from `DEFAULT_TOGGLES` rather than written out again, so adding an overlay cannot
 * leave one stuck on with no way to clear it. Frozen because it is a shared module constant
 * being handed straight to a state setter; mutating it would corrupt every later reset.
 */
export const CLEARED_TOGGLES: Toggles = Object.freeze(
  Object.fromEntries(Object.keys(DEFAULT_TOGGLES).map((k) => [k, false])),
) as Toggles;

export interface OverlayItem {
  key: ToggleKey;
  label: string;
  /** One line under the label. Kept short — the long caveats live in the Advanced tab. */
  hint?: string;
}

export type Capability = "club" | "detector" | "crop" | "silhouette" | "posture";

export interface OverlayGroup {
  title: string;
  items: OverlayItem[];
  /** Names the capability the whole group needs; the group is hidden when it is absent. */
  needs?: Capability;
}

export const OVERLAY_GROUPS: OverlayGroup[] = [
  {
    title: "Body",
    items: [
      { key: "skeleton", label: "Stick figure" },
    ],
  },
  {
    // Stage 2b. Both read `silhouette.json`, which is fetched only once one of them goes on,
    // so this group is also the one place in the menu where a toggle can take a moment.
    title: "Silhouette",
    needs: "silhouette",
    items: [
      {
        key: "isolate", label: "Isolate the golfer",
        hint: "knocks the background back to the outline",
      },
      { key: "outline", label: "Draw the outline" },
    ],
  },
  {
    // Separate from the group above because it needs a different thing: the line is a handful
    // of numbers in analysis.json and draws with no fetch at all, so it stays available on a
    // swing whose per-frame outline was never stored.
    title: "Setup reference",
    needs: "posture",
    items: [
      {
        key: "butt", label: "Butt position",
        hint: "locked at address — the seat should stay against it",
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
  {
    title: "Detector",
    needs: "detector",
    items: [
      {
        key: "rawDet", label: "Model output only (raw)",
        hint: "every box the detector returned — no solver, no gate",
      },
    ],
  },
  {
    title: "Framing",
    needs: "crop",
    items: [
      { key: "crop", label: "Fit to golfer", hint: "a CSS crop; the video and pose are untouched" },
    ],
  },
];
