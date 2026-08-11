/**
 * The reference swings shipped with the app — tour-quality model swings that hold real `swings`
 * rows (they have to, to be fetchable and comparable) but belong in the comparison picker rather
 * than in the golfer's own log.
 *
 * **This is a catalogue keyed by STORAGE KEY, not a list of ids.** Until migration 0006 a swing's
 * id was its `out/<stem>/` folder name, so "is this a reference?" could be answered by matching
 * the id against a hardcoded list. Ids are uuids now, and the answer lives where it always
 * belonged: `swings.reference_label`, a column. `db/backfill.ts` reads this catalogue to set it,
 * and everything else asks the row.
 *
 * `key` is the `out/<key>/` folder (the source clip's stem) and `source` is the clip under
 * `fixtures/` that `burnin.py` has to be run over to produce it.
 *
 * Deliberately its own module rather than living in `components/ComparisonBar.tsx` alongside
 * the picker that renders it — same reason `lib/scoreDisplay.ts` is split out of
 * `lib/scoring.ts`. ComparisonBar is `"use client"`, and *every* export of a client module
 * becomes a client reference when a server component imports it. This file has no "use client"
 * and no I/O, so both sides can import it.
 */
export const PRO_SWINGS = [
  { key: "perfect", label: "Pro Swing", source: "fixtures/perfect.mp4" },
  { key: "pro_2", label: "Pro 2", source: "fixtures/pro_2.mp4" },
] as const;

/**
 * A reference swing resolved against the database: a real swing id, and the name to show for it.
 *
 * Resolved server-side and passed down as a prop, because a client component cannot look up
 * which row carries which label — and hardcoding ids on the client is exactly the coupling
 * migration 0006 removed.
 */
export interface ReferenceSwing {
  id: string;
  label: string;
}

/** The catalogue entry for a storage key, or `undefined` for a golfer's own clip. */
export function proSwingByKey(key: string) {
  return PRO_SWINGS.find((p) => p.key === key);
}
