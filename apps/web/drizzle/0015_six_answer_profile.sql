-- The final profile shape (Taylor, 2026-08-20): the product asks a golfer exactly SIX things —
-- handedness, swing style, handicap, age, driver speed, 7-iron carry — and goals leave the
-- profile entirely (the guidance features own them later; nothing read `golfer_goals` yet).
-- Same discipline as 0014: what the product stops asking it stops STORING, in the same change
-- that removed the questions from the app, the API's writable list, and the shared contract.
--
-- Everything dropped here was hours old and empty (0012 shipped 2026-08-18, the trimmed UI the
-- same week), so no golfer's answer is destroyed. Re-adding a field is an additive migration
-- plus a `profileFields.ts` entry; goals return as their own feature, not as profile rows.
--
-- Hand-written, like every migration since 0003.

ALTER TABLE "golfer_profiles"
  DROP COLUMN IF EXISTS "skill_level",
  DROP COLUMN IF EXISTS "average_score",
  DROP COLUMN IF EXISTS "physical_limitations",
  DROP COLUMN IF EXISTS "practice_access",
  DROP COLUMN IF EXISTS "rounds_per_month",
  DROP COLUMN IF EXISTS "practice_sessions_per_week",
  DROP COLUMN IF EXISTS "height_cm",
  DROP COLUMN IF EXISTS "years_playing",
  DROP COLUMN IF EXISTS "working_with_coach",
  DROP COLUMN IF EXISTS "coaching_style",
  DROP COLUMN IF EXISTS "feedback_depth";

-- The goal cap trigger rides on the table and dies with it; its function goes explicitly.
DROP TABLE IF EXISTS "golfer_goals";
DROP FUNCTION IF EXISTS public.golfer_goals_cap() CASCADE;
