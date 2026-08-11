/**
 * What can be drawn over the video, as data.
 *
 * The list used to be eight hand-written checkboxes in a 300px rail. It is a table here so
 * the dropdown renders itself, and so adding an overlay is one entry rather than a checkbox
 * plus a label plus a caveat paragraph in three places.
 *
 * The canvas stack order is fixed and lives in the draw function, not here (the architecture spec):
 * `video → trace → club → raw boxes → skeleton → angles`.
 */

export type ToggleKey =
  | "skeleton" | "orient" | "stamp"
  | "club" | "trace" | "grow" | "allHeads" | "rawDet" | "crop"
  | "isolate" | "isolateClub" | "clubOnly" | "outline" | "butt";

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
  skeleton: true, orient: false, stamp: false,
  club: false, trace: true, grow: true, allHeads: false, rawDet: false, crop: false,
  isolate: false, isolateClub: false, clubOnly: false, outline: false, butt: false,
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

/**
 * Bumped by hand on every change to the player's drawing or sync path, and printed at the foot
 * of the overlay menu. Dev-server HMR can leave a stale bundle running, and "is this even the
 * new code" has to be answerable without guessing.
 */
export const BUILD_TAG = "2026-08-10 orient-9";

export const OVERLAY_GROUPS: OverlayGroup[] = [
  {
    title: "Body",
    items: [
      { key: "skeleton", label: "Stick figure" },
      {
        // Independent of the stick figure rather than replacing it — every other overlay in
        // this menu is an independent layer, and one toggle that silently switches another
        // off is the kind of control that reads as a bug. The hint says how to get the clean
        // view it was asked for.
        key: "orient", label: "Shoulder + hip lines",
        hint: "rotation at a glance - dim means the bar is holding its last trusted angle",
      },
    ],
  },
  {
    // Objective frame sync: the number in the pixels was put there by ffmpeg, so it is the one
    // reference the player did not produce. Needs scripts/stampframes.py to have been run.
    title: "Sync test",
    items: [
      {
        key: "stamp", label: "Frame stamp",
        hint: "run scripts/stampframes.py first — white number is ffmpeg's, green is ours; compare at 0.25x",
      },
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
      {
        key: "isolateClub", label: "Isolate golfer + club",
        hint: "body silhouette plus everything moving with it — needs scripts/isolate.py once",
      },
      {
        key: "clubOnly", label: "Isolate the club (subtract golfer)",
        hint: "golfer+club minus the golfer — the club by set difference",
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
      {
        key: "allHeads", label: "Every detected head (layered)",
        hint: "all frames' heads at once — the constellation the solvers work from",
      },
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
