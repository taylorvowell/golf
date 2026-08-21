-- The 2026-08-20 profile trim (Taylor): the product asks only what it acts on, and what it
-- stopped asking it stops STORING — "I don't want to keep any tech debt right now". These
-- thirteen §5.5 columns came off `golfer_profiles` in the same change that removed their
-- questions from the app, the API's writable list, and the shared contract, so no half of the
-- system believes in a field another half dropped.
--
-- The columns were hours old and every one was NULL on every row (the trimmed UI shipped the
-- same day), so this drop destroys no golfer's answer. Re-adding one later is an additive
-- migration plus a `profileFields.ts` entry — the cheap direction, which is what makes the
-- drop safe to do eagerly.
--
-- Hand-written, like every migration since 0003.

ALTER TABLE "golfer_profiles"
  DROP COLUMN IF EXISTS "typical_miss_driver",
  DROP COLUMN IF EXISTS "typical_miss_irons",
  DROP COLUMN IF EXISTS "preferred_shot_shape",
  DROP COLUMN IF EXISTS "grip_size",
  DROP COLUMN IF EXISTS "fitted_status",
  DROP COLUMN IF EXISTS "fitted_year",
  DROP COLUMN IF EXISTS "launch_monitor_access",
  DROP COLUMN IF EXISTS "climate",
  DROP COLUMN IF EXISTS "altitude_ft",
  DROP COLUMN IF EXISTS "wingspan_cm",
  DROP COLUMN IF EXISTS "wrist_to_floor_cm",
  DROP COLUMN IF EXISTS "mobility_screen",
  DROP COLUMN IF EXISTS "swing_change_in_progress";
