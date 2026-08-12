import { COLORS } from "../../theme";

/**
 * **Deck** — SwingSage's tactile control surface.
 *
 * One idea, stated once here and obeyed by every component in this folder: **the light comes from
 * directly above.** Everything else follows from it and nothing is chosen by eye. A control that
 * stands proud of the surface catches that light on its top edge and casts a shadow below itself; a
 * control that has been pushed in does the exact opposite — dark at the top where the rim now
 * overhangs it, light at the bottom where the floor catches the light. Get the direction wrong on
 * one component and the whole surface stops reading as a physical object, which is the only thing
 * this system is for.
 *
 * ## Why a control surface and not a flat UI
 *
 * §41's stated conditions are bright sunlight, one hand, and a driving range. Flat design fails all
 * three at once: in glare a filled rectangle and its background converge, and there is no shape cue
 * left to tell a control from a label. A raised cap keeps a highlight and a shadow no matter what
 * the ambient light does to its fill, and **depth survives washout where colour does not**. It also
 * gives state somewhere to live that is not colour — a pressed transport reads as pressed at a
 * glance and from an angle, which is how a golfer actually looks at a phone on a mat.
 *
 * ## Scope, deliberately
 *
 * This is a **control-surface** system: surfaces, caps, and the depths between them. It is not the
 * app's design system — type scale, spacing rhythm, iconography and the §41 contrast bar belong to
 * `mobile-app-shell` step 03, and `theme.ts` says so. Deck layers on `theme.ts`'s tokens rather
 * than restating them, so when that step lands it absorbs this folder instead of colliding with it.
 */

/**
 * The three depths a thing can sit at. There is no fourth, on purpose — a surface with five
 * plausible elevations stops communicating any of them.
 */
export type DeckDepth = "raised" | "flush" | "recessed";

