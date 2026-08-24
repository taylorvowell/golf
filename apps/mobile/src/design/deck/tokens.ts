import { AQUA, COLORS } from "../../theme";
import { DECK_SHADES } from "../../theme/palette";

/**
 * **Deck** — SwingSage's tactile control surface.
 *
 * One idea, stated once here and obeyed by every component in this folder: **the light comes from
 * directly above.** Everything else follows from it and nothing is chosen by eye. A control that
 * stands proud of the surface catches that light on its top edge and is dark on its underside; a
 * control that has been pushed in does the exact opposite — dark at the top where the rim now
 * overhangs it, light at the bottom where the floor catches the light. Get the direction wrong on
 * one component and the whole surface stops reading as a physical object, which is the only thing
 * this system is for.
 *
 * ## Why a control surface and not a flat UI
 *
 * §41's stated conditions are bright sunlight, one hand, and a driving range. Flat design fails all
 * three at once: in glare a filled rectangle and its background converge, and there is no shape cue
 * left to tell a control from a label. A raised cap keeps a highlight and a dark underside whatever
 * the ambient light does to its fill, and **depth survives washout where colour does not**. It also
 * gives state somewhere to live that is not colour — a pressed transport reads as pressed at a
 * glance and from an angle, which is how a golfer actually looks at a phone on a mat.
 *
 * ## Scope, deliberately
 *
 * This is a **control-surface** system: surfaces, caps, and the depths between them. It is not the
 * app's design system — type scale, spacing rhythm, iconography and the §41 contrast bar belong to
 * `mobile-app-shell` step 03. Deck layers on `src/theme`'s fixed dark `COLORS` (the player is
 * pinned dark in both app themes) rather than restating them, so when that step lands it absorbs
 * this folder instead of colliding with it.
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
   * Re-tokened onto the Ideal Swing palette in design-system step 09 (one colour source):
   * the ground is the dark theme's own near-black navy, and the accent is aqua — §12's
   * action/motion voice — one stop lighter than the fill accent so it stays legible as a
   * *light* on small engaged glyphs.
   */
  ground: COLORS.bg,
  accent: AQUA[400],

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
   * dev-client install on the device every time this design moves. Translucent fills alone read
   * as glass at this size — surfaces are flat by decree (no borders, no drawn edges; depth comes
   * from fill and INSET shading only — nothing here casts), so there are no edge/hairline tokens
 * here, and none may be added.
   */
  glass: {
    /** A floating control over the video — the back cap, the overlays chip. */
    soft: "rgba(7,19,31,0.72)",
    /** The dock. Denser, because the transport must never be ambiguous against a bright frame. */
    dock: "rgba(10,26,41,0.86)",
    /** A sheet. Denser still — it is a page, not a control. */
    sheet: "rgba(5,15,25,0.97)",
    /** A recessed group inside glass — the speed segment's well. */
    well: "rgba(0,0,0,0.25)",
    /** A flat, unlit control on glass — the frame stepper's keys. */
    key: "rgba(255,255,255,0.045)",
  },

  /** Faces, lit from above: the top of a raised cap is lighter than its bottom. */
  face: {
    raisedTop: DECK_SHADES.raisedTop,
    raisedBottom: DECK_SHADES.raisedBottom,
    /** A cap that is IN — its face is darker overall, as a real recess is. */
    sunkTop: DECK_SHADES.sunkTop,
    sunkBottom: DECK_SHADES.sunkBottom,
    /** The primary transport cap — the aqua ramp, lit top over fill, darkened when pushed in. */
    primaryTop: AQUA[300],
    primaryBottom: AQUA[500],
    primarySunkTop: AQUA[600],
    primarySunkBottom: AQUA[400],
  },

  /**
   * Shading recipes, as `boxShadow` arrays — **inset only**.
   *
   * No drop shadows anywhere in this product (Taylor, 2026-08-18), so nothing here casts onto
   * the surface below it. Depth is carried entirely by shading INSIDE the cap: a lit top rim
   * and a dark underside when it stands proud, inverted when it is pushed in. That is still the
   * one rule — light from directly above — and it survives the cast shadow going, because a
   * rim highlight is what the eye reads at a glance in glare anyway.
   *
   * `inset` and multi-shadow arrays are RN 0.86 (new architecture) features. They are what make
   * this possible without a gradient library, a canvas, or nine-patch images — an earlier
   * React Native would have needed all three.
   */
  shadow: {
    /** Proud of the surface: a lit top rim and a dark underside, both inside the cap. */
    raised: [
      { offsetX: 0, offsetY: 1, blurRadius: 0, spreadDistance: 0, color: "rgba(255,255,255,0.16)", inset: true },
      { offsetX: 0, offsetY: -2, blurRadius: 3, spreadDistance: 0, color: "rgba(0,0,0,0.45)", inset: true },
    ],
    /** Mid-press. Same shape as raised, with the rim highlight dimmed. */
    pressing: [
      { offsetX: 0, offsetY: 1, blurRadius: 0, spreadDistance: 0, color: "rgba(255,255,255,0.1)", inset: true },
    ],
    /** Pushed in and staying in. Dark at the top where the rim overhangs; light at the floor. */
    sunk: [
      { offsetX: 0, offsetY: 3, blurRadius: 5, spreadDistance: 0, color: "rgba(0,0,0,0.75)", inset: true },
      { offsetX: 0, offsetY: -2, blurRadius: 3, spreadDistance: 0, color: "rgba(255,255,255,0.09)", inset: true },
    ],
    /** The console slab. Its top edge catches the light; it throws nothing onto the picture. */
    slab: [
      { offsetX: 0, offsetY: 1, blurRadius: 0, spreadDistance: 0, color: "rgba(255,255,255,0.06)", inset: true },
    ],
    /** A surface floating clear of the page — the dock, a sheet. Lit rim, no cast. */
    float: [
      { offsetX: 0, offsetY: 1, blurRadius: 0, spreadDistance: 0, color: "rgba(255,255,255,0.08)", inset: true },
    ],
  },

  label: {
    /** On a dark cap. */
    onFace: COLORS.text,
    /** On the primary cap — `theme.ts` carries the palette's one inverted pairing. */
    onPrimary: COLORS.onAqua,
    /** A cap that is engaged but not primary: lit, so "on" reads without a colour fill. */
    engaged: AQUA[400],
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
