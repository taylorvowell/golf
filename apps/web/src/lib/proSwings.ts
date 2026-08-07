/**
 * The reference swings shipped with the app — tour-quality model swings that live in `out/`
 * and hold real `swings` rows (they have to, to be fetchable and comparable), but belong in
 * the comparison picker rather than in the golfer's own log.
 *
 * A list rather than a single id because there is more than one reference now. `id` is the
 * `out/<id>/` folder (i.e. the source clip's stem) and `source` is the clip under
 * `instructions/swing/` that `burnin.py` has to be run over to produce it.
 *
 * Deliberately its own module rather than living in `components/ComparisonBar.tsx` alongside
 * the picker that renders it — same reason `lib/scoreDisplay.ts` is split out of
 * `lib/scoring.ts`. ComparisonBar is `"use client"`, and *every* export of a client module
 * becomes a client reference when a server component imports it: calling `proSwing()` from
 * `app/page.tsx` throws "Attempted to call proSwing() from the server", and reading a plain
 * constant is worse — it silently yields a reference object, so `s.id !== PRO_SWING_ID` was
 * quietly always true and the pro reference showed up in the golfer's log after all. This
 * file has no "use client" and no I/O, so both sides can import it.
 */
export const PRO_SWINGS = [
  { id: "perfect", label: "Pro Swing", source: "instructions/swing/perfect.mp4" },
  { id: "pro_2", label: "Pro 2", source: "instructions/swing/pro_2.mp4" },
] as const;

/** The reference selected by default when the comparison is first opened. */
export const PRO_SWING_ID = PRO_SWINGS[0].id;

/** The bundled reference with this id, or `undefined` for one of the golfer's own swings. */
export function proSwing(id: string) {
  return PRO_SWINGS.find((p) => p.id === id);
}