export const DECK = {
  /**
   * How far a cap sinks. Small, because a real button's travel is small, and because anything
   * larger reads as the layout moving rather than the control being pressed.
   */
  travel: 2,

  /**
   * The ground the player floats on, and the accent everything active is lit with.
   *
   * Both are a hair greener than `theme.ts`'s app palette (`#080a0d` / `#a3e635`), and that is
   * deliberate rather than drift: the player is the one screen that is *entirely* a control
   * surface, sitting over grass, and the warmer accent survives being read next to it. The two
   * palettes are close enough to sit in one app and far enough that the player reads as its own
   * place. `mobile-app-shell` step 03 decides which of the two the rest of the app takes.
   */
  ground: "#050706",
  accent: "#b8ff4a",

  radius: {
    /** The console slab itself. */
    slab: 26,
    /** The floating dock — rounder than the slab, because it has an edge all the way round. */
    dock: 28,
    /** A rectangular cap — a step key, a speed segment. */
    tile: 13,
    /** A floating chip or a sheet's shoulder. */
    chip: 17,
    /** Fully round. The transport button. */
    cap: 999,
  },

  /**
   * Translucent surfaces that sit **over the picture** rather than on the slab.
   *
   * No `backdrop-filter`, and no `expo-blur`: real blur is a native module, which costs a fresh
   * dev-client install on the device every time this design moves. Two stacked translucent fills
   * plus a lit hairline read as glass at this size, and the difference is only visible against
   * fine detail — which the picture behind these controls, being sky and grass, does not have.
   */
  glass: {
    /** A floating control over the video — the back cap, the overlays chip. */
    soft: "rgba(13,18,14,0.72)",
    /** The dock. Denser, because the transport must never be ambiguous against a bright frame. */
    dock: "rgba(17,22,18,0.86)",
    /** A sheet. Denser still — it is a page, not a control. */
    sheet: "rgba(10,14,11,0.97)",
    /** A recessed group inside glass — the speed segment's well. */
    well: "rgba(0,0,0,0.25)",
    /** The lit top edge every glass surface carries. */
    hairline: "rgba(255,255,255,0.10)",
    /** A flat, unlit control on glass — the frame stepper's keys. */
    key: "rgba(255,255,255,0.045)",
    keyEdge: "rgba(255,255,255,0.09)",
  },

  /** Faces, lit from above: the top of a raised cap is lighter than its bottom. */
  face: {
    raisedTop: "#232b35",
    raisedBottom: "#151b23",
    /** A cap that is IN — its face is darker overall, as a real recess is. */
    sunkTop: "#0e131a",
    sunkBottom: "#161d26",
    /** The primary transport cap. Warmer, so the one control you press blind is findable. */
    primaryTop: "#c5ff58",
    primaryBottom: "#9fe135",
    primarySunkTop: "#7fb524",
    primarySunkBottom: "#b6f04c",
  },

  /** The slab a set of caps is mounted on. Marginally above the page, never floating. */
  slab: {
    background: "#0d1117",
    hairline: "rgba(255,255,255,0.07)",
    edge: "rgba(0,0,0,0.55)",
  },

  /**
   * Shadow recipes, as `boxShadow` arrays.
   *
   * `inset` and multi-shadow arrays are RN 0.86 (new architecture) features. They are what make
   * this possible without a gradient library, a canvas, or nine-patch images — an earlier
   * React Native would have needed all three.
   */
  shadow: {
    /** Proud of the surface: a cast shadow below, a lit top rim, a dark underside inside the cap. */
    raised: [
      { offsetX: 0, offsetY: 3, blurRadius: 6, spreadDistance: 0, color: "rgba(0,0,0,0.55)" },
      { offsetX: 0, offsetY: 1, blurRadius: 0, spreadDistance: 0, color: "rgba(255,255,255,0.16)", inset: true },
      { offsetX: 0, offsetY: -2, blurRadius: 3, spreadDistance: 0, color: "rgba(0,0,0,0.45)", inset: true },
    ],
    /** Mid-press. Same shape as raised, with the cast shadow nearly gone. */
    pressing: [
      { offsetX: 0, offsetY: 1, blurRadius: 2, spreadDistance: 0, color: "rgba(0,0,0,0.5)" },
      { offsetX: 0, offsetY: 1, blurRadius: 0, spreadDistance: 0, color: "rgba(255,255,255,0.1)", inset: true },
    ],
    /** Pushed in and staying in. Dark at the top where the rim overhangs; light at the floor. */
    sunk: [
      { offsetX: 0, offsetY: 3, blurRadius: 5, spreadDistance: 0, color: "rgba(0,0,0,0.75)", inset: true },
      { offsetX: 0, offsetY: -2, blurRadius: 3, spreadDistance: 0, color: "rgba(255,255,255,0.09)", inset: true },
    ],
    /** The console slab, at the bottom of the screen, so its shadow is thrown UPWARD. */
    slab: [
      { offsetX: 0, offsetY: -10, blurRadius: 24, spreadDistance: -6, color: "rgba(0,0,0,0.7)" },
      { offsetX: 0, offsetY: 1, blurRadius: 0, spreadDistance: 0, color: "rgba(255,255,255,0.06)", inset: true },
    ],
    /** A surface floating clear of the page — the dock, a sheet. Shadow on every side. */
    float: [
      { offsetX: 0, offsetY: 8, blurRadius: 28, spreadDistance: -4, color: "rgba(0,0,0,0.8)" },
      { offsetX: 0, offsetY: 1, blurRadius: 0, spreadDistance: 0, color: "rgba(255,255,255,0.08)", inset: true },
    ],
  },

  label: {
    /** On a dark cap. */
    onFace: COLORS.text,
    /** On the primary cap — `theme.ts` carries the palette's one inverted pairing. */
    onPrimary: COLORS.onAcid,
    /** A cap that is engaged but not primary: lit, so "on" reads without a colour fill. */
    engaged: "#b8ff4a",
    dim: COLORS.dim,
    /** A caption under a glyph on glass. Small, so it needs the contrast. */
    caption: "rgba(255,255,255,0.55)",
    /** A number that is context rather than content — a timecode. */
    quiet: "rgba(255,255,255,0.38)",
  },

  /**
   * Minimum touch target, and it is not the cap's drawn size.
   *
   * §41 again: a 34pt speed segment is the right *drawing* and the wrong *target*, so every cap
   * carries hit slop out to this. Growing the drawing instead would turn the console into a wall
   * of keys and lose the shape hierarchy that makes the transport findable without looking.
   */
  touchTarget: 48,
} as const;
