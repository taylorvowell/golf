/**
 * What can be drawn over the video, as data.
 *
 * The list used to be eight hand-written checkboxes in a 300px rail. It is a table here so
 * the dropdown renders itself, and so adding an overlay is one entry rather than a checkbox
 * plus a label plus a caveat paragraph in three places.
 *
 * The canvas stack order is fixed and lives in the draw function, not here (doc 02):
 * `video → ghost → trace → club → raw boxes → skeleton → grip → angles`.
 */

export type ToggleKey =
  | "skeleton" | "confStyle" | "hideLow" | "ghost" | "grip"
  | "club" | "trace" | "grow" | "rawDet" | "crop";

export type Toggles = Record<ToggleKey, boolean>;

/**
 * Defaults.
 *
 * `club` and `trace` ship ON, reversing the old default. The club trace is the single most
 * compelling image the pipeline can produce and a first-time user never saw it — the UI
 * brief calls the old default "almost certainly wrong" (§4) and asks for exactly this as its
 * top deliverable (§10.1). Everything else keeps its previous default.
 */
export const DEFAULT_TOGGLES: Toggles = {
  skeleton: true, confStyle: true, hideLow: false, ghost: false, grip: false,
  club: true, trace: true, grow: true, rawDet: false, crop: true,
};

export interface OverlayItem {
  key: ToggleKey;
  label: string;
  /** One line under the label. Kept short — the long caveats live in the Advanced tab. */
  hint?: string;
}

export interface OverlayGroup {
  title: string;
  items: OverlayItem[];
  /** Names the capability the whole group needs; the group is hidden when it is absent. */
  needs?: "club" | "detector" | "crop";
}

export const OVERLAY_GROUPS: OverlayGroup[] = [
  {
    title: "Body",
    items: [
      { key: "skeleton", label: "Stick figure" },
      { key: "confStyle", label: "Confidence styling", hint: "below 0.5 goes dashed and hollow" },
      { key: "hideLow", label: "Hide joints below 0.5" },
      { key: "ghost", label: "Ghost address pose", hint: "the setup skeleton, held at 22%" },
      { key: "grip", label: "Mark grip centre" },
    ],
  },
  {
    title: "Club",
    needs: "club",
    items: [
      { key: "club", label: "Club shaft + head" },
      { key: "trace", label: "Club head trace" },
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
