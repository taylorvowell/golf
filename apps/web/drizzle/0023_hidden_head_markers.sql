-- 0023 — a head marker can now say "a human looked, and the club head is NOT visible here".
--
-- Until now the marker editor could only assert positions. But "the head is hidden behind the
-- golfer on this frame" is truth too — for the ground-truth evaluators it is what the
-- false-positive metric keys on (a solver confidently placing a head a human cannot see is
-- hallucinating), and in the editor it is the only honest answer for an occluded frame.
--
-- A hidden marker has no position, so x/y become nullable with a CHECK that ties the two shapes
-- together: hidden rows carry NULL coordinates, visible rows carry both. The fps/revision
-- provenance (C10) applies to hidden rows exactly as to placed ones — "not visible on frame N"
-- is just as clock-dependent as "at (x,y) on frame N".

-- `blurred` is the third honest state: a position that IS provided but is the midpoint of a
-- motion streak rather than a sharp head — low-fps clips are mostly streaks near impact, and
-- pretending a streak-midpoint is pixel truth would poison the position-error metrics. A
-- blurred marker still carries coordinates; hidden and blurred are mutually exclusive.

ALTER TABLE "head_markers" ADD COLUMN "hidden" boolean NOT NULL DEFAULT false;
ALTER TABLE "head_markers" ADD COLUMN "blurred" boolean NOT NULL DEFAULT false;
ALTER TABLE "head_markers" ALTER COLUMN "x" DROP NOT NULL;
ALTER TABLE "head_markers" ALTER COLUMN "y" DROP NOT NULL;
ALTER TABLE "head_markers" ADD CONSTRAINT "head_markers_hidden_xy" CHECK (
  ("hidden" AND NOT "blurred" AND "x" IS NULL AND "y" IS NULL)
  OR (NOT "hidden" AND "x" IS NOT NULL AND "y" IS NOT NULL)
);
